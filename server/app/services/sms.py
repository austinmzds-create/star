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
SEND_COOLDOWN_SECONDS = 50   # 同一手机号发送间隔
MAX_VERIFY_ATTEMPTS = 5      # 单个验证码最大尝试次数
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


class SmsError(Exception):
    """短信发送/频控错误(端点转 400)"""


async def send_code(db: Session, phone: str) -> None:
    # 发送频控:同号 50s 内不重发
    last = (db.query(SmsCode).filter(SmsCode.phone == phone)
            .order_by(SmsCode.id.desc()).first())
    if last and (datetime.now() - last.created_at).total_seconds() < SEND_COOLDOWN_SECONDS:
        raise SmsError("验证码发送过于频繁,请稍后再试")
    # 作废该号所有历史未用码(避免多码并存放大爆破)
    db.query(SmsCode).filter(SmsCode.phone == phone, SmsCode.used.is_(False)) \
        .update({SmsCode.used: True})
    code = f"{random.randint(0, 999999):06d}"
    db.add(SmsCode(phone=phone, code=code,
                   expires_at=datetime.now() + timedelta(minutes=CODE_TTL_MINUTES)))
    db.commit()
    # 未配齐(AK/签名/模板)时,仅开发环境降级为日志;生产必须明确失败,
    # 避免前端提示“已发送”但用户实际收不到短信。
    if not (settings.sms_access_key_id and settings.sms_sign_name and settings.sms_template_code):
        if settings.debug:
            logger.warning("[DEV] 短信验证码 %s -> %s", phone, code)
            return
        raise SmsError("短信服务未配置,请先配置阿里云短信 AK/签名/模板")
    try:
        await _send_aliyun(phone, code)
    except RuntimeError as exc:
        raise SmsError(str(exc)) from exc


def verify_code(db: Session, phone: str, code: str) -> bool:
    """只校验该号最新的未用未过期码;失败累计,超限作废(防爆破)"""
    row = (db.query(SmsCode)
           .filter(SmsCode.phone == phone, SmsCode.used.is_(False),
                   SmsCode.expires_at > datetime.now())
           .order_by(SmsCode.id.desc()).first())
    if not row:
        return False
    if row.code != code:
        row.attempts += 1
        if row.attempts >= MAX_VERIFY_ATTEMPTS:
            row.used = True  # 超限作废,必须重新发码
        db.commit()
        return False
    row.used = True
    db.commit()
    return True
