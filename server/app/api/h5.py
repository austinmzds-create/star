"""达人 H5(task.jisheng.yun):短信验证进入 → 自助提交资料 → 查看被开放产品的素材。"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_influencer, make_token
from ..models import (AccessGrant, Influencer, Material, MaterialDownloadLog,
                      Product)
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
        # 新达人:先建最小档案,资料在下一步 submit 补全
        inf = Influencer(nickname=f"达人{body.phone[-4:]}", phone=body.phone, source="h5")
        db.add(inf)
        db.commit()
    return {"token": make_token("influencer", inf.id),
            "is_new": inf.raw_intro is None, "nickname": inf.nickname}


class IntroIn(BaseModel):
    text: str


@router.post("/submit")
async def submit(body: IntroIn, inf: Influencer = Depends(current_influencer),
                 db: Session = Depends(get_db)):
    """达人粘贴自我介绍,解析结果直接落到自己档案(商务后台可见并复核)"""
    result = await parse_influencer_text(body.text)
    f = result["fields"]
    inf.raw_intro = body.text
    for field in ("nickname", "douyin_id", "douyin_uid", "homepage_url",
                  "fans_count", "category_tags", "shoot_type"):
        if f.get(field):
            setattr(inf, field, f[field])
    db.commit()
    return {"ok": True, "parsed": f}


@router.get("/products")
def my_products(inf: Influencer = Depends(current_influencer), db: Session = Depends(get_db)):
    """只返回被单独授权的产品(等级默认开放策略由商务在授权时落成 AccessGrant)"""
    pids = db.scalars(select(AccessGrant.product_id)
                      .where(AccessGrant.influencer_id == inf.id)).all()
    rows = db.scalars(select(Product).where(Product.id.in_(pids or [0]),
                                            Product.status == "on")).all()
    return [{"id": p.id, "name": p.name, "price_text": p.price_text} for p in rows]


@router.get("/products/{product_id}/materials")
def my_materials(product_id: int, inf: Influencer = Depends(current_influencer),
                 db: Session = Depends(get_db)):
    granted = db.scalars(select(AccessGrant).where(AccessGrant.influencer_id == inf.id,
                                                   AccessGrant.product_id == product_id)).first()
    if not granted:
        raise HTTPException(403, "该产品未对你开放")
    p = db.get(Product, product_id)
    return {"name": p.name, "selling_points": p.selling_points,
            "shooting_notes": p.shooting_notes,
            "materials": [{"id": m.id, "type": m.type, "title": m.title,
                           "oss_key": m.oss_key, "report_id": m.report_id,
                           "downloadable": m.downloadable} for m in p.materials]}


@router.post("/materials/{material_id}/download")
def log_download(material_id: int, inf: Influencer = Depends(current_influencer),
                 db: Session = Depends(get_db)):
    """下载留痕;返回 OSS 签名地址(OSS 接入后替换为真实签名 URL)"""
    m = db.get(Material, material_id)
    if not m or not m.downloadable:
        raise HTTPException(403, "素材不可下载")
    db.add(MaterialDownloadLog(material_id=material_id, influencer_id=inf.id))
    db.commit()
    return {"url": f"/oss/{m.oss_key}"}  # TODO(P0): 阿里云 OSS 签名 URL
