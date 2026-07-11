"""登录态:签名 token(itsdangerous),内部端与达人 H5 分开两套。"""
from fastapi import Depends, Header, HTTPException
from itsdangerous import BadSignature, URLSafeTimedSerializer
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import Influencer, User

TOKEN_MAX_AGE = 7 * 24 * 3600
_serializer = URLSafeTimedSerializer(settings.secret_key)


def make_token(kind: str, subject_id: int) -> str:
    return _serializer.dumps({"kind": kind, "id": subject_id})


def _load_token(token: str, kind: str) -> int:
    try:
        data = _serializer.loads(token, max_age=TOKEN_MAX_AGE)
    except BadSignature:
        raise HTTPException(401, "登录已过期,请重新登录")
    if data.get("kind") != kind:
        raise HTTPException(401, "无效凭证")
    return data["id"]


def current_user(authorization: str = Header(""), db: Session = Depends(get_db)) -> User:
    """内部端(管理员/商务)"""
    token = authorization.removeprefix("Bearer ").strip()
    user = db.get(User, _load_token(token, "staff"))
    if not user or not user.is_active:
        raise HTTPException(401, "账号不存在或已停用")
    return user


def current_admin(user: User = Depends(current_user)) -> User:
    # 决策(2026-07):商务权限暂时 = 管理员,内部账号(admin/bd)均可
    if user.role not in ("admin", "bd"):
        raise HTTPException(403, "需要内部账号权限")
    return user


def current_influencer(authorization: str = Header(""), db: Session = Depends(get_db)) -> Influencer:
    """达人 H5 端(手机号验证码换 token)"""
    token = authorization.removeprefix("Bearer ").strip()
    inf = db.get(Influencer, _load_token(token, "influencer"))
    if not inf:
        raise HTTPException(401, "达人不存在")
    return inf
