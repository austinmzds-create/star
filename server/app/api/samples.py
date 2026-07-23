"""寄样:审批(拒绝理由库)→ 发货(单号识别+订阅轨迹)→ 回调更新 → 签收催拍。"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user, owns_or_admin
from ..models import (Cooperation, Influencer, Product, RejectReason,
                      SampleOrder, User)
from ..services.logistics import COURIERS, get_provider
from ..services.oplog import log_op
from ..services import product_applications as app_service
from ..services.sample_orders import (OPEN_SAMPLE_STATUSES, dedupe_sample_rows,
                                      status_bucket, status_filter_values)
from ..services.tracking import refresh_order_tracking

router = APIRouter(prefix="/api/samples", tags=["samples"])


def _load_owned_order(db: Session, user: User, order_id: int) -> SampleOrder:
    """加载寄样单并校验归属:商务只能操作自己名下达人的单;管理员不限。"""
    order = db.get(SampleOrder, order_id)
    if not order:
        raise HTTPException(404, "寄样单不存在")
    coop = db.get(Cooperation, order.cooperation_id)
    inf = db.get(Influencer, coop.influencer_id) if coop else None
    if not owns_or_admin(user, inf.owner_bd_id if inf else None):
        raise HTTPException(403, "无权操作该寄样单")
    return order


def _order_influencer_id(db: Session, order: SampleOrder) -> int | None:
    coop = db.get(Cooperation, order.cooperation_id)
    return coop.influencer_id if coop else None


@router.get("")
def list_samples(status: str | None = None, q: str | None = None,
                 page: int = 1, page_size: int = 50,
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    """寄样单列表(商务只见自己达人的单;管理员全量)。status 过滤 + q 搜索(达人/产品/单号)+ 分页。"""
    from sqlalchemy import or_
    stmt = (select(SampleOrder, Cooperation, Influencer, Product)
            .join(Cooperation, SampleOrder.cooperation_id == Cooperation.id)
            .join(Influencer, Cooperation.influencer_id == Influencer.id)
            .join(Product, SampleOrder.product_id == Product.id))
    if user.role != "admin":
        stmt = stmt.where(Influencer.owner_bd_id == user.id)
    status_values = status_filter_values(status)
    if status_values:
        stmt = stmt.where(SampleOrder.status.in_(status_values))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Influencer.nickname.like(like), Product.name.like(like),
                              SampleOrder.tracking_no.like(like)))
    page = max(1, page)
    page_size = min(max(1, page_size), 200)
    rows_all = dedupe_sample_rows(
        db.execute(stmt.order_by(SampleOrder.created_at.desc())).all(),
        influencer_index=2,
    )
    total = len(rows_all)
    rows = rows_all[(page - 1) * page_size: page * page_size]
    items = [{
        "id": order.id, "status": order.status,
        "influencer_id": inf.id, "influencer_nickname": inf.nickname,
        "product_id": prod.id, "product_name": prod.name,
        "round_no": coop.round_no,
        "tracking_no": order.tracking_no, "courier_company": order.courier_company,
        "logistics_status": order.logistics_status,
        "signed_at": order.signed_at.isoformat() if order.signed_at else None,
        "reject_reason": order.reject_reason,
        "created_at": order.created_at.isoformat(),
    } for order, coop, inf, prod in rows]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/status-counts")
def status_counts(user: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = (select(SampleOrder, Cooperation, Influencer)
            .join(Cooperation, SampleOrder.cooperation_id == Cooperation.id)
            .join(Influencer, Cooperation.influencer_id == Influencer.id))
    if user.role != "admin":
        stmt = stmt.where(Influencer.owner_bd_id == user.id)
    counts = {}
    for order, _coop, _inf in dedupe_sample_rows(db.execute(stmt).all(), influencer_index=2):
        key = status_bucket(order.status)
        counts[key] = counts.get(key, 0) + 1
    return counts


class CreateIn(BaseModel):
    influencer_id: int
    product_id: int
    address: dict | None = None


@router.post("")
def create(body: CreateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inf = db.get(Influencer, body.influencer_id)
    if not inf:
        raise HTTPException(404, "达人不存在")
    if inf.archived:
        raise HTTPException(400, "达人已停用,不能新建寄样单")
    if user.role != "admin" and inf.owner_bd_id != user.id:
        raise HTTPException(403, "只能给自己名下的达人建寄样单")
    product = db.get(Product, body.product_id)
    if not product:
        raise HTTPException(404, "产品不存在")
    if product.status != "on":
        raise HTTPException(400, "产品已下架,不能新建寄样单")
    coop = db.scalars(select(Cooperation).where(Cooperation.influencer_id == inf.id)
                      .order_by(Cooperation.round_no.desc(), Cooperation.id.desc()).limit(1)).first()
    if not coop:
        raise HTTPException(400, "该达人没有进行中的合作轮次")
    existing = db.scalars(
        select(SampleOrder)
        .join(Cooperation, SampleOrder.cooperation_id == Cooperation.id)
        .where(Cooperation.influencer_id == inf.id,
               SampleOrder.product_id == body.product_id,
               SampleOrder.status.in_(OPEN_SAMPLE_STATUSES))
        .order_by(SampleOrder.created_at.desc())
    ).first()
    if existing:
        raise HTTPException(409, "该达人这个产品已有进行中的寄样单,请勿重复创建")
    # 收件地址快照:优先用传入,否则用达人档案默认地址(下单即固化,后续改档案不影响本单)
    address = body.address or {"name": inf.real_name, "tel": inf.phone,
                               "address": inf.default_address}
    order = SampleOrder(cooperation_id=coop.id, product_id=body.product_id,
                        address_snapshot=address)
    db.add(order)
    db.flush()
    app = app_service.ensure_application_for_sample(db, order, user)
    log_op(db, influencer_id=inf.id, product_id=product.id, event_type="sample_created",
           actor=user, summary=f"{user.display_name} 创建寄样单:{product.name}")
    db.commit()
    return {"id": order.id, "application_id": app.id if app else None}


class SampleEditIn(BaseModel):
    address: dict | None = None   # {name, tel, address}


@router.patch("/{order_id}")
def edit_sample(order_id: int, body: SampleEditIn,
                user: User = Depends(current_user), db: Session = Depends(get_db)):
    """编辑寄样单收件地址快照(仅待审批时可改;发货后地址已固化不可动)。"""
    order = _load_owned_order(db, user, order_id)
    if order.status != "pending":
        raise HTTPException(400, "仅待审批的寄样单可修改地址")
    if body.address is not None:
        order.address_snapshot = body.address
    db.commit()
    return {"ok": True}


@router.delete("/{order_id}")
def delete_sample(order_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """删除寄样单:仅待审批/已拒绝可删(已发货有物流留证,不允许删)。"""
    order = _load_owned_order(db, user, order_id)
    if order.status not in ("pending", "rejected"):
        raise HTTPException(400, "该寄样单已进入发货流程,不能删除")
    inf_id = _order_influencer_id(db, order)
    if inf_id:
        app = app_service.application_for(db, inf_id, order.product_id)
        if app and app.sample_order_id == order.id:
            app.sample_order_id = None
            if order.status == "pending":
                app.status = "cancelled"
                app.reject_reason = None
            app_service.log_application_event(
                db, app, "sample_deleted", actor=user,
                summary=f"{user.display_name} 删除寄样单")
    db.delete(order)
    db.commit()
    return {"ok": True}


class AuditIn(BaseModel):
    approve: bool
    reject_reason: str | None = None


@router.post("/{order_id}/audit")
def audit(order_id: int, body: AuditIn,
          user: User = Depends(current_user), db: Session = Depends(get_db)):
    order = _load_owned_order(db, user, order_id)
    if order.status != "pending":
        raise HTTPException(409, "该寄样单已处理")
    new_status = "approved" if body.approve else "rejected"
    reject_reason = None if body.approve else (body.reject_reason or "资质未达标,暂不寄样")
    # 乐观并发:仅当仍为 pending 才落库;并发双审时后到者 rowcount=0 → 409,不重复写日志
    changed = db.execute(
        update(SampleOrder)
        .where(SampleOrder.id == order.id, SampleOrder.status == "pending")
        .values(status=new_status, reject_reason=reject_reason, approved_by=user.id)
    ).rowcount
    if not changed:
        db.rollback()
        raise HTTPException(409, "该寄样单已被处理")
    inf_id = _order_influencer_id(db, order)
    if inf_id:
        app = app_service.ensure_application_for_sample(db, order, user)
        if app:
            app.status = "approved" if body.approve else "rejected"
            app.reviewed_by = user.id
            app.reviewed_at = datetime.now()
            app.reject_reason = reject_reason
        if body.approve:
            app_service.ensure_access_grant(db, inf_id, order.product_id, user.id)
            log_op(db, influencer_id=inf_id, product_id=order.product_id,
                   event_type="sample_approved", actor=user,
                   summary=f"{user.display_name} 通过寄样审批")
        else:
            log_op(db, influencer_id=inf_id, product_id=order.product_id,
                   event_type="sample_rejected", actor=user,
                   summary=f"{user.display_name} 拒绝寄样:{reject_reason}",
                   detail={"reject_reason": reject_reason})
    db.commit()
    return {"ok": True}


class ShipIn(BaseModel):
    tracking_no: str
    courier: str | None = None  # 快递公司 code(商务下拉选;留空则尝试自动识别)
    phone: str | None = None    # 顺丰等需要收件人手机后四位


COURIER_CODES = {item["code"] for item in COURIERS}


@router.post("/{order_id}/ship")
async def ship(order_id: int, body: ShipIn,
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    order = _load_owned_order(db, user, order_id)
    if order.status != "approved":
        raise HTTPException(400, "只有已通过的寄样单才能发货")
    tracking_no = (body.tracking_no or "").strip()
    if not tracking_no:
        raise HTTPException(400, "请填写快递单号")
    provider = get_provider()
    courier = (body.courier or "").strip() or await provider.identify_courier(tracking_no)
    if not courier:
        raise HTTPException(400, "无法识别快递公司,请手动选择")
    if courier not in COURIER_CODES:
        raise HTTPException(400, "快递公司不支持,请重新选择")
    address_phone = (order.address_snapshot or {}).get("tel") if isinstance(order.address_snapshot, dict) else None
    query_phone = (body.phone or "").strip() or address_phone
    ok, msg = await provider.subscribe(tracking_no, courier, query_phone)
    order.tracking_no = tracking_no
    order.courier_company = courier
    order.status = "shipped"
    app_service.ensure_application_for_sample(db, order, user)
    inf_id = _order_influencer_id(db, order)
    if inf_id:
        log_op(db, influencer_id=inf_id, product_id=order.product_id,
               event_type="sample_shipped", actor=user,
               summary=f"{user.display_name} 发货:{courier} {tracking_no}",
               detail={"courier": courier, "tracking_no": tracking_no})
    db.commit()
    tracking_status = await refresh_order_tracking(db, order)
    return {"ok": True, "courier": courier, "subscribed": ok, "message": msg,
            "tracking_status": tracking_status}


@router.post("/{order_id}/track")
async def track(order_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """实时查询最新物流轨迹并回写(手动刷新;订阅回调未到时的兜底)"""
    order = _load_owned_order(db, user, order_id)
    if not order.tracking_no or not order.courier_company:
        raise HTTPException(400, "该寄样单尚未发货或缺快递公司")
    return await refresh_order_tracking(db, order)


@router.get("/couriers")
def couriers(user: User = Depends(current_user)):
    from ..services.logistics import COURIERS
    return COURIERS


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
    import logging
    provider = get_provider()
    param_raw = form.get("param", "{}")
    sign = form.get("sign")
    # 验签:配置了 salt 就强制校验来源(防伪造签收);未配置(本地/降级)仅告警放行
    if provider.callback_salt():
        if not provider.verify_callback_sign(param_raw, sign):
            raise HTTPException(403, "回调签名校验失败")
    else:
        logging.getLogger(__name__).warning("[kd100] 未配置 salt,回调未验签(仅本地/降级允许)")
    payload = json.loads(param_raw)
    parsed = provider.parse_callback(payload)
    if parsed["tracking_no"]:
        order = db.scalars(select(SampleOrder)
                           .where(SampleOrder.tracking_no == parsed["tracking_no"])).first()
        if order:
            order.logistics_status = parsed
            if parsed["signed"] and not order.signed_at:
                order.signed_at = datetime.now()  # 催拍计时起点(默认7天,可配)
                order.status = "signed"
                inf_id = _order_influencer_id(db, order)
                if inf_id:
                    log_op(db, influencer_id=inf_id, product_id=order.product_id,
                           event_type="sample_signed", actor=None,
                           summary=f"包裹已签收({order.courier_company or ''} {order.tracking_no or ''})".strip())
            elif order.status == "shipped":
                order.status = parsed["status"]
            db.commit()
    # 快递100要求返回该结构,否则会重推
    return {"result": True, "returnCode": "200", "message": "成功"}
