"""统一鉴权:手机验证码登录(角色由后台决定)+ 兼容旧账号密码登录(引导用)。

登录时角色解析:
- 手机号在管理员白名单(admin_phones)→ 确保管理员账号,发 staff 令牌
- 手机号对应内部账号(User)→ 发 staff 令牌(admin/bd)
- 否则 → 找/建达人(Influencer)→ 发 influencer 令牌
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import current_user, make_token
from ..models import Influencer, User
from ..security import verify_password
from ..services.sms import SmsError, send_code, verify_code

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _admin_phones() -> set[str]:
    return {p.strip() for p in settings.admin_phones.split(",") if p.strip()}


class PhoneIn(BaseModel):
    phone: str


@router.post("/sms/send")
async def sms_send(body: PhoneIn, db: Session = Depends(get_db)):
    if len(body.phone) != 11 or not body.phone.startswith("1"):
        raise HTTPException(400, "手机号格式不正确")
    try:
        await send_code(db, body.phone)
    except SmsError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


class SmsLoginIn(BaseModel):
    phone: str
    code: str


@router.post("/sms/login")
def sms_login(body: SmsLoginIn, db: Session = Depends(get_db)):
    if not verify_code(db, body.phone, body.code):
        raise HTTPException(400, "验证码错误或已过期")

    # 1) 管理员白名单:确保存在管理员账号
    if body.phone in _admin_phones():
        user = db.scalars(select(User).where(User.phone == body.phone)).first()
        if not user:
            user = User(phone=body.phone, display_name="管理员", role="admin")
            db.add(user)
            db.commit()
        elif user.role != "admin":
            user.role = "admin"
            db.commit()
        return _staff_result(user)

    # 2) 内部账号(管理员/商务)
    user = db.scalars(select(User).where(User.phone == body.phone)).first()
    if user:
        if not user.is_active:
            raise HTTPException(403, "账号已停用")
        return _staff_result(user)

    # 3) 达人:找或建
    inf = db.scalars(select(Influencer).where(Influencer.phone == body.phone)).first()
    if not inf:
        inf = Influencer(nickname=f"达人{body.phone[-4:]}", phone=body.phone, source="h5")
        db.add(inf)
        db.commit()
    return _influencer_result(inf)


def _staff_result(user: User) -> dict:
    return {"token": make_token("staff", user.id), "kind": "staff",
            "user": {"id": user.id, "name": user.display_name, "role": user.role}}


def _influencer_result(influencer: Influencer) -> dict:
    return {"token": make_token("influencer", influencer.id), "kind": "influencer",
            "user": {"id": influencer.id, "name": influencer.nickname,
                     "role": "influencer"}}


class DevSwitchIn(BaseModel):
    role: Literal["admin", "bd", "influencer"]


@router.post("/dev-switch", include_in_schema=False)
def dev_switch(body: DevSwitchIn, db: Session = Depends(get_db)):
    """本地测试专用:签发预设角色的真实 token；生产环境不可用。"""
    if not settings.debug:
        raise HTTPException(404, "Not Found")

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


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.scalars(
        select(User).where(
            or_(User.username == body.username, User.phone == body.username)
        )
    ).first()
    if user:
        if not user.password_hash or not verify_password(body.password, user.password_hash):
            raise HTTPException(401, "账号或密码错误")
        if not user.is_active:
            raise HTTPException(403, "账号已停用")
        return _staff_result(user)

    influencer = db.scalars(
        select(Influencer)
        .where(Influencer.phone == body.username)
        .order_by(Influencer.id)
    ).first()
    if (not influencer or not influencer.password_hash
            or not verify_password(body.password, influencer.password_hash)):
        raise HTTPException(401, "账号或密码错误")
    if influencer.archived:
        raise HTTPException(403, "账号已停用")
    return _influencer_result(influencer)


@router.get("/me")
def me(user: User = Depends(current_user)):
    return {"id": user.id, "name": user.display_name, "role": user.role}
