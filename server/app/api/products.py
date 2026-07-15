"""产品中心:产品维护 + 五类素材 + 授权达人 + 商品信息编辑 + 产品动态 + 出单登记。"""
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user, owns_or_admin
from ..models import (AccessGrant, Cooperation, Influencer, Material,
                      OrderRecord, Product, ProductQianchuanBinding,
                      QianchuanCooperationBinding, QianchuanShopAuth,
                      SampleOrder, User,
                      VideoTask)
from ..services import crypto, storage
from ..services import qianchuan as qianchuan_service
from ..services.oplog import log_op
from ..services.sample_orders import dedupe_sample_rows

router = APIRouter(prefix="/api/products", tags=["products"])

MATERIAL_TYPES = {"video_ai", "video_hot", "video_output", "image", "pdf", "copy"}
QIANCHUAN_BINDING_STATUSES = {"draft", "configured", "disabled"}
QIANCHUAN_COOP_STATUSES = {"bound", "pending", "failed", "disabled"}


class ProductIn(BaseModel):
    name: str
    price_text: str | None = None
    shop_name: str | None = None
    shop_product_id: str | None = None
    link: str | None = None
    default_commission: float | None = None
    selling_points: str | None = None
    shooting_notes: str | None = None
    product_image: str | None = None
    product_images: list[str] | None = None
    sample_remark: str | None = None
    promo_remark: str | None = None
    auto_audit_type: str | None = None
    allow_promotion: bool | None = None


@router.post("")
def create(body: ProductIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    data["name"] = data["name"].strip()
    if not data["name"]:
        raise HTTPException(400, "产品名称不能为空")
    if data.get("default_commission") is not None:
        if data["default_commission"] < 0 or data["default_commission"] > 100:
            raise HTTPException(400, "默认佣金需在 0-100 之间")
        data["default_commission"] = Decimal(str(data["default_commission"]))
    # 首张图集自动作封面(未单独指定封面时)
    if data.get("product_images") and not data.get("product_image"):
        data["product_image"] = data["product_images"][0]
    p = Product(**data)
    db.add(p)
    db.commit()
    return {"id": p.id}


@router.put("/{product_id}")
def update_product(product_id: int, body: ProductIn,
                   user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(404, "产品不存在")
    data = body.model_dump()
    if data.get("name") is not None:
        data["name"] = data["name"].strip()
        if not data["name"]:
            raise HTTPException(400, "产品名称不能为空")
    if data.get("default_commission") is not None and (
        data["default_commission"] < 0 or data["default_commission"] > 100
    ):
        raise HTTPException(400, "默认佣金需在 0-100 之间")
    if data.get("product_images") and not data.get("product_image"):
        data["product_image"] = data["product_images"][0]
    for k, v in data.items():
        if v is None:
            continue
        setattr(p, k, Decimal(str(v)) if k == "default_commission" else v)
    db.commit()
    return {"ok": True}


@router.post("/{product_id}/toggle")
def toggle_status(product_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(404, "产品不存在")
    p.status = "off" if p.status == "on" else "on"
    db.commit()
    return {"status": p.status}


@router.delete("/{product_id}")
def delete_product(product_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """硬删除:仅在无寄样/视频/出单记录时允许(连带清理素材与授权);否则请下架。"""
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(404, "产品不存在")
    if (db.scalar(select(SampleOrder.id).where(SampleOrder.product_id == product_id).limit(1))
            or db.scalar(select(VideoTask.id).where(VideoTask.product_id == product_id).limit(1))
            or db.scalar(select(OrderRecord.id).where(OrderRecord.product_id == product_id).limit(1))):
        raise HTTPException(400, "该产品已有寄样/视频/出单记录,不能删除;请改用「下架」")
    db.query(QianchuanCooperationBinding).filter(QianchuanCooperationBinding.product_id == product_id).delete()
    db.query(ProductQianchuanBinding).filter(ProductQianchuanBinding.product_id == product_id).delete()
    db.query(Material).filter(Material.product_id == product_id).delete()
    db.query(AccessGrant).filter(AccessGrant.product_id == product_id).delete()
    db.delete(p)
    db.commit()
    return {"ok": True}


def _grant_count(db: Session, pid: int) -> int:
    return db.scalar(select(func.count()).select_from(AccessGrant)
                     .where(AccessGrant.product_id == pid)) or 0


def _qianchuan_binding_dict(row: ProductQianchuanBinding | None) -> dict:
    configured = bool(row and any([
        row.shop_auth_id, row.shop_id, row.shop_name, row.advertiser_id, row.qianchuan_product_id,
    ]))
    return {
        "id": row.id if row else None,
        "shop_auth_id": row.shop_auth_id if row else None,
        "shop_id": row.shop_id if row else None,
        "shop_name": row.shop_name if row else None,
        "advertiser_id": row.advertiser_id if row else None,
        "qianchuan_product_id": row.qianchuan_product_id if row else None,
        "bind_status": row.bind_status if row else "draft",
        "remark": row.remark if row else None,
        "configured": configured,
        "oauth_configured": qianchuan_service.oauth_configured(),
        "missing_config": qianchuan_service.missing_config(),
        "integration_status": "oauth_ready" if qianchuan_service.oauth_configured() else "config_missing",
        "can_start_oauth": qianchuan_service.oauth_configured(),
        "cooperation_sync_configured": qianchuan_service.cooperation_sync_configured(),
        "missing_cooperation_sync_config": qianchuan_service.missing_cooperation_sync_config(),
        "can_sync_cooperation": bool(row and row.shop_auth_id
                                     and qianchuan_service.cooperation_sync_configured()),
        "updated_at": row.updated_at.isoformat() if row else None,
    }


def _qianchuan_status(db: Session, product_id: int) -> str:
    row = db.scalars(select(ProductQianchuanBinding)
                     .where(ProductQianchuanBinding.product_id == product_id)).first()
    if not row:
        return "unconfigured"
    if row.bind_status == "disabled":
        return "disabled"
    return "configured" if _qianchuan_binding_dict(row)["configured"] else "draft"


@router.get("")
def list_products(q: str | None = None, status: str | None = None,
                  page: int = 1, page_size: int = 50, paged: bool = False,
                  user: User = Depends(current_user), db: Session = Depends(get_db)):
    """产品列表。q 搜索名称/店铺 + status 过滤 + 分页。
    兼容:paged=False(默认)返回数组(旧调用/下拉选择器);paged=true 返回 {items,total}。"""
    from sqlalchemy import or_
    stmt = select(Product)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Product.name.like(like), Product.shop_name.like(like)))
    if status:
        stmt = stmt.where(Product.status == status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    page = max(1, page)
    page_size = min(max(1, page_size), 200)
    q_stmt = stmt.order_by(Product.updated_at.desc())
    if paged:
        q_stmt = q_stmt.offset((page - 1) * page_size).limit(page_size)
    rows = db.scalars(q_stmt).all()
    items = [{"id": p.id, "name": p.name, "price_text": p.price_text, "shop_name": p.shop_name,
              "product_image": storage.thumbnail_url(p.product_image, 96),
              "default_commission": float(p.default_commission) if p.default_commission else None,
              "status": p.status, "material_count": len(p.materials),
              "granted_count": _grant_count(db, p.id),
              "qianchuan_status": _qianchuan_status(db, p.id),
              "created_at": p.created_at.isoformat()} for p in rows]
    return {"items": items, "total": total, "page": page, "page_size": page_size} if paged else items


class MaterialIn(BaseModel):
    type: str  # video_ai / video_hot / video_output / image / pdf / copy
    title: str | None = None
    oss_key: str | None = None
    source_link: str | None = None
    parsed_text: str | None = None
    report_id: str | None = None
    downloadable: bool = True


def _validate_material(body: MaterialIn):
    if body.type not in MATERIAL_TYPES:
        raise HTTPException(400, "素材类型不支持")
    if body.type == "copy":
        if not (body.parsed_text or "").strip():
            raise HTTPException(400, "文案内容不能为空")
        return
    if body.type == "video_hot" and (body.source_link or "").strip():
        return
    if not (body.oss_key or "").strip():
        raise HTTPException(400, "请先上传文件")


@router.post("/{product_id}/materials")
def add_material(product_id: int, body: MaterialIn,
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not db.get(Product, product_id):
        raise HTTPException(404, "产品不存在")
    _validate_material(body)
    m = Material(product_id=product_id, **body.model_dump())
    db.add(m)
    db.commit()
    db.refresh(m)
    # TODO: source_link 非空时后台任务:下载视频→转存OSS→解析文案回填 parsed_text
    return _material_dict(m)


class MaterialEditIn(BaseModel):
    title: str | None = None
    source_link: str | None = None
    parsed_text: str | None = None
    report_id: str | None = None
    downloadable: bool | None = None


@router.put("/materials/{material_id}")
def edit_material(material_id: int, body: MaterialEditIn,
                  user: User = Depends(current_user), db: Session = Depends(get_db)):
    """编辑素材(标题/文案/爆款链接/报告ID/是否可下载);不改类型与已上传文件。"""
    m = db.get(Material, material_id)
    if not m:
        raise HTTPException(404, "素材不存在")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(m, k, v)
    db.commit()
    return {"ok": True}


@router.delete("/materials/{material_id}")
def delete_material(material_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    m = db.get(Material, material_id)
    if m:
        db.delete(m)
        db.commit()
    return {"ok": True}


def _material_dict(m: Material) -> dict:
    return {"id": m.id, "type": m.type, "title": m.title, "oss_key": m.oss_key,
            "url": storage.signed_url(m.oss_key) if m.oss_key else None,
            "source_link": m.source_link, "parsed_text": m.parsed_text,
            "report_id": m.report_id, "downloadable": m.downloadable,
            "starred": m.starred, "created_at": m.created_at.isoformat()}


class QianchuanBindingIn(BaseModel):
    shop_auth_id: int | None = None
    shop_id: str | None = None
    shop_name: str | None = None
    advertiser_id: str | None = None
    qianchuan_product_id: str | None = None
    bind_status: str | None = None
    remark: str | None = None


def _clean_text(value: str | None, max_len: int, field_name: str) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    if len(value) > max_len:
        raise HTTPException(400, f"{field_name}不能超过{max_len}个字符")
    return value


@router.get("/{product_id}/qianchuan-binding")
def qianchuan_binding(product_id: int, user: User = Depends(current_user),
                      db: Session = Depends(get_db)):
    if not db.get(Product, product_id):
        raise HTTPException(404, "产品不存在")
    row = db.scalars(select(ProductQianchuanBinding)
                     .where(ProductQianchuanBinding.product_id == product_id)).first()
    return _qianchuan_binding_dict(row)


@router.put("/{product_id}/qianchuan-binding")
def save_qianchuan_binding(product_id: int, body: QianchuanBindingIn,
                           user: User = Depends(current_user),
                           db: Session = Depends(get_db)):
    if not db.get(Product, product_id):
        raise HTTPException(404, "产品不存在")
    status = body.bind_status or "draft"
    if status not in QIANCHUAN_BINDING_STATUSES:
        raise HTTPException(400, "千川绑定状态不支持")
    row = db.scalars(select(ProductQianchuanBinding)
                     .where(ProductQianchuanBinding.product_id == product_id)).first()
    if not row:
        row = ProductQianchuanBinding(product_id=product_id)
        db.add(row)
    row.shop_id = _clean_text(body.shop_id, 64, "千川店铺ID")
    row.shop_name = _clean_text(body.shop_name, 128, "千川店铺名称")
    row.advertiser_id = _clean_text(body.advertiser_id, 64, "广告主ID")
    if body.shop_auth_id is not None:
        shop_auth = db.get(QianchuanShopAuth, body.shop_auth_id)
        if not shop_auth or shop_auth.auth_status != "active":
            raise HTTPException(400, "千川店铺授权不存在或不可用")
        row.shop_auth_id = shop_auth.id
        row.shop_id = row.shop_id or shop_auth.shop_id
        row.shop_name = row.shop_name or shop_auth.shop_name
        row.advertiser_id = row.advertiser_id or shop_auth.advertiser_id
    row.qianchuan_product_id = _clean_text(body.qianchuan_product_id, 64, "千川商品ID")
    row.bind_status = status
    row.remark = _clean_text(body.remark, 1000, "备注")
    row.updated_by = user.id
    db.commit()
    db.refresh(row)
    return _qianchuan_binding_dict(row)


class QianchuanCooperationIn(BaseModel):
    influencer_id: int
    qianchuan_cooperation_id: str | None = None
    bind_status: str = "bound"
    remark: str | None = None


class QianchuanCooperationSyncIn(BaseModel):
    influencer_id: int
    remark: str | None = None


def _product_qianchuan_binding(db: Session, product_id: int) -> ProductQianchuanBinding | None:
    return db.scalars(select(ProductQianchuanBinding)
                      .where(ProductQianchuanBinding.product_id == product_id)).first()


def _qianchuan_coop_dict(row: QianchuanCooperationBinding, inf: Influencer | None = None) -> dict:
    return {
        "id": row.id,
        "product_id": row.product_id,
        "influencer_id": row.influencer_id,
        "influencer_nickname": inf.nickname if inf else None,
        "douyin_id": inf.douyin_id if inf else None,
        "shop_auth_id": row.shop_auth_id,
        "qianchuan_cooperation_id": row.qianchuan_cooperation_id,
        "bind_method": row.bind_method,
        "bind_status": row.bind_status,
        "remark": row.remark,
        "last_error": row.last_error,
        "bound_at": row.bound_at.isoformat() if row.bound_at else None,
        "updated_at": row.updated_at.isoformat(),
    }


@router.get("/{product_id}/qianchuan-cooperations")
def list_qianchuan_cooperations(product_id: int, user: User = Depends(current_user),
                                db: Session = Depends(get_db)):
    if not db.get(Product, product_id):
        raise HTTPException(404, "产品不存在")
    stmt = (select(QianchuanCooperationBinding, Influencer)
            .join(Influencer, QianchuanCooperationBinding.influencer_id == Influencer.id)
            .where(QianchuanCooperationBinding.product_id == product_id)
            .order_by(QianchuanCooperationBinding.updated_at.desc()))
    if user.role != "admin":
        stmt = stmt.where(Influencer.owner_bd_id == user.id)
    return [_qianchuan_coop_dict(row, inf) for row, inf in db.execute(stmt).all()]


@router.post("/{product_id}/qianchuan-cooperations")
def bind_qianchuan_cooperation(product_id: int, body: QianchuanCooperationIn,
                               user: User = Depends(current_user),
                               db: Session = Depends(get_db)):
    if not db.get(Product, product_id):
        raise HTTPException(404, "产品不存在")
    if body.bind_status not in QIANCHUAN_COOP_STATUSES:
        raise HTTPException(400, "千川合作绑定状态不支持")
    inf = _assert_owns_influencer(db, user, body.influencer_id)
    grant = db.scalars(select(AccessGrant).where(AccessGrant.product_id == product_id,
                                                 AccessGrant.influencer_id == inf.id)).first()
    if not grant:
        raise HTTPException(400, "该达人尚未授权此产品,请先在「授权达人」开放产品")
    external_id = _clean_text(body.qianchuan_cooperation_id, 64, "千川合作ID")
    if not external_id:
        raise HTTPException(400, "请填写千川合作ID;一键同步请使用「从已授权店铺同步」")
    binding = _product_qianchuan_binding(db, product_id)

    row = db.scalars(select(QianchuanCooperationBinding)
                     .where(QianchuanCooperationBinding.product_id == product_id,
                            QianchuanCooperationBinding.influencer_id == inf.id)).first()
    if not row:
        row = QianchuanCooperationBinding(product_id=product_id, influencer_id=inf.id)
        db.add(row)
    row.shop_auth_id = binding.shop_auth_id if binding else None
    row.qianchuan_cooperation_id = external_id
    row.bind_method = "manual_id" if external_id else "shop_auth"
    row.bind_status = body.bind_status
    row.remark = _clean_text(body.remark, 1000, "备注")
    row.last_error = None
    row.bound_by = user.id
    row.bound_at = datetime.now()
    db.commit()
    db.refresh(row)
    return _qianchuan_coop_dict(row, inf)


@router.post("/{product_id}/qianchuan-cooperations/sync")
async def sync_qianchuan_cooperation(product_id: int, body: QianchuanCooperationSyncIn,
                                     user: User = Depends(current_user),
                                     db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(404, "产品不存在")
    inf = _assert_owns_influencer(db, user, body.influencer_id)
    grant = db.scalars(select(AccessGrant).where(AccessGrant.product_id == product_id,
                                                 AccessGrant.influencer_id == inf.id)).first()
    if not grant:
        raise HTTPException(400, "该达人尚未授权此产品,请先在「授权达人」开放产品")
    binding = _product_qianchuan_binding(db, product_id)
    if not binding or not binding.shop_auth_id:
        raise HTTPException(400, "请先完成千川店铺授权或选择已授权店铺")
    if not binding.qianchuan_product_id:
        raise HTTPException(400, "请先填写千川商品ID")
    shop_auth = db.get(QianchuanShopAuth, binding.shop_auth_id)
    if not shop_auth or shop_auth.auth_status != "active":
        raise HTTPException(400, "千川店铺授权不存在或不可用")
    if not shop_auth.access_token:
        raise HTTPException(400, "千川店铺授权缺少 access_token,请重新授权")
    if shop_auth.expires_at and shop_auth.expires_at <= datetime.now():
        raise HTTPException(400, "千川店铺授权已过期,请重新授权")
    if not qianchuan_service.cooperation_sync_configured():
        raise HTTPException(400, "千川合作同步接口未接入,请先使用手动合作ID绑定")

    payload = {
        "product_id": product.id,
        "product_name": product.name,
        "qianchuan_product_id": binding.qianchuan_product_id,
        "advertiser_id": binding.advertiser_id or shop_auth.advertiser_id,
        "shop_id": binding.shop_id or shop_auth.shop_id,
        "influencer_id": inf.id,
        "douyin_id": inf.douyin_id,
        "douyin_uid": inf.douyin_uid,
        "cooperation_code": inf.cooperation_code,
        "remark": _clean_text(body.remark, 1000, "备注"),
    }
    try:
        result = await qianchuan_service.sync_cooperation(crypto.decrypt(shop_auth.access_token), payload)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    row = db.scalars(select(QianchuanCooperationBinding)
                     .where(QianchuanCooperationBinding.product_id == product_id,
                            QianchuanCooperationBinding.influencer_id == inf.id)).first()
    if not row:
        row = QianchuanCooperationBinding(product_id=product_id, influencer_id=inf.id)
        db.add(row)
    row.shop_auth_id = shop_auth.id
    row.qianchuan_cooperation_id = result["qianchuan_cooperation_id"]
    row.bind_method = "shop_auth"
    row.bind_status = "bound"
    row.remark = payload["remark"]
    row.last_error = None
    row.bound_by = user.id
    row.bound_at = datetime.now()
    db.commit()
    db.refresh(row)
    return _qianchuan_coop_dict(row, inf)


@router.delete("/{product_id}/qianchuan-cooperations/{binding_id}")
def delete_qianchuan_cooperation(product_id: int, binding_id: int,
                                 user: User = Depends(current_user),
                                 db: Session = Depends(get_db)):
    row = db.get(QianchuanCooperationBinding, binding_id)
    if not row or row.product_id != product_id:
        raise HTTPException(404, "千川合作绑定不存在")
    inf = db.get(Influencer, row.influencer_id)
    if not owns_or_admin(user, inf.owner_bd_id if inf else None):
        raise HTTPException(403, "只能操作自己名下达人的千川合作绑定")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/{product_id}")
def detail(product_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(404, "产品不存在")
    materials = db.scalars(
        select(Material)
        .where(Material.product_id == product_id)
        .order_by(Material.created_at.desc(), Material.id.desc())
    ).all()
    binding = db.scalars(select(ProductQianchuanBinding)
                         .where(ProductQianchuanBinding.product_id == product_id)).first()
    return {"id": p.id, "name": p.name, "price_text": p.price_text, "shop_name": p.shop_name,
            "shop_product_id": p.shop_product_id, "link": p.link, "status": p.status,
            "product_image": storage.thumbnail_url(p.product_image, 160),
            "product_image_original": storage.signed_url(p.product_image) if p.product_image else None,
            "product_images": [storage.thumbnail_url(k, 160) for k in (p.product_images or [])],
            "product_images_keys": list(p.product_images or []),
            "default_commission": float(p.default_commission) if p.default_commission else None,
            "selling_points": p.selling_points, "shooting_notes": p.shooting_notes,
            "sample_remark": p.sample_remark, "promo_remark": p.promo_remark,
            "auto_audit_type": p.auto_audit_type, "allow_promotion": p.allow_promotion,
            "qianchuan_binding": _qianchuan_binding_dict(binding),
            "materials": [_material_dict(m) for m in materials]}


# ---------- 授权达人 ----------

class GrantIn(BaseModel):
    influencer_id: int


def _assert_owns_influencer(db: Session, user: User, influencer_id: int) -> Influencer:
    """商务只能对自己名下达人操作;管理员不限。"""
    inf = db.get(Influencer, influencer_id)
    if not inf:
        raise HTTPException(404, "达人不存在")
    if not owns_or_admin(user, inf.owner_bd_id):
        raise HTTPException(403, "只能操作自己名下的达人")
    return inf


@router.post("/{product_id}/grant")
def grant(product_id: int, body: GrantIn,
          user: User = Depends(current_user), db: Session = Depends(get_db)):
    inf = _assert_owns_influencer(db, user, body.influencer_id)
    existed = db.scalars(select(AccessGrant).where(
        AccessGrant.influencer_id == body.influencer_id,
        AccessGrant.product_id == product_id)).first()
    db.merge(AccessGrant(influencer_id=body.influencer_id, product_id=product_id,
                         granted_by=user.id))
    if not existed:
        prod = db.get(Product, product_id)
        log_op(db, influencer_id=inf.id, product_id=product_id, event_type="product_granted",
               actor=user, summary=f"{user.display_name} 开放产品:{prod.name if prod else ''}")
    db.commit()
    return {"ok": True}


@router.get("/{product_id}/grants")
def list_grants(product_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = (select(AccessGrant, Influencer)
            .join(Influencer, AccessGrant.influencer_id == Influencer.id)
            .where(AccessGrant.product_id == product_id)
            .order_by(AccessGrant.granted_at.desc()))
    if user.role != "admin":   # 商务只见自己名下达人的授权
        stmt = stmt.where(Influencer.owner_bd_id == user.id)
    rows = db.execute(stmt).all()
    return [{"influencer_id": inf.id, "nickname": inf.nickname, "douyin_id": inf.douyin_id,
             "granted_at": g.granted_at.isoformat()} for g, inf in rows]


@router.delete("/{product_id}/grant/{influencer_id}")
def remove_grant(product_id: int, influencer_id: int,
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    inf = _assert_owns_influencer(db, user, influencer_id)
    row = db.scalars(select(AccessGrant).where(AccessGrant.product_id == product_id,
                                               AccessGrant.influencer_id == influencer_id)).first()
    if row:
        db.delete(row)
        prod = db.get(Product, product_id)
        log_op(db, influencer_id=inf.id, product_id=product_id, event_type="product_revoked",
               actor=user, summary=f"{user.display_name} 收回产品:{prod.name if prod else ''}")
        db.commit()
    return {"ok": True}


# ---------- 产品动态(产品视角:该品的寄样/视频/投流概览) ----------

@router.get("/{product_id}/activity")
def activity(product_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    scoped = user.role != "admin"   # 商务只见自己名下达人在本品的动态
    s_stmt = (select(SampleOrder, Influencer)
              .join(Cooperation, SampleOrder.cooperation_id == Cooperation.id)
              .join(Influencer, Cooperation.influencer_id == Influencer.id)
              .where(SampleOrder.product_id == product_id)
              .order_by(SampleOrder.created_at.desc()).limit(100))
    if scoped:
        s_stmt = s_stmt.where(Influencer.owner_bd_id == user.id)
    samples = [{"id": o.id, "nickname": inf.nickname, "status": o.status,
                "created_at": o.created_at.isoformat()}
               for o, inf in dedupe_sample_rows(db.execute(s_stmt).all(), influencer_index=1)]
    v_stmt = (select(VideoTask, Influencer)
              .join(Cooperation, VideoTask.cooperation_id == Cooperation.id)
              .join(Influencer, Cooperation.influencer_id == Influencer.id)
              .where(VideoTask.product_id == product_id)
              .order_by(VideoTask.created_at.desc()).limit(100))
    if scoped:
        v_stmt = v_stmt.where(Influencer.owner_bd_id == user.id)
    videos = [{"id": v.id, "nickname": inf.nickname, "status": v.status,
               "created_at": v.created_at.isoformat()}
              for v, inf in db.execute(v_stmt).all()]
    return {"samples": samples, "videos": videos}


class OrderIn(BaseModel):
    influencer_id: int
    order_date: str
    amount: float
    note: str | None = None


@router.post("/{product_id}/orders")
def record_order(product_id: int, body: OrderIn,
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    """出单登记(蝉妈妈接入前人工登记 GMV)"""
    _assert_owns_influencer(db, user, body.influencer_id)
    try:
        order_date = datetime.fromisoformat(body.order_date)
    except (ValueError, TypeError):
        raise HTTPException(400, "出单日期格式不正确")
    o = OrderRecord(influencer_id=body.influencer_id, product_id=product_id,
                    order_date=order_date,
                    amount=Decimal(str(body.amount)), note=body.note, recorded_by=user.id)
    db.add(o)
    prod = db.get(Product, product_id)
    log_op(db, influencer_id=body.influencer_id, product_id=product_id, event_type="order_recorded",
           actor=user, summary=f"{user.display_name} 登记出单 ¥{body.amount}({prod.name if prod else ''})",
           detail={"amount": float(body.amount), "order_date": order_date.date().isoformat()})
    db.commit()
    return {"id": o.id}


@router.get("/{product_id}/orders")
def list_orders(product_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """本产品的出单登记(商务只见自己名下达人的登记)。"""
    stmt = (select(OrderRecord, Influencer)
            .join(Influencer, OrderRecord.influencer_id == Influencer.id)
            .where(OrderRecord.product_id == product_id)
            .order_by(OrderRecord.order_date.desc()))
    if user.role != "admin":
        stmt = stmt.where(Influencer.owner_bd_id == user.id)
    return [{"id": o.id, "influencer_id": inf.id, "influencer_nickname": inf.nickname,
             "order_date": o.order_date.date().isoformat(), "amount": float(o.amount),
             "note": o.note} for o, inf in db.execute(stmt).all()]


class OrderEditIn(BaseModel):
    order_date: str | None = None
    amount: float | None = None
    note: str | None = None


def _load_owned_order_record(db: Session, user: User, order_id: int) -> OrderRecord:
    o = db.get(OrderRecord, order_id)
    if not o:
        raise HTTPException(404, "出单记录不存在")
    inf = db.get(Influencer, o.influencer_id)
    if not owns_or_admin(user, inf.owner_bd_id if inf else None):
        raise HTTPException(403, "只能操作自己名下达人的出单记录")
    return o


@router.patch("/orders/{order_id}")
def edit_order(order_id: int, body: OrderEditIn,
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    o = _load_owned_order_record(db, user, order_id)
    if body.order_date is not None:
        try:
            o.order_date = datetime.fromisoformat(body.order_date)
        except (ValueError, TypeError):
            raise HTTPException(400, "出单日期格式不正确")
    if body.amount is not None:
        o.amount = Decimal(str(body.amount))
    if body.note is not None:
        o.note = body.note
    log_op(db, influencer_id=o.influencer_id, product_id=o.product_id, event_type="order_updated",
           actor=user, summary=f"{user.display_name} 修改出单记录 ¥{float(o.amount)}")
    db.commit()
    return {"ok": True}


@router.delete("/orders/{order_id}")
def delete_order(order_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    o = _load_owned_order_record(db, user, order_id)
    log_op(db, influencer_id=o.influencer_id, product_id=o.product_id, event_type="order_deleted",
           actor=user, summary=f"{user.display_name} 删除出单记录 ¥{float(o.amount)}")
    db.delete(o)
    db.commit()
    return {"ok": True}
