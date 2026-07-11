"""统一鉴权:手机验证码登录(角色由后台决定)+ 兼容旧账号密码登录(引导用)。

登录时角色解析:
- 手机号在管理员白名单(admin_phones)→ 确保管理员账号,发 staff 令牌
- 手机号对应内部账号(User)→ 发 staff 令牌(admin/bd)
- 否则 → 找/建达人(Influencer)→ 发 influencer 令牌
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import current_user, make_token
from ..models import Influencer, User
from ..security import verify_password
from ..services.sms import send_code, verify_code

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _admin_phones() -> set[str]:
    return {p.strip() for p in settings.admin_phones.split(",") if p.strip()}


class PhoneIn(BaseModel):
    phone: str


@router.post("/sms/send")
async def sms_send(body: PhoneIn, db: Session = Depends(get_db)):
    if len(body.phone) != 11 or not body.phone.startswith("1"):
        raise HTTPException(400, "手机号格式不正确")
    await send_code(db, body.phone)
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
    return {"token": make_token("influencer", inf.id), "kind": "influencer",
            "user": {"id": inf.id, "name": inf.nickname, "role": "influencer"}}


def _staff_result(user: User) -> dict:
    return {"token": make_token("staff", user.id), "kind": "staff",
            "user": {"id": user.id, "name": user.display_name, "role": user.role}}


# —— 兼容旧账号密码登录(引导/后备)——
class LoginIn(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.scalars(select(User).where(User.username == body.username)).first()
    if not user or not user.password_hash or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "用户名或密码错误")
    if not user.is_active:
        raise HTTPException(403, "账号已停用")
    return _staff_result(user)


@router.get("/me")
def me(user: User = Depends(current_user)):
    return {"id": user.id, "name": user.display_name, "role": user.role}
