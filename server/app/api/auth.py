"""统一鉴权:手机验证码登录(角色由后台决定)+ 兼容旧账号密码登录(引导用)。

登录时角色解析:
- 手机号在管理员白名单(admin_phones)→ 确保管理员账号,发 staff 令牌
- 手机号对应内部账号(User)→ 发 staff 令牌(admin/bd)
- 否则 → 找/建达人(Influencer)→ 发 influencer 令牌
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import current_user, make_token
from ..models import Influencer, User
from ..security import (
    default_password_from_phone,
    hash_password,
    verify_login_password,
    verify_password,
)
from ..services.identity import normalize_douyin, normalize_phone
from ..services.sms import SmsError, send_code, verify_code

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _admin_phones() -> set[str]:
    phones = set()
    for raw in settings.admin_phones.split(","):
        phone = normalize_phone(raw)
        if phone:
            phones.add(phone)
    return phones


class PhoneIn(BaseModel):
    phone: str
    login_role: Literal["staff", "influencer"] | None = None


@router.post("/sms/send")
async def sms_send(body: PhoneIn, db: Session = Depends(get_db)):
    phone = normalize_phone(body.phone)
    if not phone:
        raise HTTPException(400, "手机号格式不正确")
    if body.login_role == "staff" and phone not in _admin_phones():
        user = db.scalars(select(User).where(User.phone == phone)).first()
        if not user:
            raise HTTPException(404, "该手机号不是商务/管理员账号")
        if not user.is_active:
            raise HTTPException(403, "账号已停用")
    if body.login_role == "influencer":
        inf = db.scalars(select(Influencer).where(Influencer.phone == phone)).first()
        if inf and inf.archived:
            raise HTTPException(403, "达人已停用")
    try:
        await send_code(db, phone)
    except SmsError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


class SmsLoginIn(BaseModel):
    phone: str
    code: str
    login_role: Literal["staff", "influencer"] | None = None


@router.post("/sms/login")
def sms_login(body: SmsLoginIn, db: Session = Depends(get_db)):
    phone = normalize_phone(body.phone)
    if not phone:
        raise HTTPException(400, "手机号格式不正确")
    if not verify_code(db, phone, body.code):
        raise HTTPException(400, "验证码错误或已过期")

    if body.login_role == "influencer":
        return _login_influencer_by_phone(db, phone, create_if_missing=True)

    # 1) 管理员白名单:确保存在管理员账号
    if phone in _admin_phones():
        user = db.scalars(select(User).where(User.phone == phone)).first()
        if not user:
            user = User(phone=phone, display_name="管理员", role="admin")
            db.add(user)
            db.commit()
        elif user.role != "admin":
            user.role = "admin"
            db.commit()
        return _staff_result(user)

    # 2) 内部账号(管理员/商务)
    user = db.scalars(select(User).where(User.phone == phone)).first()
    if user:
        if not user.is_active:
            raise HTTPException(403, "账号已停用")
        return _staff_result(user)

    if body.login_role == "staff":
        raise HTTPException(404, "该手机号不是商务/管理员账号")

    # 3) 达人:找或建
    return _login_influencer_by_phone(db, phone, create_if_missing=True)


def _staff_result(user: User) -> dict:
    return {"token": make_token("staff", user.id), "kind": "staff",
            "user": {"id": user.id, "name": user.display_name, "role": user.role}}


def _influencer_result(influencer: Influencer) -> dict:
    return {"token": make_token("influencer", influencer.id), "kind": "influencer",
            "user": {"id": influencer.id, "name": influencer.nickname,
                     "role": "influencer"}}


def _login_influencer_by_phone(db: Session, phone: str, create_if_missing: bool = False) -> dict:
    inf = db.scalars(
        select(Influencer)
        .where(Influencer.phone == phone)
        .order_by(Influencer.id)
    ).first()
    if not inf and create_if_missing:
        inf = Influencer(nickname=f"达人{phone[-4:]}", phone=phone, source="h5")
        db.add(inf)
        db.commit()
    if not inf:
        raise HTTPException(401, "账号或密码错误")
    if inf.archived:
        raise HTTPException(403, "账号已停用")
    return _influencer_result(inf)


def _find_influencer_for_password_login(db: Session, username: str) -> Influencer | None:
    """达人账号密码登录支持手机号或抖音号,手机号优先避免数字抖音号撞同号手机。"""
    username = (username or "").strip()
    if not username:
        return None
    phone = normalize_phone(username)
    if phone:
        inf = db.scalars(
            select(Influencer)
            .where(Influencer.phone == phone)
            .order_by(Influencer.id)
        ).first()
        if inf:
            return inf
    normalized_douyin = normalize_douyin(username)
    if not normalized_douyin:
        return None
    douyin_candidates = {normalized_douyin, username}
    if not normalized_douyin.startswith("@"):
        douyin_candidates.add(f"@{normalized_douyin}")
    return db.scalars(
        select(Influencer)
        .where(Influencer.douyin_id.in_(douyin_candidates))
        .order_by(Influencer.id)
    ).first()


def _verify_influencer_password(influencer: Influencer | None, password: str) -> tuple[bool, str | None]:
    """兼容历史手机号后6位默认密码,新口径优先使用抖音号作为初始密码。"""
    matched, upgraded_hash = verify_login_password(
        password,
        influencer.password_hash if influencer else None,
    )
    if matched or not influencer:
        return matched, upgraded_hash

    douyin_default = normalize_douyin(influencer.douyin_id)
    if not douyin_default or password != douyin_default:
        return False, None

    if not influencer.password_hash:
        return True, hash_password(password)
    if influencer.phone and verify_password(
        default_password_from_phone(influencer.phone),
        influencer.password_hash,
    ):
        return True, hash_password(password)
    return False, None


class DevSwitchIn(BaseModel):
    role: Literal["admin", "bd", "influencer"]


@router.post("/dev-switch", include_in_schema=False)
def dev_switch(
    body: DevSwitchIn,
    db: Session = Depends(get_db),
    actor: User = Depends(current_user),
):
    """管理员测试专用:签发预设角色的真实 token。"""
    if not (settings.debug or settings.enable_test_role_switcher):
        raise HTTPException(404, "Not Found")
    if actor.role != "admin":
        raise HTTPException(403, "仅管理员可切换测试身份")

    if body.role in ("admin", "bd"):
        user = db.scalars(
            select(User)
            .where(User.role == body.role, User.is_active.is_(True))
            .order_by(User.id)
        ).first()
        if not user and body.role == "bd":
            user = User(phone="13900000000", display_name="测试商务", role="bd")
            db.add(user)
            db.commit()
        if not user:
            raise HTTPException(404, "测试管理员不存在")
        return _staff_result(user)

    influencer = db.scalars(select(Influencer).order_by(Influencer.id)).first()
    if not influencer:
        influencer = Influencer(nickname="测试达人", phone="15000000000", source="h5")
        db.add(influencer)
        db.commit()
    return _influencer_result(influencer)


# —— 兼容旧账号密码登录(引导/后备)——
class LoginIn(BaseModel):
    username: str
    password: str
    login_role: Literal["staff", "influencer"] | None = None


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    username = (body.username or "").strip()
    normalized_phone = normalize_phone(username)
    is_phone = bool(normalized_phone) or (len(username) == 11 and username.startswith("1"))
    user = None
    if body.login_role != "influencer":
        if normalized_phone:
            user = db.scalars(select(User).where(User.phone == normalized_phone)).first()
        if not user and is_phone:
            user = db.scalars(select(User).where(User.phone == username)).first()
        if not user:
            user = db.scalars(select(User).where(User.username == username)).first()
    if user:
        matched, upgraded_hash = verify_login_password(
            body.password, user.password_hash
        )
        if not matched:
            raise HTTPException(401, "账号或密码错误")
        if not user.is_active:
            raise HTTPException(403, "账号已停用")
        if upgraded_hash:
            user.password_hash = upgraded_hash
            db.commit()
        return _staff_result(user)
    if body.login_role == "staff":
        verify_login_password(body.password, None)
        raise HTTPException(401, "账号或密码错误")

    influencer = _find_influencer_for_password_login(db, body.username)
    matched, upgraded_hash = _verify_influencer_password(influencer, body.password)
    if not matched:
        raise HTTPException(401, "账号或密码错误")
    if influencer.archived:
        raise HTTPException(403, "账号已停用")
    if upgraded_hash:
        influencer.password_hash = upgraded_hash
        db.commit()
    return _influencer_result(influencer)


@router.get("/me")
def me(user: User = Depends(current_user)):
    return {"id": user.id, "name": user.display_name, "role": user.role}
