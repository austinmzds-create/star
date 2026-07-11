"""达人 H5(task.jisheng.yun):短信验证进入 → 自助提交资料 → 查看被开放产品的素材 → 看自己寄样进度。

数据隔离红线:达人只能读写自己的数据 + 被授权(AccessGrant)产品的素材;
绝不返回他人手机/地址/真名或未授权产品。
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_influencer, make_token
from ..models import (AccessGrant, Cooperation, Influencer, Material,
                      MaterialDownloadLog, Product, SampleOrder)
from ..services import storage
from ..services.parser import parse_influencer_text
from ..services.sms import send_code, verify_code

router = APIRouter(prefix="/api/h5", tags=["h5"])


class PhoneIn(BaseModel):
    phone: str


@router.post("/sms/send")
async def sms_send(body: PhoneIn, db: Session = Depends(get_db)):
    if len(body.phone) != 11 or not body.phone.startswith("1"):
        raise HTTPException(400, "手机号格式不正确")
    await send_code(db, body.phone)
    return {"ok": True}


class VerifyIn(BaseModel):
    phone: str
    code: str


@router.post("/sms/verify")
def sms_verify(body: VerifyIn, db: Session = Depends(get_db)):
    if not verify_code(db, body.phone, body.code):
        raise HTTPException(400, "验证码错误或已过期")
    inf = db.scalars(select(Influencer).where(Influencer.phone == body.phone)).first()
    if not inf:
        inf = Influencer(nickname=f"达人{body.phone[-4:]}", phone=body.phone, source="h5")
        db.add(inf)
        db.commit()
    return {"token": make_token("influencer", inf.id),
            "is_new": inf.raw_intro is None, "nickname": inf.nickname}


@router.get("/me")
def me(inf: Influencer = Depends(current_influencer), db: Session = Depends(get_db)):
    """达人自己的档案(仅自己)+ 寄样进度"""
    coop_ids = db.scalars(select(Cooperation.id)
                          .where(Cooperation.influencer_id == inf.id)).all() or [0]
    samples = []
    for o, prod in db.execute(
        select(SampleOrder, Product).join(Product, SampleOrder.product_id == Product.id)
        .where(SampleOrder.cooperation_id.in_(coop_ids))
        .order_by(SampleOrder.created_at.desc())
    ).all():
        status = o.status
        if o.logistics_status and o.status in ("shipped", "in_transit"):
            status = o.logistics_status.get("status", status)
        samples.append({"product_name": prod.name, "status": status,
                        "tracking_no": o.tracking_no,
                        "signed": bool(o.signed_at), "created_at": o.created_at.isoformat()})
    return {
        "nickname": inf.nickname, "douyin_id": inf.douyin_id, "fans_count": inf.fans_count,
        "level": inf.level, "has_profile": inf.raw_intro is not None,
        "samples": samples,
    }


class IntroIn(BaseModel):
    text: str


@router.post("/submit")
async def submit(body: IntroIn, inf: Influencer = Depends(current_influencer),
                 db: Session = Depends(get_db)):
    """达人粘贴自我介绍,解析结果落到自己档案(商务后台可见并复核)"""
    result = await parse_influencer_text(body.text)
    f = result["fields"]
    inf.raw_intro = body.text
    for field in ("nickname", "douyin_id", "douyin_uid", "homepage_url",
                  "fans_count", "category_tags", "shoot_type", "real_name",
                  "phone", "cooperation_code", "default_address"):
        if f.get(field):
            setattr(inf, field, f[field])
    db.commit()
    return {"ok": True, "parsed": f}


@router.get("/products")
def my_products(inf: Influencer = Depends(current_influencer), db: Session = Depends(get_db)):
    """只返回被授权(AccessGrant)且上架的产品"""
    pids = db.scalars(select(AccessGrant.product_id)
                      .where(AccessGrant.influencer_id == inf.id)).all()
    rows = db.scalars(select(Product).where(Product.id.in_(pids or [0]),
                                            Product.status == "on")).all()
    return [{"id": p.id, "name": p.name, "price_text": p.price_text,
             "product_image": storage.signed_url(p.product_image) if p.product_image else None}
            for p in rows]


def _assert_granted(db: Session, inf_id: int, product_id: int):
    ok = db.scalars(select(AccessGrant).where(AccessGrant.influencer_id == inf_id,
                                              AccessGrant.product_id == product_id)).first()
    if not ok:
        raise HTTPException(403, "该产品未对你开放")


@router.get("/products/{product_id}/materials")
def my_materials(product_id: int, inf: Influencer = Depends(current_influencer),
                 db: Session = Depends(get_db)):
    _assert_granted(db, inf.id, product_id)
    p = db.get(Product, product_id)
    return {"name": p.name, "selling_points": p.selling_points,
            "shooting_notes": p.shooting_notes,
            "materials": [{"id": m.id, "type": m.type, "title": m.title,
                           "url": storage.signed_url(m.oss_key) if m.oss_key else None,
                           "source_link": m.source_link, "parsed_text": m.parsed_text,
                           "report_id": m.report_id, "downloadable": m.downloadable}
                          for m in p.materials]}


@router.post("/materials/{material_id}/download")
def log_download(material_id: int, inf: Influencer = Depends(current_influencer),
                 db: Session = Depends(get_db)):
    """下载留痕;严格校验该素材所属产品已授权给本达人(数据隔离红线)"""
    m = db.get(Material, material_id)
    if not m or not m.downloadable or not m.oss_key:
        raise HTTPException(403, "素材不可下载")
    _assert_granted(db, inf.id, m.product_id)  # 关键:必须授权
    db.add(MaterialDownloadLog(material_id=material_id, influencer_id=inf.id))
    db.commit()
    return {"url": storage.signed_url(m.oss_key)}
