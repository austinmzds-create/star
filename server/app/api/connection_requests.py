"""建联申请(方案B 需求4):商务对非归属达人发起建联,管理员审批,通过即转移归属。"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_admin, current_user
from ..models import ConnectionRequest, Influencer, User
from ..services.oplog import log_op

router = APIRouter(prefix="/api/connection-requests", tags=["connection-requests"])


class CreateIn(BaseModel):
    influencer_id: int
    reason: str | None = None


@router.post("")
def create_request(body: CreateIn, user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    """商务发起建联申请(仅针对非自己名下达人)。"""
    inf = db.get(Influencer, body.influencer_id)
    if not inf:
        raise HTTPException(404, "达人不存在")
    if inf.owner_bd_id == user.id:
        raise HTTPException(400, "该达人已归属于你,无需建联")
    dup = db.scalars(select(ConnectionRequest).where(
        ConnectionRequest.influencer_id == inf.id,
        ConnectionRequest.requester_bd_id == user.id,
        ConnectionRequest.status == "pending")).first()
    if dup:
        raise HTTPException(409, "你已提交过该达人的建联申请,请等待审批")
    req = ConnectionRequest(influencer_id=inf.id, requester_bd_id=user.id,
                            current_owner_bd_id=inf.owner_bd_id,
                            reason=(body.reason or None), status="pending")
    db.add(req)
    db.commit()
    return {"id": req.id}


def _serialize(req: ConnectionRequest, names: dict, inf_names: dict) -> dict:
    return {"id": req.id, "influencer_id": req.influencer_id,
            "influencer_nickname": inf_names.get(req.influencer_id),
            "requester_bd_id": req.requester_bd_id,
            "requester_name": names.get(req.requester_bd_id),
            "current_owner_bd_id": req.current_owner_bd_id,
            "current_owner_name": names.get(req.current_owner_bd_id),
            "reason": req.reason, "status": req.status,
            "review_note": req.review_note,
            "created_at": req.created_at.isoformat(),
            "reviewed_at": req.reviewed_at.isoformat() if req.reviewed_at else None}


@router.get("")
def list_requests(status: str | None = None, user: User = Depends(current_admin),
                  db: Session = Depends(get_db)):
    """管理员:建联申请列表(可按状态筛选)。"""
    stmt = select(ConnectionRequest).order_by(ConnectionRequest.created_at.desc())
    if status:
        stmt = stmt.where(ConnectionRequest.status == status)
    rows = db.scalars(stmt).all()
    uid = set()
    iid = set()
    for r in rows:
        uid.update([r.requester_bd_id, r.current_owner_bd_id])
        iid.add(r.influencer_id)
    names = {u.id: u.display_name for u in
             db.scalars(select(User).where(User.id.in_(uid or {0}))).all()}
    inf_names = {i.id: i.nickname for i in
                 db.scalars(select(Influencer).where(Influencer.id.in_(iid or {0}))).all()}
    return [_serialize(r, names, inf_names) for r in rows]


@router.get("/pending-count")
def pending_count(user: User = Depends(current_admin), db: Session = Depends(get_db)):
    from sqlalchemy import func
    n = db.scalar(select(func.count(ConnectionRequest.id))
                  .where(ConnectionRequest.status == "pending"))
    return {"count": n or 0}


class ReviewIn(BaseModel):
    approve: bool
    note: str | None = None


@router.post("/{req_id}/review")
def review(req_id: int, body: ReviewIn, user: User = Depends(current_admin),
           db: Session = Depends(get_db)):
    """管理员审批:通过 → 归属转给申请商务(旧商务失去写权限,仍可只读)。"""
    req = db.get(ConnectionRequest, req_id)
    if not req:
        raise HTTPException(404, "申请不存在")
    if req.status != "pending":
        raise HTTPException(400, "该申请已处理")
    req.reviewed_by = user.id
    req.review_note = body.note or None
    req.reviewed_at = datetime.now()
    if body.approve:
        inf = db.get(Influencer, req.influencer_id)
        if not inf:
            raise HTTPException(404, "达人不存在")
        old_owner = db.get(User, inf.owner_bd_id) if inf.owner_bd_id else None
        new_owner = db.get(User, req.requester_bd_id)
        inf.owner_bd_id = req.requester_bd_id
        req.status = "approved"
        log_op(db, influencer_id=inf.id, event_type="owner_transferred", actor=user,
               summary=f"建联通过:归属由 {old_owner.display_name if old_owner else '无'} "
                       f"转给 {new_owner.display_name if new_owner else ''}",
               detail={"old_owner_bd_id": req.current_owner_bd_id,
                       "new_owner_bd_id": req.requester_bd_id, "note": body.note})
    else:
        req.status = "rejected"
    db.commit()
    return {"ok": True, "status": req.status}


@router.post("/{req_id}/withdraw")
def withdraw(req_id: int, user: User = Depends(current_user),
             db: Session = Depends(get_db)):
    """申请人撤回自己的待审申请。"""
    req = db.get(ConnectionRequest, req_id)
    if not req or req.requester_bd_id != user.id:
        raise HTTPException(404, "申请不存在或无权限")
    if req.status != "pending":
        raise HTTPException(400, "该申请已处理,不能撤回")
    req.status = "withdrawn"
    db.commit()
    return {"ok": True}
