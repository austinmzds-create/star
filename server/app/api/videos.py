"""视频审核(登记→审核 approve/reject/blocked)+ 投流状态机(Promotion)。

参考 samples.py:list 用多表 join、状态机式端点、current_user 分权(商务只见自己达人)。
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user
from ..models import (Cooperation, Influencer, Product, Promotion, User,
                      VideoTask)

# ============================ 视频审核 ============================

router = APIRouter(prefix="/api/videos", tags=["videos"])


class CreateVideoIn(BaseModel):
    cooperation_id: int
    product_id: int
    dy_url: str | None = None


@router.post("")
def create_video(body: CreateVideoIn,
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    """登记一条视频任务(status 默认 submitted)。"""
    coop = db.get(Cooperation, body.cooperation_id)
    if not coop:
        raise HTTPException(404, "合作轮次不存在")
    task = VideoTask(cooperation_id=body.cooperation_id, product_id=body.product_id,
                     dy_url=body.dy_url)
    # TODO: 后台任务下载抖音原视频转存 OSS,回填 saved_oss_key(防链接失效/投流留证);此处不实现下载。
    db.add(task)
    db.commit()
    return {"id": task.id}


@router.get("")
def list_videos(status: str | None = None,
                user: User = Depends(current_user), db: Session = Depends(get_db)):
    """视频任务列表(商务只见自己达人;管理员全量)。status 可选过滤。"""
    stmt = (select(VideoTask, Cooperation, Influencer, Product)
            .join(Cooperation, VideoTask.cooperation_id == Cooperation.id)
            .join(Influencer, Cooperation.influencer_id == Influencer.id)
            .join(Product, VideoTask.product_id == Product.id)
            .order_by(VideoTask.created_at.desc()))
    if user.role != "admin":
        stmt = stmt.where(Influencer.owner_bd_id == user.id)
    if status:
        stmt = stmt.where(VideoTask.status == status)
    out = []
    for task, coop, inf, prod in db.execute(stmt.limit(300)).all():
        out.append({
            "id": task.id, "status": task.status, "blocked": task.blocked,
            "influencer_id": inf.id, "influencer_nickname": inf.nickname,
            "product_id": prod.id, "product_name": prod.name,
            "round_no": coop.round_no,
            "dy_url": task.dy_url,
            "audit_result": task.audit_result,
            "created_at": task.created_at.isoformat(),
        })
    return out


@router.get("/status-counts")
def status_counts(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """按 status 计数(商务只算自己达人),供前端分栏。"""
    stmt = (select(VideoTask.status, func.count())
            .join(Cooperation, VideoTask.cooperation_id == Cooperation.id)
            .join(Influencer, Cooperation.influencer_id == Influencer.id)
            .group_by(VideoTask.status))
    if user.role != "admin":
        stmt = stmt.where(Influencer.owner_bd_id == user.id)
    return {status: count for status, count in db.execute(stmt).all()}


class AuditVideoIn(BaseModel):
    approve: bool
    reject_reason: str | None = None
    blocked: bool = False
    time_comments: list | None = None  # 时间点评论:[{"t": "00:12", "text": "..."}]


@router.post("/{task_id}/audit")
def audit_video(task_id: int, body: AuditVideoIn,
                user: User = Depends(current_user), db: Session = Depends(get_db)):
    """审核视频:approve→approved;否则 rejected 或 blocked(卡审)。"""
    task = db.get(VideoTask, task_id)
    if not task:
        raise HTTPException(404, "视频任务不存在")
    if task.status not in ("submitted", "rejected", "blocked"):
        raise HTTPException(400, "该视频已通过,无需重复审核")

    # 记录审核轨迹与时间点评论到 audit_result JSON
    result = dict(task.audit_result or {})
    records = list(result.get("records", []))
    if body.approve:
        task.status = "approved"
        task.blocked = False
        action = "approved"
    elif body.blocked:
        task.status = "blocked"
        task.blocked = True
        action = "blocked"
    else:
        task.status = "rejected"
        task.blocked = False
        action = "rejected"
    records.append({"by": user.id, "action": action, "reason": body.reject_reason})
    result["records"] = records
    if body.time_comments is not None:
        result["time_comments"] = body.time_comments
    task.audit_result = result
    db.commit()
    return {"ok": True, "status": task.status}


# ============================ 投流状态机 ============================

promotion_router = APIRouter(prefix="/api/promotions", tags=["promotions"])

# 合法流转表:{当前状态: {action: 目标状态}}
TRANSITIONS = {
    "pending_request": {"request_auth": "pending_confirm", "mark_promoted": "promoted"},
    "pending_confirm": {"confirm_auth": "authorized", "refuse": "refused"},
    "authorized": {"mark_promoted": "promoted", "mark_failed": "failed"},
    "promoted": {"done": "done", "mark_failed": "failed"},
    "failed": {"mark_promoted": "promoted"},  # 重试
}


class CreatePromotionIn(BaseModel):
    video_task_id: int


@promotion_router.post("")
def create_promotion(body: CreatePromotionIn,
                     user: User = Depends(current_user), db: Session = Depends(get_db)):
    """为某 video_task 发起投流。mode_snapshot 取该达人当前 promo_mode 快照进来。"""
    task = db.get(VideoTask, body.video_task_id)
    if not task:
        raise HTTPException(404, "视频任务不存在")
    coop = db.get(Cooperation, task.cooperation_id)
    if not coop:
        raise HTTPException(400, "视频任务未关联合作轮次")
    inf = db.get(Influencer, coop.influencer_id)
    if not inf:
        raise HTTPException(400, "达人不存在")
    promo = Promotion(video_task_id=task.id, mode_snapshot=inf.promo_mode,
                      auth_status="pending_request")
    db.add(promo)
    db.commit()
    return {"id": promo.id, "auth_status": promo.auth_status,
            "mode_snapshot": promo.mode_snapshot}


class TransitionIn(BaseModel):
    action: str
    fail_reason: str | None = None
    fail_proof_oss_key: str | None = None


@promotion_router.post("/{promo_id}/transition")
def transition(promo_id: int, body: TransitionIn,
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    """状态机流转,带合法流转校验(非法 action 报 400)。"""
    promo = db.get(Promotion, promo_id)
    if not promo:
        raise HTTPException(404, "投流记录不存在")
    allowed = TRANSITIONS.get(promo.auth_status, {})
    if body.action not in allowed:
        raise HTTPException(400,
                            f"当前状态 {promo.auth_status} 不支持操作 {body.action}")
    promo.auth_status = allowed[body.action]
    if body.action == "mark_failed":
        promo.fail_reason = body.fail_reason
        promo.fail_proof_oss_key = body.fail_proof_oss_key
    db.commit()
    return {"ok": True, "auth_status": promo.auth_status}


@promotion_router.get("")
def list_promotions(auth_status: str | None = None,
                    user: User = Depends(current_user), db: Session = Depends(get_db)):
    """投流列表(商务只见自己达人)。auth_status 可选过滤。"""
    stmt = (select(Promotion, Influencer, Product, VideoTask)
            .join(VideoTask, Promotion.video_task_id == VideoTask.id)
            .join(Cooperation, VideoTask.cooperation_id == Cooperation.id)
            .join(Influencer, Cooperation.influencer_id == Influencer.id)
            .join(Product, VideoTask.product_id == Product.id)
            .order_by(Promotion.created_at.desc()))
    if user.role != "admin":
        stmt = stmt.where(Influencer.owner_bd_id == user.id)
    if auth_status:
        stmt = stmt.where(Promotion.auth_status == auth_status)
    out = []
    for promo, inf, prod, vt in db.execute(stmt.limit(300)).all():
        out.append({
            "id": promo.id, "auth_status": promo.auth_status,
            "mode_snapshot": promo.mode_snapshot,
            "influencer_id": inf.id, "influencer_nickname": inf.nickname,
            "fans_count": inf.fans_count,
            "douyin_id": inf.douyin_id, "douyin_uid": inf.douyin_uid,
            "cooperation_code": inf.cooperation_code,
            "product_id": prod.id, "product_name": prod.name,
            "dy_url": vt.dy_url, "fail_reason": promo.fail_reason,
            "created_at": promo.created_at.isoformat(),
        })
    return out
