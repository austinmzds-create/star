"""阿里云短信验证码(达人 H5 进入,已拍板)。

生产接阿里云 dysmsapi(建议 alibabacloud_dysmsapi20170525 SDK);
开发环境未配置 key 时打印到日志,便于本地联调。
"""
import logging
import random
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from ..config import settings
from ..models import SmsCode

logger = logging.getLogger(__name__)
CODE_TTL_MINUTES = 5


async def send_code(db: Session, phone: str) -> None:
    code = f"{random.randint(0, 999999):06d}"
    db.add(SmsCode(phone=phone, code=code,
                   expires_at=datetime.now() + timedelta(minutes=CODE_TTL_MINUTES)))
    db.commit()
    if not settings.sms_access_key_id:
        logger.warning("[DEV] 短信验证码 %s -> %s", phone, code)
        return
    # TODO(P0): 接阿里云 dysmsapi SendSms(sign_name/template_code 见 .env)
    raise NotImplementedError("配置了短信 key 但 SDK 调用未实现")


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
