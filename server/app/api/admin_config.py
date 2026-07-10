"""配置中心(管理员):等级权益(版本化)、催拍天数、拒绝理由库、商务账号。"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_admin
from ..models import LevelBenefitConfig, RejectReason, SystemConfig, User
from ..security import hash_password
from ..services import levels

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/level-configs")
def level_configs(admin: User = Depends(current_admin), db: Session = Depends(get_db)):
    out = []
    for level in ("L1", "L2", "L3"):
        cfg = levels.effective_config(db, level)
        if cfg:
            out.append({"level": level, "version": cfg.version,
                        "commission_tier": float(cfg.commission_tier),
                        "max_sample_products": cfg.max_sample_products,
                        "video_audit_required": cfg.video_audit_required,
                        "effective_at": cfg.effective_at.isoformat()})
    return out


class LevelConfigIn(BaseModel):
    commission_tier: float | None = None
    max_sample_products: int | None = None
    video_audit_required: bool | None = None


@router.put("/level-configs/{level}")
def update_level_config(level: str, body: LevelConfigIn,
                        admin: User = Depends(current_admin), db: Session = Depends(get_db)):
    """插入新版本 —— 只影响之后新产生的业务记录(快照语义)"""
    from decimal import Decimal
    fields = body.model_dump()
    if fields.get("commission_tier") is not None:
        fields["commission_tier"] = Decimal(str(fields["commission_tier"]))
    row = levels.update_config(db, level, admin.id, **fields)
    return {"level": level, "version": row.version}


class SysConfigIn(BaseModel):
    value: dict


@router.put("/system-configs/{key}")
def set_system_config(key: str, body: SysConfigIn,
                      admin: User = Depends(current_admin), db: Session = Depends(get_db)):
    """如 follow_up_days: {\"days\": 7}(签收催拍天数,已拍板默认1周可动态调)"""
    db.merge(SystemConfig(key=key, value=body.value, updated_by=admin.id))
    db.commit()
    return {"ok": True}


@router.get("/system-configs/{key}")
def get_system_config(key: str, admin: User = Depends(current_admin),
                      db: Session = Depends(get_db)):
    row = db.get(SystemConfig, key)
    return {"key": key, "value": row.value if row else None}


class ReasonIn(BaseModel):
    text: str
    scene: str = "sample"


@router.post("/reject-reasons")
def add_reason(body: ReasonIn, admin: User = Depends(current_admin),
               db: Session = Depends(get_db)):
    r = RejectReason(**body.model_dump())
    db.add(r)
    db.commit()
    return {"id": r.id}


class BdIn(BaseModel):
    username: str
    password: str
    display_name: str


@router.post("/bd-users")
def create_bd(body: BdIn, admin: User = Depends(current_admin), db: Session = Depends(get_db)):
    u = User(username=body.username, password_hash=hash_password(body.password),
             display_name=body.display_name, role="bd")
    db.add(u)
    db.commit()
    return {"id": u.id}


@router.get("/bd-users")
def list_bd(admin: User = Depends(current_admin), db: Session = Depends(get_db)):
    rows = db.scalars(select(User).where(User.role == "bd")).all()
    return [{"id": u.id, "username": u.username, "display_name": u.display_name,
             "is_active": u.is_active} for u in rows]
