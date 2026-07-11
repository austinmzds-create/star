"""寄样:审批(拒绝理由库)→ 发货(单号识别+订阅轨迹)→ 回调更新 → 签收催拍。"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user
from ..models import (Cooperation, Influencer, Product, RejectReason,
                      SampleOrder, User)
from ..services.logistics import get_provider

router = APIRouter(prefix="/api/samples", tags=["samples"])


@router.get("")
def list_samples(status: str | None = None,
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    """寄样单列表(商务只见自己达人的单;管理员全量)。status 可选过滤。"""
    stmt = (select(SampleOrder, Cooperation, Influencer, Product)
            .join(Cooperation, SampleOrder.cooperation_id == Cooperation.id)
            .join(Influencer, Cooperation.influencer_id == Influencer.id)
            .join(Product, SampleOrder.product_id == Product.id)
            .order_by(SampleOrder.created_at.desc()))
    if user.role != "admin":
        stmt = stmt.where(Influencer.owner_bd_id == user.id)
    if status:
        stmt = stmt.where(SampleOrder.status == status)
    out = []
    for order, coop, inf, prod in db.execute(stmt.limit(300)).all():
        out.append({
            "id": order.id, "status": order.status,
            "influencer_id": inf.id, "influencer_nickname": inf.nickname,
            "product_id": prod.id, "product_name": prod.name,
            "round_no": coop.round_no,
            "tracking_no": order.tracking_no, "courier_company": order.courier_company,
            "logistics_status": order.logistics_status,
            "signed_at": order.signed_at.isoformat() if order.signed_at else None,
            "reject_reason": order.reject_reason,
            "created_at": order.created_at.isoformat(),
        })
    return out


@router.get("/status-counts")
def status_counts(user: User = Depends(current_user), db: Session = Depends(get_db)):
    from sqlalchemy import func
    stmt = (select(SampleOrder.status, func.count())
            .join(Cooperation, SampleOrder.cooperation_id == Cooperation.id)
            .join(Influencer, Cooperation.influencer_id == Influencer.id)
            .group_by(SampleOrder.status))
    if user.role != "admin":
        stmt = stmt.where(Influencer.owner_bd_id == user.id)
    return {status: count for status, count in db.execute(stmt).all()}


class CreateIn(BaseModel):
    influencer_id: int
    product_id: int
    address: dict | None = None


@router.post("")
def create(body: CreateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inf = db.get(Influencer, body.influencer_id)
    if not inf:
        raise HTTPException(404, "达人不存在")
    coop = db.scalars(select(Cooperation).where(Cooperation.influencer_id == inf.id)
                      .order_by(Cooperation.round_no.desc()).limit(1)).first()
    if not coop:
        raise HTTPException(400, "该达人没有进行中的合作轮次")
    order = SampleOrder(cooperation_id=coop.id, product_id=body.product_id,
                        address_snapshot=body.address)
    db.add(order)
    db.commit()
    return {"id": order.id}


class AuditIn(BaseModel):
    approve: bool
    reject_reason: str | None = None


@router.post("/{order_id}/audit")
def audit(order_id: int, body: AuditIn,
          user: User = Depends(current_user), db: Session = Depends(get_db)):
    order = db.get(SampleOrder, order_id)
    if not order or order.status != "pending":
        raise HTTPException(404, "寄样单不存在或已处理")
    order.status = "approved" if body.approve else "rejected"
    order.reject_reason = None if body.approve else (body.reject_reason or "资质未达标,暂不寄样")
    order.approved_by = user.id
    db.commit()
    return {"ok": True}


class ShipIn(BaseModel):
    tracking_no: str
    phone: str | None = None  # 顺丰等需要收件人手机后四位


@router.post("/{order_id}/ship")
async def ship(order_id: int, body: ShipIn,
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    order = db.get(SampleOrder, order_id)
    if not order or order.status != "approved":
        raise HTTPException(400, "只有已通过的寄样单才能发货")
    provider = get_provider()
    courier = await provider.identify_courier(body.tracking_no)
    subscribed = await provider.subscribe(body.tracking_no, courier or "auto", body.phone)
    order.tracking_no = body.tracking_no
    order.courier_company = courier
    order.status = "shipped"
    db.commit()
    return {"ok": True, "courier": courier, "subscribed": subscribed}


@router.get("/reject-reasons")
def reject_reasons(scene: str = "sample", db: Session = Depends(get_db),
                   user: User = Depends(current_user)):
    rows = db.scalars(select(RejectReason)
                      .where(RejectReason.scene == scene, RejectReason.is_active)).all()
    return [{"id": r.id, "text": r.text} for r in rows]


# ---- 快递100 回调(订阅式推送,无需登录态;放在同一路由文件便于对照) ----

webhook_router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


@webhook_router.post("/kd100")
async def kd100_callback(request: Request, db: Session = Depends(get_db)):
    form = await request.form()
    import json
    payload = json.loads(form.get("param", "{}"))
    parsed = get_provider().parse_callback(payload)
    if parsed["tracking_no"]:
        order = db.scalars(select(SampleOrder)
                           .where(SampleOrder.tracking_no == parsed["tracking_no"])).first()
        if order:
            order.logistics_status = parsed
            if parsed["signed"] and not order.signed_at:
                order.signed_at = datetime.now()  # 催拍计时起点(默认7天,可配)
                order.status = "signed"
            elif order.status == "shipped":
                order.status = parsed["status"]
            db.commit()
    # 快递100要求返回该结构,否则会重推
    return {"result": True, "returnCode": "200", "message": "成功"}
