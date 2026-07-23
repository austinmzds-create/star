"""产品带货申请/合作关系的业务助手。

这层把"达人能看产品"和"达人被允许带货/寄样"拆开。产品可见走 Product.status,
带货流程走 ProductApplication,并与既有 SampleOrder/AccessGrant 做兼容串联。
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import (AccessGrant, Cooperation, Influencer, Product,
                      ProductApplication, SampleOrder, User)
from .oplog import log_op

APPLICATION_STATUSES = {"pending", "approved", "rejected", "cancelled"}
OPEN_APPLICATION_STATUSES = {"pending", "approved"}


def application_status_from_sample(order: SampleOrder) -> str:
    """把旧寄样单状态映射到新的带货申请主状态。

    发货/运输/签收仍由 SampleOrder 表达;ProductApplication 只表示申请是否已经
    进入可带货流程,因此非 pending/rejected 的寄样都视为 approved。
    """
    if order.status == "rejected":
        return "rejected"
    if order.status == "pending":
        return "pending"
    return "approved"


def latest_cooperation(db: Session, influencer_id: int) -> Cooperation | None:
    return db.scalars(
        select(Cooperation)
        .where(Cooperation.influencer_id == influencer_id)
        .order_by(Cooperation.round_no.desc(), Cooperation.id.desc())
        .limit(1)
    ).first()


def ensure_cooperation(db: Session, inf: Influencer) -> Cooperation:
    coop = latest_cooperation(db, inf.id)
    if coop:
        return coop
    max_round = db.scalar(
        select(func.max(Cooperation.round_no)).where(Cooperation.influencer_id == inf.id)
    ) or 0
    coop = Cooperation(
        influencer_id=inf.id,
        round_no=int(max_round) + 1,
        status="active",
        level_snapshot=inf.level or "L1",
        commission_tier_snapshot=inf.commission_tier or Decimal("5"),
        promo_mode_snapshot=inf.promo_mode or "merchant",
    )
    db.add(coop)
    db.flush()
    return coop


def latest_sample(db: Session, influencer_id: int, product_id: int) -> SampleOrder | None:
    return db.scalars(
        select(SampleOrder)
        .join(Cooperation, SampleOrder.cooperation_id == Cooperation.id)
        .where(Cooperation.influencer_id == influencer_id,
               SampleOrder.product_id == product_id)
        .order_by(SampleOrder.created_at.desc(), SampleOrder.id.desc())
    ).first()


def ensure_access_grant(db: Session, influencer_id: int, product_id: int, granted_by: int) -> None:
    existing = db.scalars(
        select(AccessGrant)
        .where(AccessGrant.influencer_id == influencer_id,
               AccessGrant.product_id == product_id)
    ).first()
    if not existing:
        db.add(AccessGrant(
            influencer_id=influencer_id,
            product_id=product_id,
            granted_by=granted_by,
        ))


def application_for(db: Session, influencer_id: int, product_id: int) -> ProductApplication | None:
    return db.scalars(
        select(ProductApplication)
        .where(ProductApplication.influencer_id == influencer_id,
               ProductApplication.product_id == product_id)
    ).first()


def ensure_application_for_sample(db: Session, order: SampleOrder, actor: User | None = None) -> ProductApplication | None:
    """旧寄样入口创建/审批时同步一条产品合作记录。"""
    coop = db.get(Cooperation, order.cooperation_id)
    inf = db.get(Influencer, coop.influencer_id) if coop else None
    product = db.get(Product, order.product_id)
    if not inf or not product:
        return None
    app = application_for(db, inf.id, product.id)
    if not app:
        app = ProductApplication(
            product_id=product.id,
            influencer_id=inf.id,
            source="staff_assign",
            status=application_status_from_sample(order),
            sample_order_id=order.id,
            created_by_user_id=actor.id if actor else None,
            owner_bd_id=inf.owner_bd_id,
            reject_reason=order.reject_reason,
            reviewed_by=order.approved_by,
            reviewed_at=order.updated_at if order.status != "pending" else None,
        )
        db.add(app)
    new_status = application_status_from_sample(order)
    if app.sample_order_id in (None, order.id) or app.status in {"rejected", "cancelled"} or order.status != "pending":
        app.sample_order_id = order.id
    if app.sample_order_id == order.id:
        app.status = new_status
        app.reject_reason = order.reject_reason if new_status == "rejected" else None
        if order.status != "pending":
            app.reviewed_by = order.approved_by
            app.reviewed_at = order.updated_at
    app.owner_bd_id = inf.owner_bd_id
    return app


def create_approved_sample(db: Session, app: ProductApplication, actor: User) -> SampleOrder:
    """申请通过或后台手动添加后,生成/复用待发货寄样单。"""
    if app.sample_order_id:
        order = db.get(SampleOrder, app.sample_order_id)
        if order and order.status != "rejected":
            if order.status == "pending":
                order.status = "approved"
                order.approved_by = actor.id
            return order
        app.sample_order_id = None
    inf = db.get(Influencer, app.influencer_id)
    if not inf:
        raise ValueError("达人不存在")
    existing = latest_sample(db, inf.id, app.product_id)
    if existing and existing.status in {"pending", "approved", "shipped", "in_transit", "signed"}:
        if existing.status == "pending":
            existing.status = "approved"
            existing.approved_by = actor.id
        app.sample_order_id = existing.id
        return existing
    coop = ensure_cooperation(db, inf)
    address = {"name": inf.real_name, "tel": inf.phone, "address": inf.default_address}
    order = SampleOrder(
        cooperation_id=coop.id,
        product_id=app.product_id,
        status="approved",
        address_snapshot=address,
        approved_by=actor.id,
    )
    db.add(order)
    db.flush()
    app.sample_order_id = order.id
    return order


def display_status(app: ProductApplication, sample: SampleOrder | None = None) -> str:
    if app.status in {"pending", "rejected", "cancelled"}:
        return app.status
    if sample and sample.status in {"approved", "shipped", "in_transit", "signed"}:
        return sample.status
    return "approved"


def log_application_event(db: Session, app: ProductApplication, event_type: str,
                          actor=None, summary: str = "", detail: dict | None = None) -> None:
    log_op(db, influencer_id=app.influencer_id, product_id=app.product_id,
           event_type=event_type, actor=actor, summary=summary, detail=detail)


def backfill_from_samples(db: Session) -> int:
    """把历史寄样单补成产品合作档案。

    只做缺失行补齐,不覆盖已有申请。这样老数据也能出现在新的「带货管理」页面。
    """
    created = 0
    seen = {
        (app.influencer_id, app.product_id)
        for app in db.scalars(select(ProductApplication)).all()
    }
    rows = db.execute(
        select(SampleOrder, Cooperation, Influencer)
        .join(Cooperation, SampleOrder.cooperation_id == Cooperation.id)
        .join(Influencer, Cooperation.influencer_id == Influencer.id)
        .order_by(SampleOrder.created_at.desc(), SampleOrder.id.desc())
    ).all()
    for order, coop, inf in rows:
        key = (inf.id, order.product_id)
        if key in seen:
            continue
        app_status = application_status_from_sample(order)
        db.add(ProductApplication(
            product_id=order.product_id,
            influencer_id=inf.id,
            source="staff_assign",
            status=app_status,
            reject_reason=order.reject_reason,
            sample_order_id=order.id,
            owner_bd_id=inf.owner_bd_id,
            reviewed_by=order.approved_by,
            reviewed_at=order.updated_at if app_status in {"approved", "rejected"} else None,
            applied_at=order.created_at,
            created_at=order.created_at,
            updated_at=order.updated_at,
        ))
        seen.add(key)
        created += 1
    return created
