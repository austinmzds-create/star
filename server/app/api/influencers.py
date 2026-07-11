"""达人库:智能录入(粘贴解析)、档案、定级(留痕)、商务归属。"""
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_admin, current_user
from ..models import Influencer, LevelChangeLog, User
from ..services import levels
from ..services.parser import parse_influencer_text

router = APIRouter(prefix="/api/influencers", tags=["influencers"])

TRACKED_FIELDS = ("level", "commission_tier", "promo_mode", "owner_bd_id")


def scope(db_query, user: User):
    """商务只见自己的达人;管理员全量"""
    if user.role == "admin":
        return db_query
    return db_query.where(Influencer.owner_bd_id == user.id)


class ParseIn(BaseModel):
    text: str


@router.post("/parse")
async def parse(body: ParseIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """粘贴自我介绍 → 解析字段 + 撞库查重(老达人提示第N次合作)"""
    result = await parse_influencer_text(body.text)
    f = result["fields"]
    dup = None
    conds = [c for c in (
        Influencer.douyin_uid == f.get("douyin_uid") if f.get("douyin_uid") else None,
        Influencer.douyin_id == f.get("douyin_id") if f.get("douyin_id") else None,
        Influencer.phone == f.get("phone") if f.get("phone") else None,
    ) if c is not None]
    if conds:
        existing = db.scalars(select(Influencer).where(or_(*conds))).first()
        if existing:
            dup = {"id": existing.id, "nickname": existing.nickname,
                   "round_count": len(existing.cooperations),
                   "owner_bd_id": existing.owner_bd_id}
    return {**result, "duplicate": dup}


class CreateIn(BaseModel):
    nickname: str
    douyin_id: str | None = None
    douyin_uid: str | None = None
    homepage_url: str | None = None
    real_name: str | None = None
    phone: str | None = None
    fans_count: int | None = None
    gmv_30d: int | None = None
    category_tags: list[str] | None = None
    shoot_type: str | None = None
    raw_intro: str | None = None
    cooperation_code: str | None = None
    default_address: str | None = None
    homepage_raw: str | None = None
    level: str = "L1"
    source: str = "bd"


@router.post("")
def create(body: CreateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    cfg = levels.effective_config(db, body.level)
    inf = Influencer(**body.model_dump(),
                     commission_tier=cfg.commission_tier if cfg else Decimal("5"),
                     owner_bd_id=user.id)
    db.add(inf)
    db.commit()
    levels.new_cooperation(db, inf)  # 录入即开第1轮合作(写入快照)
    return {"id": inf.id}


@router.get("")
def list_influencers(q: str | None = None, level: str | None = None,
                     commission_tier: float | None = None,
                     user: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = scope(select(Influencer), user).order_by(Influencer.updated_at.desc())
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Influencer.nickname.like(like), Influencer.douyin_id.like(like),
                              Influencer.douyin_uid.like(like), Influencer.phone.like(like)))
    if level:
        stmt = stmt.where(Influencer.level == level)
    if commission_tier is not None:
        stmt = stmt.where(Influencer.commission_tier == Decimal(str(commission_tier)))
    rows = db.scalars(stmt.limit(200)).all()
    return [{"id": r.id, "nickname": r.nickname, "douyin_id": r.douyin_id,
             "fans_count": r.fans_count, "gmv_30d": r.gmv_30d, "level": r.level,
             "commission_tier": float(r.commission_tier), "promo_mode": r.promo_mode,
             "tags": r.tags, "round_count": len(r.cooperations),
             "owner_bd_id": r.owner_bd_id} for r in rows]


class UpdateIn(BaseModel):
    level: str | None = None
    commission_tier: float | None = None
    promo_mode: str | None = None
    owner_bd_id: int | None = None  # 转移分配:仅管理员
    tags: list[str] | None = None
    gmv_30d: int | None = None
    shoot_type: str | None = None
    reason: str | None = None       # 调级/调档原因(留痕)


@router.patch("/{influencer_id}")
def update(influencer_id: int, body: UpdateIn,
           user: User = Depends(current_user), db: Session = Depends(get_db)):
    inf = db.scalars(scope(select(Influencer).where(Influencer.id == influencer_id), user)).first()
    if not inf:
        raise HTTPException(404, "达人不存在或无权限")
    if body.owner_bd_id is not None and user.role != "admin":
        raise HTTPException(403, "转移达人需要管理员权限")

    for field in TRACKED_FIELDS:
        new_val = getattr(body, field, None)
        if new_val is None:
            continue
        old_val = getattr(inf, field)
        if str(old_val) != str(new_val):
            db.add(LevelChangeLog(influencer_id=inf.id, field=field,
                                  old_value=str(old_val), new_value=str(new_val),
                                  reason=body.reason, changed_by=user.id))
            setattr(inf, field, new_val if field != "commission_tier" else Decimal(str(new_val)))
        # 调级时联动默认佣金档(可再被单独覆盖)
        if field == "level" and body.commission_tier is None:
            cfg = levels.effective_config(db, str(new_val))
            if cfg:
                inf.commission_tier = cfg.commission_tier
    for field in ("tags", "gmv_30d", "shoot_type"):
        if getattr(body, field) is not None:
            setattr(inf, field, getattr(body, field))
    db.commit()
    return {"ok": True}


@router.get("/{influencer_id}")
def detail(influencer_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inf = db.scalars(scope(select(Influencer).where(Influencer.id == influencer_id), user)).first()
    if not inf:
        raise HTTPException(404, "达人不存在或无权限")
    logs = db.scalars(select(LevelChangeLog).where(LevelChangeLog.influencer_id == inf.id)
                      .order_by(LevelChangeLog.changed_at.desc()).limit(50)).all()
    return {
        "id": inf.id, "nickname": inf.nickname, "douyin_id": inf.douyin_id,
        "douyin_uid": inf.douyin_uid, "homepage_url": inf.homepage_url,
        "real_name": inf.real_name, "phone": inf.phone,
        "fans_count": inf.fans_count, "gmv_30d": inf.gmv_30d,
        "category_tags": inf.category_tags, "shoot_type": inf.shoot_type,
        "level": inf.level, "commission_tier": float(inf.commission_tier),
        "promo_mode": inf.promo_mode, "tags": inf.tags, "source": inf.source,
        "raw_intro": inf.raw_intro, "owner_bd_id": inf.owner_bd_id,
        "cooperation_code": inf.cooperation_code, "default_address": inf.default_address,
        "homepage_raw": inf.homepage_raw,
        "cooperations": [{"id": c.id, "round_no": c.round_no, "status": c.status,
                          "level_snapshot": c.level_snapshot,
                          "commission_tier_snapshot": float(c.commission_tier_snapshot),
                          "created_at": c.created_at.isoformat()} for c in inf.cooperations],
        "change_logs": [{"field": l.field, "old": l.old_value, "new": l.new_value,
                         "reason": l.reason, "at": l.changed_at.isoformat()} for l in logs],
    }
