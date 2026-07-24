"""达人信息智能解析(R1):正则先抓确定性字段,LLM(客户智能体平台)补非结构化字段。

返回的每个字段带 confidence,前端把低置信度标黄让商务确认。
"""
import re

import httpx

from ..config import settings

RE_URL = re.compile(r"https?://[\w./\-?=&%]+")
RE_DOUYIN_UID = re.compile(r"uid[：:\s]*(\d{6,20})", re.I)
RE_PHONE = re.compile(r"1[3-9]\d{9}")
RE_FANS = re.compile(r"(?:粉丝|fans)[::\s]*([\d.]+)\s*([wW万])?")

# —— 标注格式("字段名:值")解析 ——
RE_NICKNAME  = re.compile(r"^\s*(?:达人昵称|昵称|抖音昵称)[：:\s]+(.+?)\s*$", re.M)
RE_DOUYIN_ID = re.compile(r"(?:抖音号|抖音ID|抖音id)[：:\s]*([A-Za-z0-9_\-.]{3,32})")
RE_COOP_CODE = re.compile(r"(?:合作码|合作代码)[：:\s]*([A-Za-z0-9]{4,32})")
RE_RECEIVER  = re.compile(r"^\s*(?:收件人|收货人)[：:\s]+(.+?)\s*$", re.M)
RE_ADDRESS   = re.compile(r"^\s*(?:收件地址|收货地址|地址)[：:\s]+(.+?)\s*$", re.M)
RE_LEVEL     = re.compile(r"(?:等级|级别)[：:\s]*([123])\s*级?")
RE_RECV_PHONE = re.compile(r"(?:收件电话|收货电话|电话|手机号?)[：:\s]*(1[3-9]\d{9})")
LEVEL_MAP = {"1": "L1", "2": "L2", "3": "L3"}

LLM_PROMPT = """你是达人信息抽取器。从下面这段微信自我介绍中抽取 JSON:
{{"nickname": 抖音昵称, "douyin_id": 抖音号, "fans_count": 粉丝数(纯数字),
"category_tags": 内容品类数组, "shoot_type": "口播"或"桌拍"或null, "real_name": 真实姓名或null}}
只输出 JSON。原文:
{text}"""


def parse_labeled(text: str) -> dict:
    """标注格式("字段名:值")逐条解析,命中即写入。"""
    out: dict = {}
    if m := RE_NICKNAME.search(text):
        out["nickname"] = m.group(1).rstrip()  # 只去空白,保留末尾 emoji
    if m := RE_DOUYIN_ID.search(text):
        out["douyin_id"] = m.group(1)
    if m := RE_DOUYIN_UID.search(text):
        out["douyin_uid"] = m.group(1)
    if m := RE_COOP_CODE.search(text):
        out["cooperation_code"] = m.group(1)
    if m := RE_RECEIVER.search(text):
        out["real_name"] = m.group(1)
    if m := RE_RECV_PHONE.search(text):        # 收件电话优先
        out["phone"] = m.group(1)
    elif m := RE_PHONE.search(text):           # 回退全局手机号
        out["phone"] = m.group(0)
    if m := RE_ADDRESS.search(text):
        out["default_address"] = m.group(1)
    if m := RE_LEVEL.search(text):
        out["level"] = LEVEL_MAP[m.group(1)]
    # 主页行:优先取真实 http 链接,取不到则存原文备查(不塞进 homepage_url)
    for line in text.splitlines():
        if "主页" not in line:
            continue
        if u := RE_URL.search(line):
            out["homepage_url"] = u.group(0)
        else:
            raw = re.sub(r"^\s*主页(?:链接|地址)?[：:\s]*", "", line).rstrip()
            if raw:
                out["homepage_raw"] = raw
        break
    return out


def parse_regex(text: str) -> dict:
    out: dict = {}
    if m := RE_DOUYIN_UID.search(text):
        out["douyin_uid"] = m.group(1)
    if m := RE_PHONE.search(text):
        out["phone"] = m.group(0)
    urls = RE_URL.findall(text)
    if homepage := next((u for u in urls if "douyin.com" in u), None):
        out["homepage_url"] = homepage
    if m := RE_FANS.search(text):
        try:  # [\d.]+ 可能匹配到 "1.2.3"/"." 等非法浮点,容错跳过
            n = float(m.group(1))
            out["fans_count"] = int(n * 10000) if m.group(2) else int(n)
        except ValueError:
            pass
    out.update(parse_labeled(text))  # 标注解析覆盖旧结果,来源仍归 "regex"
    return out


async def parse_llm(text: str) -> dict:
    """走客户现有智能体平台的 API(已拍板)。平台不可用时返回空,不阻塞录入。"""
    if not settings.agent_api_base:
        return {}
    try:
        # base 形如 https://host/codex/v1,OpenAI 兼容:直接追加 /chat/completions
        base = settings.agent_api_base.rstrip("/")
        payload = {
            "messages": [{"role": "user", "content": LLM_PROMPT.format(text=text)}],
            "response_format": {"type": "json_object"},
        }
        if settings.agent_api_model:
            payload["model"] = settings.agent_api_model
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{base}/chat/completions",
                headers={"Authorization": f"Bearer {settings.agent_api_key}"},
                json=payload,
            )
            resp.raise_for_status()
            import json
            content = resp.json()["choices"][0]["message"]["content"]
            parsed = json.loads(content)
            return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


async def parse_influencer_text(text: str) -> dict:
    """正则结果优先(确定性高),LLM 补空缺;标注每个字段来源供前端置信度展示。"""
    regex_fields = parse_regex(text)
    llm_fields = await parse_llm(text)
    merged, source = {}, {}
    for k, v in llm_fields.items():
        if v not in (None, "", []):
            merged[k], source[k] = v, "llm"
    for k, v in regex_fields.items():
        merged[k], source[k] = v, "regex"
    return {"fields": merged, "source": source, "raw": text}
