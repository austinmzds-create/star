"""达人信息智能解析(R1):正则先抓确定性字段,LLM(客户智能体平台)补非结构化字段。

返回的每个字段带 confidence,前端把低置信度标黄让商务确认。
"""
import re

import httpx

from ..config import settings

RE_URL = re.compile(r"https?://[\w./\-?=&%]+")
RE_DOUYIN_UID = re.compile(r"(?:UID|uid)[::\s]*(\d{6,20})")
RE_PHONE = re.compile(r"1[3-9]\d{9}")
RE_FANS = re.compile(r"(?:粉丝|fans)[::\s]*([\d.]+)\s*([wW万])?")

LLM_PROMPT = """你是达人信息抽取器。从下面这段微信自我介绍中抽取 JSON:
{{"nickname": 抖音昵称, "douyin_id": 抖音号, "fans_count": 粉丝数(纯数字),
"category_tags": 内容品类数组, "shoot_type": "口播"或"桌拍"或null, "real_name": 真实姓名或null}}
只输出 JSON。原文:
{text}"""


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
        n = float(m.group(1))
        out["fans_count"] = int(n * 10000) if m.group(2) else int(n)
    return out


async def parse_llm(text: str) -> dict:
    """走客户现有智能体平台的 API(已拍板)。平台不可用时返回空,不阻塞录入。"""
    if not settings.agent_api_base:
        return {}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{settings.agent_api_base.rstrip('/')}/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.agent_api_key}"},
                json={"messages": [{"role": "user", "content": LLM_PROMPT.format(text=text)}],
                      "response_format": {"type": "json_object"}},
            )
            resp.raise_for_status()
            import json
            content = resp.json()["choices"][0]["message"]["content"]
            return json.loads(content)
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
