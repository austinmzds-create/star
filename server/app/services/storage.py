"""文件存储:阿里云 OSS 优先,未配置时落本地磁盘兜底(开发/未拿到凭证时流程照样能跑)。

鉴权两种:
- 配了 OSS_ACCESS_KEY_ID/SECRET → 用 AK/SK(推荐,可签名私有下载)
- 只配 endpoint+bucket(公共读写 bucket)→ 匿名上传,读取走公共 URL

未配 OSS 时存到 server/_uploads/。signed_url() 统一返回 /api/files/{key},
由后端代理本地或 OSS 文件,确保浏览器内联预览。
"""
import hashlib
import hmac
import mimetypes
import os
import time
import uuid
from urllib.parse import quote

from ..config import settings

LOCAL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "_uploads")
THUMB_DIR = os.path.join(LOCAL_DIR, "_thumbs")
THUMB_SIZES = {64, 96, 160, 320}


def _sign_local(key: str, exp: int) -> str:
    return hmac.new(settings.secret_key.encode(), f"{key}:{exp}".encode(),
                    hashlib.sha256).hexdigest()[:32]


def verify_local(key: str, e: str | None, s: str | None) -> bool:
    """校验本地文件签名 URL(防止未授权者凭 key 直接下载)。"""
    if not e or not s:
        return False
    try:
        exp = int(e)
    except (ValueError, TypeError):
        return False
    if exp < int(time.time()):
        return False
    return hmac.compare_digest(_sign_local(key, exp), s)

_oss_bucket = None


def _bucket():
    """延迟初始化 OSS bucket(配置齐全时)"""
    global _oss_bucket
    if _oss_bucket is not None:
        return _oss_bucket
    if not (settings.oss_endpoint and settings.oss_bucket):
        return None
    import oss2  # 仅在启用 OSS 时依赖
    if settings.oss_access_key_id and settings.oss_access_key_secret:
        auth = oss2.Auth(settings.oss_access_key_id, settings.oss_access_key_secret)
    else:
        auth = oss2.AnonymousAuth()  # 公共读写 bucket
    _oss_bucket = oss2.Bucket(auth, settings.oss_endpoint, settings.oss_bucket)
    return _oss_bucket


def use_oss() -> bool:
    return _bucket() is not None


def make_key(filename: str, prefix: str = "materials") -> str:
    clean_prefix = "/".join(part for part in prefix.split("/") if part and part not in (".", ".."))
    if not clean_prefix:
        clean_prefix = "materials"
    ext = os.path.splitext(filename or "file")[1]
    return f"{clean_prefix}/{uuid.uuid4().hex}{ext}"


def public_object_url(key: str) -> str:
    host = settings.oss_endpoint.replace("https://", "").replace("http://", "").rstrip("/")
    return f"https://{settings.oss_bucket}.{host}/{quote(key, safe='/')}"


def content_type(key_or_filename: str) -> str:
    return mimetypes.guess_type(key_or_filename)[0] or "application/octet-stream"


def local_path(key: str) -> str:
    return os.path.abspath(os.path.join(LOCAL_DIR, key))


def thumb_path(key: str, size: int) -> str:
    digest = hashlib.sha1(key.encode()).hexdigest()[:12]
    stem = os.path.splitext(os.path.basename(key))[0] or "image"
    safe_stem = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in stem)[:48]
    return os.path.abspath(os.path.join(THUMB_DIR, str(size), f"{safe_stem}-{digest}.webp"))


def save_local(key: str, data: bytes) -> None:
    path = local_path(key)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def save(data: bytes, filename: str, prefix: str = "materials") -> str:
    """存文件,返回 key。key 形如 materials/uuid.ext"""
    key = make_key(filename, prefix)
    b = _bucket()
    if b:
        headers = {
            "Content-Type": content_type(filename),
            "Content-Disposition": "inline",
        }
        b.put_object(key, data, headers=headers)
        save_local(key, data)
    else:
        save_local(key, data)
    return key


def is_image(key_or_filename: str) -> bool:
    return (content_type(key_or_filename) or "").startswith("image/")


def get_oss_object(key: str, byte_range: tuple[int, int] | None = None):
    b = _bucket()
    if not b:
        return None
    return b.get_object(key, byte_range=byte_range)


def get_oss_size(key: str) -> int:
    b = _bucket()
    if not b:
        raise FileNotFoundError(key)
    return int(b.head_object(key).content_length)


def _stable_exp(expires: int) -> int:
    """让长效签名按小时稳定，提升浏览器缓存命中率。"""
    now = int(time.time())
    if expires <= 3600:
        return now + expires
    bucket = 3600
    return ((now // bucket) + max(1, expires // bucket)) * bucket


def signed_url(key: str, expires: int = 86400) -> str:
    # 统一走后端文件代理。公共 OSS 默认域名当前会强制 attachment,
    # 图片/video 标签会碎图或不可内联预览；代理层可稳定返回 inline。
    exp = _stable_exp(expires)
    return f"/api/files/{quote(key, safe='/')}?e={exp}&s={_sign_local(key, exp)}"


def thumbnail_url(key: str | None, size: int = 160, expires: int = 86400) -> str | None:
    if not key:
        return None
    if size not in THUMB_SIZES:
        size = 160
    if not is_image(key):
        return signed_url(key, expires)
    exp = _stable_exp(expires)
    return f"/api/thumbs/{size}/{quote(key, safe='/')}?e={exp}&s={_sign_local(key, exp)}"


def ensure_thumbnail(key: str, size: int) -> str:
    if size not in THUMB_SIZES:
        raise ValueError("unsupported thumbnail size")
    if not is_image(key):
        raise ValueError("not an image")
    src = local_path(key)
    if not os.path.isfile(src):
        b = _bucket()
        if not b:
            raise FileNotFoundError(key)
        obj = b.get_object(key)
        try:
            save_local(key, obj.read())
        finally:
            close = getattr(obj, "close", None)
            if close:
                close()
    dst = thumb_path(key, size)
    if os.path.isfile(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
        return dst
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    from PIL import Image, ImageOps
    with Image.open(src) as image:
        image = ImageOps.exif_transpose(image)
        image.thumbnail((size, size), Image.Resampling.LANCZOS)
        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
        image.save(dst, "WEBP", quality=78, method=4)
    return dst
