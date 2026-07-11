"""催拍待办中心:列表(商务看自己的,管理员看全部)、完成、手动触发扫描。"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_admin, current_user
from ..models import FollowUpTask, Influencer, User
from ..services import followup

router = APIRouter(prefix="/api/followups", tags=["followups"])


@router.get("")
def list_tasks(status: str = "open",
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = (select(FollowUpTask, Influencer)
            .join(Influencer, FollowUpTask.influencer_id == Influencer.id)
            .where(FollowUpTask.status == status)
            .order_by(FollowUpTask.created_at.desc()))
    if user.role != "admin":
        stmt = stmt.where(FollowUpTask.assignee_bd_id == user.id)
    return [{"id": t.id, "influencer_id": inf.id, "influencer_nickname": inf.nickname,
             "sample_order_id": t.sample_order_id, "note": t.note, "kind": t.kind,
             "status": t.status, "created_at": t.created_at.isoformat()}
            for t, inf in db.execute(stmt.limit(200)).all()]


@router.get("/open-count")
def open_count(user: User = Depends(current_user), db: Session = Depends(get_db)):
    from sqlalchemy import func
    stmt = select(func.count()).select_from(FollowUpTask).where(FollowUpTask.status == "open")
    if user.role != "admin":
        stmt = stmt.where(FollowUpTask.assignee_bd_id == user.id)
    return {"count": db.scalar(stmt) or 0}


@router.post("/{task_id}/done")
def mark_done(task_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    task = db.get(FollowUpTask, task_id)
    if not task:
        raise HTTPException(404, "待办不存在")
    if user.role != "admin" and task.assignee_bd_id != user.id:
        raise HTTPException(403, "只能处理派给自己的待办")
    task.status = "done"
    task.done_at = datetime.now()
    db.commit()
    return {"ok": True}


@router.post("/scan")
def scan(admin: User = Depends(current_admin), db: Session = Depends(get_db)):
    """管理员/定时任务触发扫描(生产接每日 cron)"""
    return {"created": followup.scan(db)}
