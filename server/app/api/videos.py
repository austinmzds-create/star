"""视频审核(登记→审核 approve/reject/blocked)+ 投流状态机(Promotion)。

参考 samples.py:list 用多表 join、状态机式端点、current_user 分权(商务只见自己达人)。
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user, owns_or_admin
from ..models import (Cooperation, Influencer, Material, MaterialDownloadLog,
                      MaterialReadState, Product, Promotion, User, VideoTask)
from ..services import storage
from ..services.oplog import influencer_id_for_coop, log_op

# 投流失败凭证截图张数上限(与前端 MultiUpload :max 对齐,后端兜底防滥用)
MAX_FAIL_PROOFS = 6

# 进行中的投流状态:同一视频若已有此类投流,禁止重复发起
PROMO_ACTIVE_STATES = {"pending_request", "pending_confirm", "authorized", "promoted"}
# 有授权/投流/凭证的状态:删除视频前必须先在投流中处理,避免连带抹掉留证
PROMO_PROTECTED_STATES = {"authorized", "promoted", "done", "failed"}


def _fail_proof_keys(promo: Promotion) -> list[str]:
    """失败凭证 key 列表:优先新数组列,回退旧单值列(历史数据)。"""
    if promo.fail_proof_oss_keys:
        return list(promo.fail_proof_oss_keys)
    return [promo.fail_proof_oss_key] if promo.fail_proof_oss_key else []


def _load_owned_task(db, user, task_id):
    """加载视频任务并校验归属(商务只操作自己名下达人)。"""
    task = db.get(VideoTask, task_id)
    if not task:
        raise HTTPException(404, "视频任务不存在")
    coop = db.get(Cooperation, task.cooperation_id)
    inf = db.get(Influencer, coop.influencer_id) if coop else None
    if not owns_or_admin(user, inf.owner_bd_id if inf else None):
        raise HTTPException(403, "无权操作该视频任务")
    return task


def _load_owned_promo(db, user, promo_id):
    """加载投流记录并校验归属。"""
    promo = db.get(Promotion, promo_id)
    if not promo:
        raise HTTPException(404, "投流记录不存在")
    task = db.get(VideoTask, promo.video_task_id)
    coop = db.get(Cooperation, task.cooperation_id) if task else None
    inf = db.get(Influencer, coop.influencer_id) if coop else None
    if not owns_or_admin(user, inf.owner_bd_id if inf else None):
        raise HTTPException(403, "无权操作该投流记录")
    return promo

# ============================ 视频审核 ============================

router = APIRouter(prefix="/api/videos", tags=["videos"])


class CreateVideoIn(BaseModel):
    product_id: int
    influencer_id: int | None = None   # 传达人则自动解析其最新合作轮次(前端首选)
    cooperation_id: int | None = None  # 或直接指定合作轮次(兼容)
    dy_url: str | None = None
    oss_key: str | None = None
    submit_note: str | None = None


@router.post("")
def create_video(body: CreateVideoIn,
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    """登记一条视频任务(status 默认 submitted)。可传 influencer_id 自动取最新合作轮次。"""
    if body.cooperation_id:
        coop = db.get(Cooperation, body.cooperation_id)
    elif body.influencer_id:
        coop = db.scalars(select(Cooperation)
                          .where(Cooperation.influencer_id == body.influencer_id)
                          .order_by(Cooperation.round_no.desc()).limit(1)).first()
    else:
        raise HTTPException(400, "需指定达人或合作轮次")
    if not coop:
        raise HTTPException(404, "合作轮次不存在(该达人可能尚未建档)")
    if not db.get(Product, body.product_id):
        raise HTTPException(404, "产品不存在")
    inf = db.get(Influencer, coop.influencer_id)
    if user.role != "admin" and (not inf or inf.owner_bd_id != user.id):
        raise HTTPException(403, "只能给自己名下的达人登记视频")
    task = VideoTask(cooperation_id=coop.id, product_id=body.product_id,
                     dy_url=(body.dy_url or None),
                     saved_oss_key=(body.oss_key or None),
                     submit_note=(body.submit_note or None))
    # TODO: 后台任务下载抖音原视频转存 OSS,回填 saved_oss_key(防链接失效/投流留证);此处不实现下载。
    db.add(task)
    prod = db.get(Product, body.product_id)
    log_op(db, influencer_id=coop.influencer_id, product_id=body.product_id,
           event_type="video_registered", actor=user,
           summary=f"{user.display_name} 登记视频:{prod.name if prod else ''}")
    db.commit()
    return {"id": task.id}


@router.delete("/{task_id}")
def delete_video(task_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """删除视频任务(连带其投流记录)。存在授权/投流/失败凭证的投流需先处理,不能连带静默抹掉。"""
    task = _load_owned_task(db, user, task_id)
    promos = db.scalars(select(Promotion).where(Promotion.video_task_id == task.id)).all()
    if any(p.auth_status in PROMO_PROTECTED_STATES for p in promos):
        raise HTTPException(400, "该视频存在授权/投流记录,请先在投流中处理后再删除")
    inf_id = influencer_id_for_coop(db, task.cooperation_id)
    linked_materials = db.scalars(select(Material).where(Material.video_task_id == task.id)).all()
    linked_material_ids = [m.id for m in linked_materials]
    if linked_material_ids:
        db.query(MaterialReadState).filter(MaterialReadState.material_id.in_(linked_material_ids)).delete(
            synchronize_session=False)
        db.query(MaterialDownloadLog).filter(MaterialDownloadLog.material_id.in_(linked_material_ids)).delete(
            synchronize_session=False)
    for m in linked_materials:
        db.delete(m)
    for p in promos:
        db.delete(p)
    db.delete(task)
    if inf_id:
        log_op(db, influencer_id=inf_id, product_id=task.product_id,
               event_type="video_deleted", actor=user,
               summary=f"{user.display_name} 删除视频任务(含 {len(promos)} 条未生效投流)")
    db.commit()
    return {"ok": True}


@router.get("")
def list_videos(status: str | None = None, q: str | None = None,
                page: int = 1, page_size: int = 50,
                user: User = Depends(current_user), db: Session = Depends(get_db)):
    """视频任务列表(商务只见自己达人;管理员全量)。status 过滤 + q 搜索 + 分页。"""
    from sqlalchemy import or_
    stmt = (select(VideoTask, Cooperation, Influencer, Product)
            .join(Cooperation, VideoTask.cooperation_id == Cooperation.id)
            .join(Influencer, Cooperation.influencer_id == Influencer.id)
            .join(Product, VideoTask.product_id == Product.id))
    if user.role != "admin":
        stmt = stmt.where(Influencer.owner_bd_id == user.id)
    if status:
        stmt = stmt.where(VideoTask.status == status)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Influencer.nickname.like(like), Product.name.like(like)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    page = max(1, page)
    page_size = min(max(1, page_size), 200)
    rows = db.execute(stmt.order_by(VideoTask.created_at.desc())
                      .offset((page - 1) * page_size).limit(page_size)).all()
    task_ids = [task.id for task, *_ in rows]
    materials_by_task = {}
    if task_ids:
        materials_by_task = {
            m.video_task_id: m
            for m in db.scalars(
                select(Material).where(Material.video_task_id.in_(task_ids))
            ).all()
            if m.video_task_id
        }
    items = [{
        "id": task.id, "status": task.status, "blocked": task.blocked,
        "influencer_id": inf.id, "influencer_nickname": inf.nickname,
        "product_id": prod.id, "product_name": prod.name,
        "round_no": coop.round_no,
        "dy_url": task.dy_url,
        "uploaded_url": storage.material_file_url(materials_by_task[task.id].id)
        if task.id in materials_by_task and materials_by_task[task.id].oss_key else None,
        "material_id": materials_by_task[task.id].id if task.id in materials_by_task else None,
        "submit_note": task.submit_note,
        "audit_result": task.audit_result,
        "created_at": task.created_at.isoformat(),
    } for task, coop, inf, prod in rows]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


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
    task = _load_owned_task(db, user, task_id)
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
    inf_id = influencer_id_for_coop(db, task.cooperation_id)
    if inf_id:
        event = {"approved": "video_approved", "rejected": "video_rejected",
                 "blocked": "video_blocked"}[action]
        verb = {"approved": "通过视频审核", "rejected": "驳回视频", "blocked": "标记视频卡审"}[action]
        summary = f"{user.display_name} {verb}"
        if action != "approved" and body.reject_reason:
            summary += f":{body.reject_reason}"
        log_op(db, influencer_id=inf_id, product_id=task.product_id, event_type=event,
               actor=user, summary=summary,
               detail={"reason": body.reject_reason} if body.reject_reason else None)
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
    task = _load_owned_task(db, user, body.video_task_id)
    coop = db.get(Cooperation, task.cooperation_id)
    if not coop:
        raise HTTPException(400, "视频任务未关联合作轮次")
    inf = db.get(Influencer, coop.influencer_id)
    if not inf:
        raise HTTPException(400, "达人不存在")
    # 幂等防重:同一视频已有进行中的投流,禁止再发起(双击/重复提交产生脏状态机)
    active = db.scalars(select(Promotion).where(
        Promotion.video_task_id == task.id,
        Promotion.auth_status.in_(PROMO_ACTIVE_STATES))).first()
    if active:
        raise HTTPException(409, "该视频已有进行中的投流,请勿重复发起")
    promo = Promotion(video_task_id=task.id, mode_snapshot=inf.promo_mode,
                      auth_status="pending_request")
    db.add(promo)
    log_op(db, influencer_id=inf.id, product_id=task.product_id,
           event_type="promotion_started", actor=user,
           summary=f"{user.display_name} 发起投流({'自投' if inf.promo_mode == 'self' else '商家投'})")
    db.commit()
    return {"id": promo.id, "auth_status": promo.auth_status,
            "mode_snapshot": promo.mode_snapshot}


class TransitionIn(BaseModel):
    action: str
    fail_reason: str | None = None
    fail_proof_oss_key: str | None = None       # 兼容旧前端:单张
    fail_proof_oss_keys: list[str] | None = None  # 新:多张失败凭证截图


@promotion_router.post("/{promo_id}/transition")
def transition(promo_id: int, body: TransitionIn,
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    """状态机流转,带合法流转校验(非法 action 报 400)。"""
    promo = _load_owned_promo(db, user, promo_id)
    allowed = TRANSITIONS.get(promo.auth_status, {})
    if body.action not in allowed:
        raise HTTPException(400,
                            f"当前状态 {promo.auth_status} 不支持操作 {body.action}")
    promo.auth_status = allowed[body.action]
    if body.action == "mark_failed":
        promo.fail_reason = body.fail_reason
        # 收全部失败凭证:新版传数组;兼容旧版单值。去空白、限张数,首张同步写旧列。
        keys = list(body.fail_proof_oss_keys or [])
        if body.fail_proof_oss_key:
            keys.append(body.fail_proof_oss_key)
        keys = [k.strip() for k in keys if isinstance(k, str) and k.strip()]
        if len(keys) > MAX_FAIL_PROOFS:
            raise HTTPException(400, f"失败凭证最多上传 {MAX_FAIL_PROOFS} 张")
        promo.fail_proof_oss_keys = keys or None
        promo.fail_proof_oss_key = keys[0] if keys else None
    task = db.get(VideoTask, promo.video_task_id)
    inf_id = influencer_id_for_coop(db, task.cooperation_id) if task else None
    if inf_id:
        ACTION_LABELS = {"request_auth": "发起授权", "confirm_auth": "确认授权",
                         "refuse": "达人拒绝授权", "mark_promoted": "标记已投流",
                         "mark_failed": "标记投流失败", "done": "投流完成"}
        summary = f"{user.display_name} 投流{ACTION_LABELS.get(body.action, body.action)}"
        if body.action == "mark_failed" and body.fail_reason:
            summary += f":{body.fail_reason}"
        log_op(db, influencer_id=inf_id, product_id=task.product_id if task else None,
               event_type="promotion_changed", actor=user, summary=summary,
               detail={"action": body.action, "status": promo.auth_status,
                       "fail_reason": body.fail_reason})
    db.commit()
    return {"ok": True, "auth_status": promo.auth_status}


@promotion_router.delete("/{promo_id}")
def delete_promotion(promo_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """删除投流记录(投错/重复时清理)。"""
    promo = _load_owned_promo(db, user, promo_id)
    db.delete(promo)
    db.commit()
    return {"ok": True}


@promotion_router.get("/status-counts")
def promo_status_counts(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """按 auth_status 计数(商务只算自己达人),供前端分栏。"""
    stmt = (select(Promotion.auth_status, func.count())
            .join(VideoTask, Promotion.video_task_id == VideoTask.id)
            .join(Cooperation, VideoTask.cooperation_id == Cooperation.id)
            .join(Influencer, Cooperation.influencer_id == Influencer.id)
            .group_by(Promotion.auth_status))
    if user.role != "admin":
        stmt = stmt.where(Influencer.owner_bd_id == user.id)
    return {status: count for status, count in db.execute(stmt).all()}


@promotion_router.get("")
def list_promotions(auth_status: str | None = None, q: str | None = None,
                    page: int = 1, page_size: int = 50,
                    user: User = Depends(current_user), db: Session = Depends(get_db)):
    """投流列表(商务只见自己达人)。auth_status 过滤 + q 搜索 + 分页。"""
    from sqlalchemy import or_
    stmt = (select(Promotion, Influencer, Product, VideoTask)
            .join(VideoTask, Promotion.video_task_id == VideoTask.id)
            .join(Cooperation, VideoTask.cooperation_id == Cooperation.id)
            .join(Influencer, Cooperation.influencer_id == Influencer.id)
            .join(Product, VideoTask.product_id == Product.id))
    if user.role != "admin":
        stmt = stmt.where(Influencer.owner_bd_id == user.id)
    if auth_status:
        stmt = stmt.where(Promotion.auth_status == auth_status)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Influencer.nickname.like(like), Product.name.like(like),
                              Influencer.douyin_id.like(like)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    page = max(1, page)
    page_size = min(max(1, page_size), 200)
    rows = db.execute(stmt.order_by(Promotion.created_at.desc())
                      .offset((page - 1) * page_size).limit(page_size)).all()
    items = [{
        "id": promo.id, "auth_status": promo.auth_status,
        "mode_snapshot": promo.mode_snapshot,
        "influencer_id": inf.id, "influencer_nickname": inf.nickname,
        "fans_count": inf.fans_count,
        "douyin_id": inf.douyin_id, "douyin_uid": inf.douyin_uid,
        "cooperation_code": inf.cooperation_code,
        "product_id": prod.id, "product_name": prod.name,
        "dy_url": vt.dy_url, "fail_reason": promo.fail_reason,
        "fail_proof_urls": [storage.preview_url(k) for k in _fail_proof_keys(promo)],
        "created_at": promo.created_at.isoformat(),
    } for promo, inf, prod, vt in rows]
    return {"items": items, "total": total, "page": page, "page_size": page_size}
