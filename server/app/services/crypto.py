"""对称加密敏感字段(千川 access/refresh token 等),密钥由 SECRET_KEY 派生。

Fernet(AES128-CBC + HMAC)。decrypt 对无法解密的值原样返回,兼容历史明文数据,
便于平滑迁移(旧明文 token 仍可用,下次写入即变密文)。
"""
import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from ..config import settings


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(settings.secret_key.encode()).digest())
    return Fernet(key)


def encrypt(text: str | None) -> str | None:
    if not text:
        return text
    return _fernet().encrypt(text.encode()).decode()


def decrypt(text: str | None) -> str | None:
    if not text:
        return text
    try:
        return _fernet().decrypt(text.encode()).decode()
    except (InvalidToken, ValueError):
        return text  # 历史明文 / 非本密钥密文:原样返回
