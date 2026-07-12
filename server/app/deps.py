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
    # 决策(2026-07 v0.4):商务只管自己的达人;配置中心/商务管理/全员看板 收归管理员专属
    if user.role != "admin":
        raise HTTPException(403, "该操作仅管理员可用")
    return user


def owns_or_admin(user: User, owner_bd_id: int | None) -> bool:
    """管理员看全部;商务只允许操作自己名下(owner_bd_id==本人)的数据。"""
    return user.role == "admin" or owner_bd_id == user.id


def current_influencer(authorization: str = Header(""), db: Session = Depends(get_db)) -> Influencer:
    """达人 H5 端(手机号验证码换 token)"""
    token = authorization.removeprefix("Bearer ").strip()
    inf = db.get(Influencer, _load_token(token, "influencer"))
    if not inf:
        raise HTTPException(401, "达人不存在")
    return inf
