"""产品带货申请/合作管理。

一行代表一个「达人 × 产品」的带货关系:达人申请、后台审核、待发货、发货、
签收、视频/投流/GMV 汇总都从这里串起来。产品素材可见不依赖这里;这里只代表
带货/寄样资格。
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user, owns_or_admin
from ..models import (Cooperation, Influencer, OrderRecord, Product,
                      ProductApplication, Promotion, SampleOrder, User,
                      VideoTask)
from ..services import product_applications as apps
from ..services import storage
from ..services.oplog import log_op
from .samples import ShipIn, ship as ship_sample

router = APIRouter(prefix="/api/product-applications", tags=["product-applications"])


STATUS_LABELS = {
    "pending": "审核中",
    "approved": "待发货",
    "rejected": "已拒绝",
    "cancelled": "已取消",
    "shipped": "已发货",
    "in_transit": "运输中",
    "signed": "已签收",
}


class ProductApplicationIn(BaseModel):
    influencer_id: int
    product_id: int
    note: str | None = None


class ReviewIn(BaseModel):
    approve: bool
    reject_reason: str | None = None


def _product_or_404(db: Session, product_id: int) -> Product:
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(404, "产品不存在")
    if product.status != "on":
        raise HTTPException(400, "产品已下架,不能申请带货")
    if product.allow_promotion is False:
        raise HTTPException(400, "该产品当前不允许带货")
    return product


def _product_exists_or_404(db: Session, product_id: int) -> Product:
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(404, "产品不存在")
    return product


def _influencer_or_404(db: Session, influencer_id: int) -> Influencer:
    inf = db.get(Influencer, influencer_id)
    if not inf:
        raise HTTPException(404, "达人不存在")
    if inf.archived:
        raise HTTPException(400, "达人已停用")
    return inf


def _assert_can_operate(user: User, inf: Influencer) -> None:
    if not owns_or_admin(user, inf.owner_bd_id):
        raise HTTPException(403, "只能操作自己名下的达人")


def _sample_for_app(db: Session, app: ProductApplication) -> SampleOrder | None:
    return apps.sample_for_application(db, app)


def _stats_for(db: Session, influencer_id: int, product_id: int) -> dict:
    coop_ids = db.scalars(
        select(Cooperation.id).where(Cooperation.influencer_id == influencer_id)
    ).all()
    if not coop_ids:
        return {"video_count": 0, "latest_video_status": None,
                "promotion_status": None, "gmv": 0.0}
    videos = db.scalars(
        select(VideoTask)
        .where(VideoTask.product_id == product_id,
               VideoTask.cooperation_id.in_(coop_ids))
        .order_by(VideoTask.created_at.desc(), VideoTask.id.desc())
    ).all()
    latest_video_status = videos[0].status if videos else None
    promotion_status = None
    if videos:
        video_ids = [v.id for v in videos]
        promo = db.scalars(
            select(Promotion)
            .where(Promotion.video_task_id.in_(video_ids))
            .order_by(Promotion.updated_at.desc(), Promotion.id.desc())
        ).first()
        promotion_status = promo.auth_status if promo else None
    gmv = db.scalar(
        select(func.coalesce(func.sum(OrderRecord.amount), 0))
        .where(OrderRecord.influencer_id == influencer_id,
               OrderRecord.product_id == product_id)
    ) or 0
    return {"video_count": len(videos), "latest_video_status": latest_video_status,
            "promotion_status": promotion_status, "gmv": float(gmv)}


def _app_dict(db: Session, app: ProductApplication, inf: Influencer, product: Product,
              owner: User | None = None, reviewer: User | None = None,
              current_user_obj: User | None = None) -> dict:
    sample = _sample_for_app(db, app)
    status = apps.display_status(app, sample)
    stats = _stats_for(db, inf.id, product.id)
    can_operate = bool(current_user_obj and owns_or_admin(current_user_obj, inf.owner_bd_id))
    return {
        "id": app.id,
        "product_id": product.id,
        "product_name": product.name,
        "product_image": storage.thumbnail_url(product.product_image, 96),
        "influencer_id": inf.id,
        "influencer_nickname": inf.nickname,
        "douyin_id": inf.douyin_id,
        "phone": inf.phone if can_operate else None,
        "owner_bd_id": inf.owner_bd_id,
        "owner_bd_name": owner.display_name if owner else None,
        "source": app.source,
        "application_status": app.status,
        "status": status,
        "status_label": STATUS_LABELS.get(status, status),
        "reject_reason": app.reject_reason,
        "note": app.note,
        "reviewed_at": app.reviewed_at.isoformat() if app.reviewed_at else None,
        "reviewed_by": reviewer.display_name if reviewer else None,
        "sample_order_id": sample.id if sample else None,
        "sample_status": sample.status if sample else None,
        "tracking_no": sample.tracking_no if sample else None,
        "courier_company": sample.courier_company if sample else None,
        "logistics_status": sample.logistics_status if sample else None,
        "signed_at": sample.signed_at.isoformat() if sample and sample.signed_at else None,
        "video_count": stats["video_count"],
        "latest_video_status": stats["latest_video_status"],
        "promotion_status": stats["promotion_status"],
        "gmv": stats["gmv"],
        "can_operate": can_operate,
        "created_at": app.created_at.isoformat(),
        "updated_at": app.updated_at.isoformat(),
    }


def _application_rows_stmt(user: User, mine_only: bool = False, q: str | None = None):
    stmt = (select(ProductApplication, Influencer, Product, User)
            .join(Influencer, ProductApplication.influencer_id == Influencer.id)
            .join(Product, ProductApplication.product_id == Product.id)
            .outerjoin(User, Influencer.owner_bd_id == User.id))
    if mine_only and user.role != "admin":
        stmt = stmt.where(Influencer.owner_bd_id == user.id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Influencer.nickname.like(like),
                              Influencer.douyin_id.like(like),
                              Influencer.phone.like(like),
                              Product.name.like(like)))
    return stmt


def _apply_status_filter(stmt, status: str | None):
    if not status:
        return stmt
    if status in {"approved", "shipped", "in_transit", "signed"}:
        stmt = stmt.outerjoin(SampleOrder, ProductApplication.sample_order_id == SampleOrder.id)
        stmt = stmt.where(ProductApplication.status == "approved")
        if status == "approved":
            return stmt.where(or_(SampleOrder.id.is_(None), SampleOrder.status == "approved"))
        return stmt.where(SampleOrder.status == status)
    if status in apps.APPLICATION_STATUSES:
        return stmt.where(ProductApplication.status == status)
    return stmt


@router.get("")
def list_applications(status: str | None = None, q: str | None = None,
                      mine_only: bool = False, page: int = 1, page_size: int = 50,
                      user: User = Depends(current_user), db: Session = Depends(get_db)):
    """带货管理列表。商务可看全库;非归属达人只读且敏感联系方式脱敏。"""
    stmt = _apply_status_filter(_application_rows_stmt(user, mine_only, q), status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    page = max(1, page)
    page_size = min(max(1, page_size), 200)
    rows = db.execute(stmt.order_by(ProductApplication.updated_at.desc(), ProductApplication.id.desc())
                      .offset((page - 1) * page_size).limit(page_size)).all()
    reviewer_ids = [app.reviewed_by for app, *_ in rows if app.reviewed_by]
    reviewers = {}
    if reviewer_ids:
        reviewers = {u.id: u for u in db.scalars(select(User).where(User.id.in_(reviewer_ids))).all()}
    items = [_app_dict(db, app, inf, product, owner, reviewers.get(app.reviewed_by), user)
             for app, inf, product, owner in rows]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/status-counts")
def status_counts(q: str | None = None, mine_only: bool = False,
                  user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = [row[0] for row in db.execute(_application_rows_stmt(user, mine_only, q)).all()]
    counts: dict[str, int] = {}
    for app in rows:
        sample = _sample_for_app(db, app)
        key = apps.display_status(app, sample)
        counts[key] = counts.get(key, 0) + 1
    return counts


@router.get("/pending-count")
def pending_count(user: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = (select(func.count(ProductApplication.id))
            .join(Influencer, ProductApplication.influencer_id == Influencer.id)
            .where(ProductApplication.status == "pending"))
    if user.role != "admin":
        stmt = stmt.where(Influencer.owner_bd_id == user.id)
    count = db.scalar(stmt) or 0
    return {"count": count}


@router.post("")
def create_staff_application(body: ProductApplicationIn,
                             user: User = Depends(current_user),
                             db: Session = Depends(get_db)):
    """后台手动添加带货达人:直接进入已通过/待发货状态。"""
    product = _product_or_404(db, body.product_id)
    inf = _influencer_or_404(db, body.influencer_id)
    _assert_can_operate(user, inf)
    note = (body.note or "").strip() or None
    app = apps.application_for(db, inf.id, product.id)
    if app and app.status == "pending":
        raise HTTPException(409, "该达人已提交申请,请直接审核")
    if not app:
        app = ProductApplication(
            product_id=product.id,
            influencer_id=inf.id,
            source="staff_assign",
            created_by_user_id=user.id,
            owner_bd_id=inf.owner_bd_id,
            note=note,
        )
        db.add(app)
    if app.status == "approved":
        raise HTTPException(409, "该达人已在带货流程中")
    app.status = "approved"
    app.source = "staff_assign"
    app.reject_reason = None
    app.note = note
    app.reviewed_by = user.id
    app.reviewed_at = datetime.now()
    apps.create_approved_sample(db, app, user)
    apps.ensure_access_grant(db, inf.id, product.id, user.id)
    apps.log_application_event(db, app, "product_application_assigned", actor=user,
                               summary=f"{user.display_name} 手动添加带货产品:{product.name}")
    db.commit()
    return {"id": app.id}


@router.post("/{application_id}/review")
def review_application(application_id: int, body: ReviewIn,
                       user: User = Depends(current_user),
                       db: Session = Depends(get_db)):
    app = db.get(ProductApplication, application_id)
    if not app:
        raise HTTPException(404, "申请不存在")
    inf = _influencer_or_404(db, app.influencer_id)
    product = _product_exists_or_404(db, app.product_id)
    _assert_can_operate(user, inf)
    if app.status != "pending":
        raise HTTPException(409, "该申请已处理")
    if body.approve:
        if product.status != "on":
            raise HTTPException(400, "产品已下架,不能通过带货申请")
        if product.allow_promotion is False:
            raise HTTPException(400, "该产品当前不允许带货")
        app.status = "approved"
        app.reject_reason = None
        apps.create_approved_sample(db, app, user)
        apps.ensure_access_grant(db, inf.id, product.id, user.id)
        apps.log_application_event(db, app, "product_application_approved", actor=user,
                                   summary=f"{user.display_name} 通过带货申请:{product.name}")
    else:
        reason = (body.reject_reason or "").strip()
        if not reason:
            raise HTTPException(400, "拒绝时必须填写原因")
        app.status = "rejected"
        app.reject_reason = reason[:255]
        sample = _sample_for_app(db, app)
        if sample and sample.status in {"pending", "approved"}:
            sample.status = "rejected"
            sample.reject_reason = app.reject_reason
            sample.approved_by = user.id
        apps.log_application_event(db, app, "product_application_rejected", actor=user,
                                   summary=f"{user.display_name} 拒绝带货申请:{product.name}",
                                   detail={"reject_reason": app.reject_reason})
    app.reviewed_by = user.id
    app.reviewed_at = datetime.now()
    db.commit()
    return {"ok": True}


@router.post("/{application_id}/ship")
async def ship_application(application_id: int, body: ShipIn,
                           user: User = Depends(current_user),
                           db: Session = Depends(get_db)):
    app = db.get(ProductApplication, application_id)
    if not app:
        raise HTTPException(404, "申请不存在")
    inf = _influencer_or_404(db, app.influencer_id)
    _assert_can_operate(user, inf)
    if app.status != "approved":
        raise HTTPException(400, "只有已通过的带货申请才能发货")
    try:
        order = apps.create_approved_sample(db, app, user)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    db.commit()
    return await ship_sample(order.id, body, user, db)
