"""文件上传:内部端上传素材/截图。OSS 配了直传 OSS,没配落本地 _uploads/。

返回 {key, url}。前端把 key 存进 Material.oss_key,url 用于即时预览。
"""
import os

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ..deps import current_user
from ..models import User
from ..services import storage

router = APIRouter(prefix="/api", tags=["uploads"])


@router.post("/upload")
async def upload(file: UploadFile, prefix: str = "materials",
                 user: User = Depends(current_user)):
    data = await file.read()
    key = storage.save(data, file.filename or "file", prefix=prefix)
    return {"key": key, "url": storage.signed_url(key), "use_oss": storage.use_oss()}


# 本地兜底静态服务(未配 OSS 时;配了 OSS 走签名 URL 不经这里)
# 必须带 signed_url() 生成的 e/s 签名参数,否则拒绝(防止凭 key 直接拉他人文件/截图)
@router.get("/files/{key:path}")
def serve_local(key: str, e: str | None = None, s: str | None = None):
    if not storage.verify_local(key, e, s):
        raise HTTPException(403, "链接无效或已过期")
    base = os.path.abspath(storage.LOCAL_DIR)
    path = os.path.abspath(os.path.join(base, key))
    # 加分隔符防止 /uploads 前缀误配 /uploads_evil,且拦截 ../ 穿越
    if path != base and not path.startswith(base + os.sep):
        raise HTTPException(400, "非法路径")
    if not os.path.isfile(path):
        raise HTTPException(404, "文件不存在")
    return FileResponse(path)
