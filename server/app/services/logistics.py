"""物流跟踪:Provider 抽象(已拍板:快递100 起步,保留切换快递鸟能力)。

两条真实链路(均已用企业凭证实测通过):
- subscribe 订阅推送:提交一次,状态变化后快递100 主动 POST 回调 kd100_callback_url(生产用,免轮询)
- query_realtime 实时查询:sign=MD5(param+key+customer) 大写,即时拉最新轨迹
  (手动刷新/回调地址尚未公网可达时的兜底)

单号自动识别(autonumber)该账号的 key 报"过期",故快递公司由商务在发货时选择(courier code)。
"""
import hashlib
import json
from abc import ABC, abstractmethod

import httpx

from ..config import settings

# 常用快递公司 code(快递100 编码),供前端下拉
COURIERS = [
    {"code": "yuantong", "name": "圆通速递"},
    {"code": "zhongtong", "name": "中通快递"},
    {"code": "shentong", "name": "申通快递"},
    {"code": "yunda", "name": "韵达速递"},
    {"code": "shunfeng", "name": "顺丰速运"},
    {"code": "jtexpress", "name": "极兔速递"},
    {"code": "ems", "name": "EMS"},
    {"code": "youzhengguonei", "name": "邮政快递包裹"},
    {"code": "jd", "name": "京东物流"},
    {"code": "huitongkuaidi", "name": "百世快递"},
]

# 快递100 state → 统一状态
STATE_MAP = {"0": "in_transit", "1": "shipped", "5": "in_transit", "6": "in_transit",
             "3": "signed", "301": "signed", "302": "signed", "304": "signed"}
SIGNED_STATES = {"3", "301", "302", "304"}


class LogisticsProvider(ABC):
    @abstractmethod
    async def identify_courier(self, tracking_no: str) -> str | None:
        """单号自动识别快递公司(best-effort,失败返回 None,由人工选择)"""

    @abstractmethod
    async def subscribe(self, tracking_no: str, courier: str, phone: str | None = None) -> tuple[bool, str]:
        """订阅轨迹推送,返回 (是否成功, 消息)"""

    @abstractmethod
    async def query_realtime(self, tracking_no: str, courier: str, phone: str | None = None) -> dict:
        """实时查询最新轨迹 → 统一结构"""

    @abstractmethod
    def parse_callback(self, payload: dict) -> dict:
        """解析订阅回调 → 统一结构 {tracking_no, status, signed, last_event, events}"""


class Kd100Provider(LogisticsProvider):
    AUTONUMBER_URL = "https://www.kuaidi100.com/autonumber/auto"
    SUBSCRIBE_URL = "https://poll.kuaidi100.com/poll"
    QUERY_URL = "https://poll.kuaidi100.com/poll/query.do"

    def _sign(self, param: str) -> str:
        # 快递100 规则:MD5(param + key + customer) 转大写
        return hashlib.md5(
            (param + settings.kd100_key + settings.kd100_customer).encode()
        ).hexdigest().upper()

    async def identify_courier(self, tracking_no: str) -> str | None:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(self.AUTONUMBER_URL,
                                        params={"num": tracking_no, "key": settings.kd100_key})
                data = resp.json()
                if isinstance(data, list) and data:
                    return data[0].get("comCode")
        except Exception:
            pass
        return None

    def callback_salt(self) -> str:
        """订阅时提交的 salt;快递100 回调 sign=MD5(param+salt) 用它校验来源。"""
        return settings.kd100_secret or settings.kd100_key

    def verify_callback_sign(self, param_raw: str, sign: str | None) -> bool:
        """校验推送签名:sign == MD5(param + salt) 大写。未配 salt 时无法校验返回 False。"""
        salt = self.callback_salt()
        if not salt or not sign:
            return False
        expected = hashlib.md5((param_raw + salt).encode()).hexdigest().upper()
        return sign.upper() == expected

    async def subscribe(self, tracking_no: str, courier: str, phone: str | None = None) -> tuple[bool, str]:
        params = {"callbackurl": settings.kd100_callback_url, "phone": phone or "", "resultv2": "4"}
        salt = self.callback_salt()
        if salt:
            params["salt"] = salt   # 推送回调将带 sign=MD5(param+salt),供服务端验签
        param = {
            "company": courier,
            "number": tracking_no,
            "key": settings.kd100_key,
            "parameters": params,
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(self.SUBSCRIBE_URL,
                                         data={"schema": "json", "param": json.dumps(param)})
                body = resp.json()
                # result true=成功;returnCode 501=重复订阅(视为已订阅)
                ok = body.get("result") is True or str(body.get("returnCode")) == "501"
                return ok, body.get("message", "")
        except Exception as e:
            return False, str(e)

    async def query_realtime(self, tracking_no: str, courier: str, phone: str | None = None) -> dict:
        p = {"com": courier, "num": tracking_no}
        if phone:
            p["phone"] = phone
        param = json.dumps(p, ensure_ascii=False)
        data = {"customer": settings.kd100_customer, "sign": self._sign(param),
                "param": param, "signType": "MD5"}
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(self.QUERY_URL, data=data)
                body = resp.json()
        except Exception as e:
            # 网络/解析异常兜底,避免手动刷新时 500(轨迹为空即可)
            return {"ok": False, "message": str(e), "tracking_no": tracking_no,
                    "courier": courier, "status": None, "signed": False,
                    "last_event": None, "events": []}
        state = str(body.get("state", ""))
        events = body.get("data", []) or []
        return {
            "ok": body.get("message") == "ok" or bool(events),
            "message": body.get("message", ""),
            "tracking_no": body.get("nu", tracking_no),
            "courier": body.get("com", courier),
            "status": STATE_MAP.get(state, "in_transit") if events else None,
            "signed": state in SIGNED_STATES,
            "last_event": events[0] if events else None,
            "events": events,
        }

    def parse_callback(self, payload: dict) -> dict:
        last = payload.get("lastResult", {})
        state = str(last.get("state", ""))
        events = last.get("data", []) or []
        return {
            "tracking_no": last.get("nu"),
            "status": STATE_MAP.get(state, "in_transit"),
            "signed": state in SIGNED_STATES,
            "last_event": events[0] if events else None,
            "events": events,
        }


def get_provider() -> LogisticsProvider:
    return Kd100Provider()  # 以后切快递鸟:在这里按配置返回不同实现
