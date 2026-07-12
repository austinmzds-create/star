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
                      OrderRecord, Product, SampleOrder, User,
                      VideoTask)
from ..services import storage

router = APIRouter(prefix="/api/products", tags=["products"])


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
    if data.get("default_commission") is not None:
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
    db.query(Material).filter(Material.product_id == product_id).delete()
    db.query(AccessGrant).filter(AccessGrant.product_id == product_id).delete()
    db.delete(p)
    db.commit()
    return {"ok": True}


def _grant_count(db: Session, pid: int) -> int:
    return db.scalar(select(func.count()).select_from(AccessGrant)
                     .where(AccessGrant.product_id == pid)) or 0


@router.get("")
def list_products(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Product).order_by(Product.updated_at.desc())).all()
    return [{"id": p.id, "name": p.name, "price_text": p.price_text, "shop_name": p.shop_name,
             "product_image": storage.signed_url(p.product_image) if p.product_image else None,
             "default_commission": float(p.default_commission) if p.default_commission else None,
             "status": p.status, "material_count": len(p.materials),
             "granted_count": _grant_count(db, p.id),
             "created_at": p.created_at.isoformat()} for p in rows]


class MaterialIn(BaseModel):
    type: str  # video_ai / video_hot / video_output / image / pdf / copy
    title: str | None = None
    oss_key: str | None = None
    source_link: str | None = None
    parsed_text: str | None = None
    report_id: str | None = None
    downloadable: bool = True


@router.post("/{product_id}/materials")
def add_material(product_id: int, body: MaterialIn,
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not db.get(Product, product_id):
        raise HTTPException(404, "产品不存在")
    m = Material(product_id=product_id, **body.model_dump())
    db.add(m)
    db.commit()
    # TODO: source_link 非空时后台任务:下载视频→转存OSS→解析文案回填 parsed_text
    return {"id": m.id}


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
            "report_id": m.report_id, "downloadable": m.downloadable, "starred": m.starred}


@router.get("/{product_id}")
def detail(product_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(404, "产品不存在")
    return {"id": p.id, "name": p.name, "price_text": p.price_text, "shop_name": p.shop_name,
            "shop_product_id": p.shop_product_id, "link": p.link, "status": p.status,
            "product_image": storage.signed_url(p.product_image) if p.product_image else None,
            "product_images": [storage.signed_url(k) for k in (p.product_images or [])],
            "product_images_keys": list(p.product_images or []),
            "default_commission": float(p.default_commission) if p.default_commission else None,
            "selling_points": p.selling_points, "shooting_notes": p.shooting_notes,
            "sample_remark": p.sample_remark, "promo_remark": p.promo_remark,
            "auto_audit_type": p.auto_audit_type, "allow_promotion": p.allow_promotion,
            "materials": [_material_dict(m) for m in p.materials]}


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
    _assert_owns_influencer(db, user, body.influencer_id)
    db.merge(AccessGrant(influencer_id=body.influencer_id, product_id=product_id,
                         granted_by=user.id))
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
    _assert_owns_influencer(db, user, influencer_id)
    row = db.scalars(select(AccessGrant).where(AccessGrant.product_id == product_id,
                                               AccessGrant.influencer_id == influencer_id)).first()
    if row:
        db.delete(row)
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
               for o, inf in db.execute(s_stmt).all()]
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
    db.add(OrderRecord(influencer_id=body.influencer_id, product_id=product_id,
                       order_date=order_date,
                       amount=Decimal(str(body.amount)), note=body.note, recorded_by=user.id))
    db.commit()
    return {"ok": True}
