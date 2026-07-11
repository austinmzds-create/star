"""阿里云短信验证码(达人 H5 进入,已拍板)。

直接实现阿里云 RPC(2017-05-25)SendSms 签名调用,避免引入重量级 SDK。
未配置 AK/签名时打印到日志,便于本地联调。
"""
import base64
import hashlib
import hmac
import logging
import random
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import httpx
from sqlalchemy.orm import Session

from ..config import settings
from ..models import SmsCode

logger = logging.getLogger(__name__)
CODE_TTL_MINUTES = 5
SMS_ENDPOINT = "https://dysmsapi.aliyuncs.com/"


def _percent_encode(s: str) -> str:
    # 阿里云 RPC 规则:RFC3986,空格→%20,*→%2A,~ 保持
    return quote(str(s), safe="")


def _rpc_sign(params: dict, secret: str) -> str:
    canonical = "&".join(f"{_percent_encode(k)}={_percent_encode(params[k])}"
                         for k in sorted(params))
    string_to_sign = "GET&" + _percent_encode("/") + "&" + _percent_encode(canonical)
    digest = hmac.new((secret + "&").encode(), string_to_sign.encode(), hashlib.sha1).digest()
    return base64.b64encode(digest).decode()


async def _send_aliyun(phone: str, code: str) -> None:
    params = {
        "AccessKeyId": settings.sms_access_key_id,
        "Action": "SendSms",
        "Format": "JSON",
        "PhoneNumbers": phone,
        "RegionId": "cn-hangzhou",
        "SignName": settings.sms_sign_name,
        "SignatureMethod": "HMAC-SHA1",
        "SignatureNonce": uuid.uuid4().hex,
        "SignatureVersion": "1.0",
        "TemplateCode": settings.sms_template_code,
        "TemplateParam": f'{{"code":"{code}"}}',
        "Timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "Version": "2017-05-25",
    }
    params["Signature"] = _rpc_sign(params, settings.sms_access_key_secret)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(SMS_ENDPOINT, params=params)
        body = resp.json()
    if body.get("Code") != "OK":
        raise RuntimeError(f"短信发送失败:{body.get('Code')} {body.get('Message')}")


async def send_code(db: Session, phone: str) -> None:
    code = f"{random.randint(0, 999999):06d}"
    db.add(SmsCode(phone=phone, code=code,
                   expires_at=datetime.now() + timedelta(minutes=CODE_TTL_MINUTES)))
    db.commit()
    # 未配齐(AK/签名/模板)时降级为日志,方便本地联调
    if not (settings.sms_access_key_id and settings.sms_sign_name and settings.sms_template_code):
        logger.warning("[DEV] 短信验证码 %s -> %s", phone, code)
        return
    await _send_aliyun(phone, code)


def verify_code(db: Session, phone: str, code: str) -> bool:
    row = (db.query(SmsCode)
           .filter(SmsCode.phone == phone, SmsCode.code == code,
                   SmsCode.used.is_(False), SmsCode.expires_at > datetime.now())
           .order_by(SmsCode.id.desc()).first())
    if not row:
        return False
    row.used = True
    db.commit()
    return True
