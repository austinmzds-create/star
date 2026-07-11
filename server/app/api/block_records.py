"""卡审知识库:内部端沉淀违规/卡审记录(截图+文案+违规类型),可加星置顶;
达人 H5 端"拍摄前必读"只读展示近30天与所有加星记录。对应会议纪要相关需求。
"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_admin, current_influencer, current_user
from ..models import BlockRecord, Influencer, User
from ..services import storage

router = APIRouter(prefix="/api/block-records", tags=["block-records"])


def _serialize(r: BlockRecord) -> dict:
    return {
        "id": r.id,
        "product_id": r.product_id,
        "text": r.text,
        "tag": r.tag,
        "starred": r.starred,
        "happened_at": r.happened_at,
        "screenshot_url": storage.signed_url(r.screenshot_oss_key) if r.screenshot_oss_key else None,
    }


class BlockRecordIn(BaseModel):
    product_id: int | None = None
    text: str | None = None
    tag: str | None = None
    screenshot_oss_key: str | None = None
    happened_at: datetime | None = None


@router.post("")
def create(body: BlockRecordIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """创建卡审记录(管理员/商务均可)"""
    data = body.model_dump()
    if data.get("happened_at") is None:
        data.pop("happened_at", None)  # 用模型默认 now
    r = BlockRecord(**data)
    db.add(r)
    db.commit()
    return {"id": r.id}


@router.get("")
def list_records(days: int | None = None, product_id: int | None = None,
                 tag: str | None = None, starred: bool | None = None,
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    """列表:近 N 天(happened_at)/产品/违规类型/只看加星 筛选;加星置顶再按时间倒序"""
    stmt = select(BlockRecord)
    if days is not None:
        stmt = stmt.where(BlockRecord.happened_at >= datetime.now() - timedelta(days=days))
    if product_id is not None:
        stmt = stmt.where(BlockRecord.product_id == product_id)
    if tag is not None:
        stmt = stmt.where(BlockRecord.tag == tag)
    if starred is not None:
        stmt = stmt.where(BlockRecord.starred == starred)
    stmt = stmt.order_by(BlockRecord.starred.desc(), BlockRecord.happened_at.desc())
    return [_serialize(r) for r in db.scalars(stmt).all()]


@router.get("/tags")
def list_tags(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """去重的违规类型列表(供前端筛选下拉)"""
    rows = db.scalars(select(BlockRecord.tag).where(BlockRecord.tag.isnot(None)).distinct()).all()
    return sorted(rows)


class StarIn(BaseModel):
    starred: bool


@router.post("/{record_id}/star")
def toggle_star(record_id: int, body: StarIn,
                user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = db.get(BlockRecord, record_id)
    if not r:
        raise HTTPException(404, "记录不存在")
    r.starred = body.starred
    db.commit()
    return {"ok": True, "starred": r.starred}


@router.delete("/{record_id}")
def delete(record_id: int, admin: User = Depends(current_admin), db: Session = Depends(get_db)):
    r = db.get(BlockRecord, record_id)
    if not r:
        raise HTTPException(404, "记录不存在")
    db.delete(r)
    db.commit()
    return {"ok": True}


# ---------- 达人 H5 端(只读)----------

h5_router = APIRouter(prefix="/api/h5", tags=["h5"])


@h5_router.get("/notice")
def notice(inf: Influencer = Depends(current_influencer), db: Session = Depends(get_db)):
    """达人端"拍摄前必读":近30天 + 所有加星记录(合并去重,加星置顶);无删除权限"""
    since = datetime.now() - timedelta(days=30)
    stmt = select(BlockRecord).where(
        (BlockRecord.happened_at >= since) | (BlockRecord.starred.is_(True))
    ).order_by(BlockRecord.starred.desc(), BlockRecord.happened_at.desc())
    return [_serialize(r) for r in db.scalars(stmt).all()]
