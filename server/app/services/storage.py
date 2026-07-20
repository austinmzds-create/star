"""文件存储:阿里云 OSS 优先,未配置时落本地磁盘兜底(开发/未拿到凭证时流程照样能跑)。

鉴权两种:
- 配了 OSS_ACCESS_KEY_ID/SECRET → 用 AK/SK(推荐,可签名私有下载)
- 只配 endpoint+bucket(公共读写 bucket)→ 匿名上传,读取走公共 URL

未配 OSS 时存到 server/_uploads/。素材预览在 OSS 开启时直接返回公共读 URL,
避免大视频经后端代理占用服务器带宽；本地兜底仍走签名代理。
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


# 允许上传/预览的文件类型(按扩展名白名单)。只放业务真正需要的图片/视频/PDF,
# 其余(尤其 .html/.svg/.js)一律拒绝——否则会被当 text/html 内联下发,构成存储型 XSS。
ALLOWED_EXTENSIONS = frozenset({
    ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp",   # 图片
    ".mp4", ".mov", ".m4v", ".webm",                     # 视频
    ".pdf",                                              # 报告/文档
})
# 可安全内联预览的 MIME 前缀/类型;其余强制 attachment 下载,避免浏览器执行
_INLINE_SAFE_PREFIXES = ("image/", "video/", "audio/")
_INLINE_SAFE_TYPES = frozenset({"application/pdf"})


def ext_of(filename: str) -> str:
    return os.path.splitext(filename or "")[1].lower()


def extension_allowed(filename: str) -> bool:
    return ext_of(filename) in ALLOWED_EXTENSIONS


def is_inline_safe(key_or_filename: str) -> bool:
    """该类型能否安全地 inline 预览(图片/视频/音频/PDF);其余按下载处理。"""
    ct = content_type(key_or_filename)
    return ct.startswith(_INLINE_SAFE_PREFIXES) or ct in _INLINE_SAFE_TYPES


def make_key(filename: str, prefix: str = "materials") -> str:
    clean_prefix = "/".join(part for part in prefix.split("/") if part and part not in (".", ".."))
    if not clean_prefix:
        clean_prefix = "materials"
    ext = os.path.splitext(filename or "file")[1]
    return f"{clean_prefix}/{uuid.uuid4().hex}{ext}"


# ---- 签名直传(支持私有 bucket)。配了 AK 即启用:浏览器凭签名 URL 直传 OSS,
# 不再依赖 bucket 公共写。单文件用签名 PUT;大文件分片——init/complete 走服务端(小请求、快、
# 不暴露 AK),仅"上传分片"这一大流量步骤由浏览器凭签名 URL 直传。 ----
MULTIPART_MAX_PARTS = 10000  # OSS 硬上限


def use_signed_upload() -> bool:
    """AK 齐全 → 用签名直传(私有 bucket 也可);否则(匿名公共 bucket)退回不签名直传。"""
    return bool(_bucket() and settings.oss_access_key_id and settings.oss_access_key_secret)


def signed_put_url(key: str, content_type: str, expires: int = 3600) -> str:
    """单文件直传的签名 PUT URL。

    OSS V1 签名把 Content-Type 计入签名串,因此必须把它纳入签名,且前端 PUT 时必须发送
    完全一致的 Content-Type(见 direct-ticket 返回的 content_type),否则 403 SignatureDoesNotMatch。
    对象因此以正确的 Content-Type 落库,后续签名 GET 直读也能拿到正确类型。"""
    return _bucket().sign_url("PUT", key, expires, slash_safe=True,
                              headers={"Content-Type": content_type})


def init_multipart(key: str, content_type: str | None = None) -> str:
    headers = {"Content-Type": content_type} if content_type else None
    return _bucket().init_multipart_upload(key, headers=headers).upload_id


def signed_part_url(key: str, upload_id: str, part_number: int, expires: int = 3600) -> str:
    return _bucket().sign_url("PUT", key, expires, slash_safe=True,
                              params={"partNumber": str(part_number), "uploadId": upload_id})


def complete_multipart(key: str, upload_id: str, parts: list[dict]) -> None:
    from oss2.models import PartInfo
    infos = [PartInfo(int(p["part_number"]), str(p["etag"]).strip('"'))
             for p in sorted(parts, key=lambda x: int(x["part_number"]))]
    _bucket().complete_multipart_upload(key, upload_id, infos)


def abort_multipart(key: str, upload_id: str) -> None:
    try:
        _bucket().abort_multipart_upload(key, upload_id)
    except Exception:  # 取消是尽力而为;残留分片由 OSS 生命周期规则回收
        pass


def public_object_url(key: str) -> str:
    if settings.oss_public_base_url:
        base = settings.oss_public_base_url.rstrip("/")
        return f"{base}/{quote(key, safe='/')}"
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


def upload_local_to_oss(key: str) -> None:
    """把已落地的本地文件上传到 OSS(供流式上传:先写盘再传 OSS,避免整文件驻留内存)。"""
    b = _bucket()
    if not b:
        return
    headers = {"Content-Type": content_type(key), "Content-Disposition": "inline"}
    b.put_object_from_file(key, local_path(key), headers=headers)


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
    """长效签名按天对齐:同一天内签名/URL 稳定(浏览器缓存命中,不必每小时重拉缩略图),
    且实际有效期不短于 expires(day+1 的对齐保证跨午夜也不会临期失效)。"""
    now = int(time.time())
    if expires <= 3600:
        return now + expires
    day = 86400
    periods = max(1, (expires + day - 1) // day)
    return ((now // day) + periods + 1) * day


def signed_url(key: str, expires: int = 86400) -> str:
    # 统一走后端文件代理。公共 OSS 默认域名当前会强制 attachment,
    # 图片/video 标签会碎图或不可内联预览；代理层可稳定返回 inline。
    exp = _stable_exp(expires)
    return f"/api/files/{quote(key, safe='/')}?e={exp}&s={_sign_local(key, exp)}"


def oss_signing_enabled() -> bool:
    """配了 AK → 可对 OSS 做签名(PUT 上传 / GET 下载 / 私有读)。私有 bucket 必走此路。"""
    return use_signed_upload()


def public_or_signed_url(key: str, expires: int = 86400) -> str:
    """文件地址(不暴露裸 OSS 域名给前端):
    - 配了可用的自定义域名(oss_public_base_url)→ 用它;
    - 配了 AK(可能私有/默认域名会强制下载)→ 走后端签名代理(自家域名、AK 读、私有可读);
    - 匿名公共 bucket 无自定义域名 → 默认公共 URL;
    - 本地 → 后端代理。"""
    if not use_oss():
        return signed_url(key, expires)
    if settings.oss_public_base_url:
        return public_object_url(key)
    if oss_signing_enabled():
        return signed_url(key, expires)
    return public_object_url(key)


def signed_get_url(key: str, expires: int = 1800) -> str:
    """短时效签名 GET URL,用于下载重定向:私有 bucket 直读、不占 ECS 带宽。
    注意:阿里云默认域名会强制 Content-Disposition: attachment,故仅用于下载,不用于内联预览。"""
    return _bucket().sign_url("GET", key, expires, slash_safe=True)


def material_file_url(material_id: int, download: bool = False, expires: int = 86400) -> str:
    """素材文件的对外地址:只暴露"自家域名 + 素材 id + 签名",不暴露 bucket/key。
    后端凭 id 反查 key 后:内联预览走代理(私有可读、附内联头),下载(dl=1)302 到签名 OSS。"""
    ref = f"mat:{material_id}"
    exp = _stable_exp(expires)
    query = f"?e={exp}&s={_sign_local(ref, exp)}" + ("&dl=1" if download else "")
    return f"/api/material-file/{material_id}{query}"


def inline_preview_enabled() -> bool:
    """是否可以把 OSS URL 直接放进 video/iframe。

    阿里云默认 OSS 域名目前会返回 ``Content-Disposition: attachment`` 和
    ``x-oss-force-download:true``。把这种地址自动塞进 video/iframe 会导致浏览器
    在打开详情时直接下载文件。只有接入已验证可 inline 的自定义域名/CDN 后才开启。
    """
    if not use_oss():
        return True
    return bool(settings.oss_inline_preview and settings.oss_public_base_url)


def preview_url(key: str, expires: int = 86400) -> str:
    if inline_preview_enabled():
        return public_or_signed_url(key, expires)
    return signed_url(key, expires)


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
