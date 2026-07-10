"""物流跟踪:Provider 抽象(已拍板:快递100 订阅式起步,保留切换快递鸟能力)。

快递100 订阅式:subscribe 一次(约0.08~0.167元/单,全程只扣1次),
状态变化后主动 POST 回调 kd100_callback_url,免轮询。
"""
import hashlib
import json
from abc import ABC, abstractmethod

import httpx

from ..config import settings


class LogisticsProvider(ABC):
    @abstractmethod
    async def identify_courier(self, tracking_no: str) -> str | None:
        """单号自动识别快递公司"""

    @abstractmethod
    async def subscribe(self, tracking_no: str, courier: str, phone: str | None = None) -> bool:
        """订阅轨迹推送"""

    @abstractmethod
    def parse_callback(self, payload: dict) -> dict:
        """解析回调 → 统一结构 {tracking_no, status, signed, last_event, events}"""


class Kd100Provider(LogisticsProvider):
    AUTONUMBER_URL = "https://www.kuaidi100.com/autonumber/auto"
    SUBSCRIBE_URL = "https://poll.kuaidi100.com/poll"

    # 快递100 state → 统一状态
    STATE_MAP = {"0": "in_transit", "1": "shipped", "5": "in_transit",
                 "3": "signed", "301": "signed", "302": "signed", "304": "signed"}

    async def identify_courier(self, tracking_no: str) -> str | None:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(self.AUTONUMBER_URL,
                                    params={"num": tracking_no, "key": settings.kd100_key})
            data = resp.json()
            return data[0]["comCode"] if data else None

    async def subscribe(self, tracking_no: str, courier: str, phone: str | None = None) -> bool:
        param = {
            "company": courier,
            "number": tracking_no,
            "key": settings.kd100_key,
            "parameters": {"callbackurl": settings.kd100_callback_url,
                           "phone": phone or "", "resultv2": "4"},
        }
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(self.SUBSCRIBE_URL,
                                     data={"schema": "json", "param": json.dumps(param)})
            return resp.json().get("result") is True

    def parse_callback(self, payload: dict) -> dict:
        last = payload.get("lastResult", {})
        state = str(last.get("state", ""))
        events = last.get("data", [])
        return {
            "tracking_no": last.get("nu"),
            "status": self.STATE_MAP.get(state, "in_transit"),
            "signed": state in ("3", "301", "302", "304"),
            "last_event": events[0] if events else None,
            "events": events,
        }


def get_provider() -> LogisticsProvider:
    return Kd100Provider()  # 以后切快递鸟:在这里按配置返回不同实现
