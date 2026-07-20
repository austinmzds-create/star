"""文件上传:内部端上传素材/截图。OSS 配了直传 OSS,没配落本地 _uploads/。

返回 {key, url}。前端把 key 存进 Material.oss_key,url 用于即时预览。
"""
import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from ..deps import current_user
from ..models import User
from ..services import storage

router = APIRouter(prefix="/api", tags=["uploads"])
logger = logging.getLogger(__name__)


class DirectUploadIn(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    prefix: str = Field(default="materials", max_length=64)
    content_type: str | None = Field(default=None, max_length=128)


@router.post("/upload/direct-ticket")
def direct_upload_ticket(body: DirectUploadIn, user: User = Depends(current_user)):
    """前端直传 OSS 的临时目标。

    当前测试 bucket 是公共读写,所以不签名;后续切生产私有 bucket 时,
    这里可以平滑替换成 STS 或带签名 PUT URL,前端调用语义不变。
    """
    if not storage.extension_allowed(body.filename):
        raise HTTPException(400, "不支持的文件类型,仅允许图片/视频/PDF")
    if not storage.use_oss():
        return {"enabled": False}
    key = storage.make_key(body.filename, body.prefix)
    public_url = storage.public_object_url(key)
    # Content-Type 一律由扩展名推导,不采信前端传入(否则可伪造 text/html 内联执行)
    return {
        "enabled": True,
        "key": key,
        "upload_url": public_url,
        "content_type": storage.content_type(key),
        "url": public_url,
        "preview_url": storage.preview_url(key),
        "inline_preview": storage.inline_preview_enabled(),
    }


# 素材可能是视频,单文件上限放到 200MB;超限直接 413。
MAX_UPLOAD_BYTES = 200 * 1024 * 1024


@router.post("/upload")
async def upload(file: UploadFile, prefix: str = "materials",
                 user: User = Depends(current_user)):
    # 读入内容并落库:OSS 用 put_object(bytes) 一次写全(此前分块流式写会写出 0 字节文件,
    # 导致 OSS 对象为空、缩略图 502);OSS 的阻塞上传放线程池,不卡事件循环。
    if not storage.extension_allowed(file.filename or ""):
        raise HTTPException(400, "不支持的文件类型,仅允许图片/视频/PDF")
    data = await file.read()
    if not data:
        raise HTTPException(400, "上传文件为空,请重新选择")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"文件超过 {MAX_UPLOAD_BYTES // 1024 // 1024}MB 上限,请压缩后再传")
    try:
        key = await run_in_threadpool(storage.save, data, file.filename or "file", prefix)
    except Exception:
        logger.exception("[upload] 存储写入失败")
        raise HTTPException(502, "文件存储写入失败,请检查存储/OSS 配置")
    return {"key": key, "url": storage.signed_url(key), "use_oss": storage.use_oss()}


def _is_safe_key(key: str) -> bool:
    parts = key.split("/")
    return bool(key) and not key.startswith("/") and ".." not in parts


def _inline_name(key: str) -> str:
    return os.path.basename(key).replace('"', "")


def _parse_range(value: str | None, size: int) -> tuple[int, int] | str | None:
    if not value or not value.startswith("bytes="):
        return None
    spec = value.removeprefix("bytes=").split(",", 1)[0].strip()
    if "-" not in spec:
        return None
    start_s, end_s = spec.split("-", 1)
    try:
        if start_s == "":
            length = int(end_s)
            if length <= 0:
                return "invalid"
            return max(size - length, 0), size - 1
        start = int(start_s)
        end = int(end_s) if end_s else size - 1
    except ValueError:
        return "invalid"
    if start < 0 or start >= size or end < start:
        return "invalid"
    return start, min(end, size - 1)


def _oss_chunks(obj):
    try:
        while True:
            chunk = obj.read(1024 * 1024)
            if not chunk:
                break
            yield chunk
    finally:
        close = getattr(obj, "close", None)
        if close:
            close()


def _serve_oss(key: str, request: Request):
    try:
        size = storage.get_oss_size(key)
    except Exception as exc:
        status = getattr(exc, "status", None)
        if status == 404:
            raise HTTPException(404, "文件不存在")
        logger.exception("[upload] OSS 读取失败")
        raise HTTPException(502, "文件读取失败,请检查 OSS 配置")

    byte_range = _parse_range(request.headers.get("range"), size)
    if byte_range == "invalid":
        return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})

    try:
        obj = storage.get_oss_object(key, byte_range=byte_range)
    except Exception as exc:
        status = getattr(exc, "status", None)
        if status == 404:
            raise HTTPException(404, "文件不存在")
        logger.exception("[upload] OSS 读取失败")
        raise HTTPException(502, "文件读取失败,请检查 OSS 配置")

    safe = storage.is_inline_safe(key)
    media_type = storage.content_type(key) if safe else "application/octet-stream"
    disposition = "inline" if safe else "attachment"
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Disposition": f'{disposition}; filename="{_inline_name(key)}"',
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
    }
    status_code = 200
    if isinstance(byte_range, tuple):
        start, end = byte_range
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        headers["Content-Length"] = str(end - start + 1)
        status_code = 206
    else:
        headers["Content-Length"] = str(size)
    return StreamingResponse(
        _oss_chunks(obj),
        media_type=media_type,
        headers=headers,
        status_code=status_code,
    )


# 文件预览/下载统一走后端代理。即使启用 OSS,也在这里补 inline header,
# 避免 OSS 默认域名强制 attachment 导致图片、视频预览碎掉。
@router.get("/files/{key:path}")
def serve_file(key: str, request: Request, e: str | None = None, s: str | None = None):
    if not storage.verify_local(key, e, s):
        raise HTTPException(403, "链接无效或已过期")
    if not _is_safe_key(key):
        raise HTTPException(400, "非法路径")

    base = os.path.abspath(storage.LOCAL_DIR)
    path = storage.local_path(key)
    # 加分隔符防止 /uploads 前缀误配 /uploads_evil,且拦截 ../ 穿越
    if path != base and not path.startswith(base + os.sep):
        raise HTTPException(400, "非法路径")
    if os.path.isfile(path):
        # 只有图片/视频/音频/PDF 允许内联预览;其余(如历史遗留的 html/svg)强制下载,
        # 且用 octet-stream 防止浏览器按内容嗅探执行,杜绝存储型 XSS。
        safe = storage.is_inline_safe(key)
        media_type = storage.content_type(key) if safe else "application/octet-stream"
        disposition = "inline" if safe else "attachment"
        response = FileResponse(path, media_type=media_type)
        response.headers["Content-Disposition"] = f'{disposition}; filename="{_inline_name(key)}"'
        response.headers["Cache-Control"] = "private, max-age=3600"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    if storage.use_oss():
        return _serve_oss(key, request)

    raise HTTPException(404, "文件不存在")


@router.get("/thumbs/{size}/{key:path}")
def serve_thumb(size: int, key: str, request: Request, e: str | None = None, s: str | None = None):
    if not storage.verify_local(key, e, s):
        raise HTTPException(403, "链接无效或已过期")
    if not _is_safe_key(key):
        raise HTTPException(400, "非法路径")
    try:
        path = storage.ensure_thumbnail(key, size)
    except ValueError:
        # 非图片(如 pdf/视频):直接回原文件,不当作错误
        return serve_file(key, request, e, s)
    except FileNotFoundError:
        raise HTTPException(404, "文件不存在")
    except Exception:
        # 缩略图生成失败(图片损坏/格式不支持等):降级回原图,避免前端显示成裂图/FAILED
        logger.warning("[upload] 缩略图生成失败,降级回原图: %s", key)
        try:
            return serve_file(key, request, e, s)
        except HTTPException:
            raise HTTPException(404, "文件不存在")
    response = FileResponse(path, media_type="image/webp")
    response.headers["Content-Disposition"] = f'inline; filename="{_inline_name(key)}.webp"'
    response.headers["Cache-Control"] = "private, max-age=3600"
    return response
