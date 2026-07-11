"""文件存储:阿里云 OSS 优先,未配置时落本地磁盘兜底(开发/未拿到凭证时流程照样能跑)。

鉴权两种:
- 配了 OSS_ACCESS_KEY_ID/SECRET → 用 AK/SK(推荐,可签名私有下载)
- 只配 endpoint+bucket(公共读写 bucket)→ 匿名上传,读取走公共 URL

未配 OSS 时存到 server/_uploads/,signed_url() 返回 /files/{key} 由本地静态路由提供。
"""
import os
import uuid

from ..config import settings

LOCAL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "_uploads")

_oss_bucket = None
_oss_mode = None  # "ak" / "anonymous" / None


def _bucket():
    """延迟初始化 OSS bucket(配置齐全时)"""
    global _oss_bucket, _oss_mode
    if _oss_bucket is not None:
        return _oss_bucket
    if not (settings.oss_endpoint and settings.oss_bucket):
        return None
    import oss2  # 仅在启用 OSS 时依赖
    if settings.oss_access_key_id and settings.oss_access_key_secret:
        auth = oss2.Auth(settings.oss_access_key_id, settings.oss_access_key_secret)
        _oss_mode = "ak"
    else:
        auth = oss2.AnonymousAuth()  # 公共读写 bucket
        _oss_mode = "anonymous"
    _oss_bucket = oss2.Bucket(auth, settings.oss_endpoint, settings.oss_bucket)
    return _oss_bucket


def use_oss() -> bool:
    return _bucket() is not None


def _public_url(key: str) -> str:
    # https://{bucket}.{endpoint 去掉协议}/{key}
    host = settings.oss_endpoint.replace("https://", "").replace("http://", "").rstrip("/")
    return f"https://{settings.oss_bucket}.{host}/{key}"


def save(data: bytes, filename: str, prefix: str = "materials") -> str:
    """存文件,返回 key。key 形如 materials/uuid.ext"""
    ext = os.path.splitext(filename)[1]
    key = f"{prefix}/{uuid.uuid4().hex}{ext}"
    b = _bucket()
    if b:
        b.put_object(key, data)
    else:
        path = os.path.join(LOCAL_DIR, key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
    return key


def signed_url(key: str, expires: int = 3600) -> str:
    b = _bucket()
    if not b:
        return f"/files/{key}"  # 本地静态路由
    if _oss_mode == "ak":
        return b.sign_url("GET", key, expires)
    return _public_url(key)  # 匿名/公共 bucket 直接给公共 URL
