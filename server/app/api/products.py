"""产品中心:管理员维护产品与五类素材;开放权限;出单登记(看板 GMV 数据源)。"""
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_admin, current_user
from ..models import AccessGrant, Material, OrderRecord, Product, User

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


@router.post("")
def create(body: ProductIn, admin: User = Depends(current_admin), db: Session = Depends(get_db)):
    data = body.model_dump()
    if data.get("default_commission") is not None:
        data["default_commission"] = Decimal(str(data["default_commission"]))
    p = Product(**data)
    db.add(p)
    db.commit()
    return {"id": p.id}


@router.get("")
def list_products(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Product).order_by(Product.updated_at.desc())).all()
    return [{"id": p.id, "name": p.name, "price_text": p.price_text, "shop_name": p.shop_name,
             "status": p.status, "material_count": len(p.materials)} for p in rows]


class MaterialIn(BaseModel):
    type: str  # video_ai / video_hot / video_output / image / pdf / copy
    title: str | None = None
    oss_key: str | None = None
    source_link: str | None = None   # 爆款抖音链接(转存+解析任务 P0 后台任务化)
    parsed_text: str | None = None
    report_id: str | None = None
    downloadable: bool = True


@router.post("/{product_id}/materials")
def add_material(product_id: int, body: MaterialIn,
                 admin: User = Depends(current_admin), db: Session = Depends(get_db)):
    if not db.get(Product, product_id):
        raise HTTPException(404, "产品不存在")
    m = Material(product_id=product_id, **body.model_dump())
    db.add(m)
    db.commit()
    # TODO(P0): source_link 非空时投递后台任务:下载视频→转存OSS→解析文案回填 parsed_text
    return {"id": m.id}


@router.get("/{product_id}")
def detail(product_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(404, "产品不存在")
    return {"id": p.id, "name": p.name, "price_text": p.price_text, "shop_name": p.shop_name,
            "shop_product_id": p.shop_product_id, "link": p.link, "status": p.status,
            "default_commission": float(p.default_commission) if p.default_commission else None,
            "selling_points": p.selling_points, "shooting_notes": p.shooting_notes,
            "materials": [{"id": m.id, "type": m.type, "title": m.title, "oss_key": m.oss_key,
                           "source_link": m.source_link, "report_id": m.report_id,
                           "downloadable": m.downloadable, "starred": m.starred}
                          for m in p.materials]}


class GrantIn(BaseModel):
    influencer_id: int


@router.post("/{product_id}/grant")
def grant(product_id: int, body: GrantIn,
          user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.merge(AccessGrant(influencer_id=body.influencer_id, product_id=product_id,
                         granted_by=user.id))
    db.commit()
    return {"ok": True}


class OrderIn(BaseModel):
    influencer_id: int
    order_date: str  # YYYY-MM-DD
    amount: float
    note: str | None = None


@router.post("/{product_id}/orders")
def record_order(product_id: int, body: OrderIn,
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    """出单登记(已拍板:蝉妈妈接入前人工登记 GMV)"""
    db.add(OrderRecord(influencer_id=body.influencer_id, product_id=product_id,
                       order_date=datetime.fromisoformat(body.order_date),
                       amount=Decimal(str(body.amount)), note=body.note, recorded_by=user.id))
    db.commit()
    return {"ok": True}
