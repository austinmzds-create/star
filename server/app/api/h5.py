"""达人 H5(task.jisheng.yun):短信验证进入 → 自助提交资料 → 查看被开放产品的素材 → 看自己寄样进度。

数据隔离红线:达人只能读写自己的数据 + 被授权(AccessGrant)产品的素材;
绝不返回他人手机/地址/真名或未授权产品。
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_influencer, make_token
from ..models import (AccessGrant, Cooperation, Influencer, Material,
                      MaterialDownloadLog, Product, SampleOrder)
from ..services import storage
from ..services.parser import parse_influencer_text
from ..services.sample_orders import dedupe_sample_rows
from ..services.sms import SmsError, send_code, verify_code
from ..services.tracking import refresh_if_needed, refresh_order_tracking

router = APIRouter(prefix="/api/h5", tags=["h5"])

H5_IDENTITY_FIELDS = ("douyin_id", "douyin_uid", "cooperation_code")


def _clean_identity(value):
    if isinstance(value, str):
        value = value.strip()
    return value or None


def _assert_identity_available(db: Session, inf: Influencer, fields: dict) -> None:
    conds = []
    for field in H5_IDENTITY_FIELDS:
        value = _clean_identity(fields.get(field))
        if value:
            conds.append(getattr(Influencer, field) == value)
    if not conds:
        return
    existing = db.scalars(
        select(Influencer)
        .where(Influencer.id != inf.id, Influencer.archived.is_not(True), or_(*conds))
        .order_by(Influencer.id)
    ).first()
    if existing:
        raise HTTPException(409, "该抖音号/UID/合作码已存在,请联系商务合并资料,不要重复建档")


class PhoneIn(BaseModel):
    phone: str


@router.post("/sms/send")
async def sms_send(body: PhoneIn, db: Session = Depends(get_db)):
    if len(body.phone) != 11 or not body.phone.startswith("1"):
        raise HTTPException(400, "手机号格式不正确")
    try:
        await send_code(db, body.phone)
    except SmsError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


class VerifyIn(BaseModel):
    phone: str
    code: str


@router.post("/sms/verify")
def sms_verify(body: VerifyIn, db: Session = Depends(get_db)):
    if not verify_code(db, body.phone, body.code):
        raise HTTPException(400, "验证码错误或已过期")
    inf = db.scalars(
        select(Influencer)
        .where(Influencer.phone == body.phone, Influencer.archived.is_not(True))
        .order_by(Influencer.id)
    ).first()
    if not inf:
        inf = Influencer(nickname=f"达人{body.phone[-4:]}", phone=body.phone, source="h5")
        db.add(inf)
        db.commit()
    return {"token": make_token("influencer", inf.id),
            "is_new": inf.raw_intro is None, "nickname": inf.nickname}


@router.get("/me")
async def me(inf: Influencer = Depends(current_influencer), db: Session = Depends(get_db)):
    """达人自己的档案(仅自己)+ 寄样进度(含物流轨迹)"""
    coop_ids = db.scalars(select(Cooperation.id)
                          .where(Cooperation.influencer_id == inf.id)).all() or [0]
    samples = []
    sample_rows = db.execute(
        select(SampleOrder, Product).join(Product, SampleOrder.product_id == Product.id)
        .where(SampleOrder.cooperation_id.in_(coop_ids))
        .order_by(SampleOrder.created_at.desc())
    ).all()
    for row in sample_rows:
        await refresh_if_needed(db, row[0])
    for o, prod in dedupe_sample_rows(sample_rows):
        samples.append({
            "id": o.id, "product_name": prod.name,
            "product_image": storage.signed_url(prod.product_image) if prod.product_image else None,
            "status": o.status,
            "tracking_no": o.tracking_no, "courier_company": o.courier_company,
            "logistics_status": o.logistics_status,
            "signed_at": o.signed_at.isoformat() if o.signed_at else None,
            "reject_reason": o.reject_reason,
            "created_at": o.created_at.isoformat(),
        })
    return {
        "nickname": inf.nickname, "douyin_id": inf.douyin_id, "fans_count": inf.fans_count,
        "level": inf.level,
        "commission_tier": float(inf.commission_tier) if inf.commission_tier is not None else None,
        "cooperation_code": inf.cooperation_code,
        "real_name": inf.real_name, "phone": inf.phone,
        "default_address": inf.default_address, "category_tags": inf.category_tags,
        "has_profile": inf.raw_intro is not None,
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
    _assert_identity_available(db, inf, f)
    inf.raw_intro = body.text
    # 注意:不写 phone —— 它是 H5 登录标识,不能被解析出的"收件电话"覆盖
    for field in ("nickname", "douyin_id", "douyin_uid", "homepage_url",
                  "fans_count", "category_tags", "shoot_type", "real_name",
                  "cooperation_code", "default_address"):
        if f.get(field):
            setattr(inf, field, f[field])
    db.commit()
    return {"ok": True, "parsed": f}


@router.post("/samples/{order_id}/track")
async def track_my_sample(order_id: int, inf: Influencer = Depends(current_influencer),
                          db: Session = Depends(get_db)):
    """达人刷新自己寄样单的物流轨迹(严格校验该单属于本达人)。"""
    o = db.get(SampleOrder, order_id)
    if not o:
        raise HTTPException(404, "寄样单不存在")
    coop = db.get(Cooperation, o.cooperation_id)
    if not coop or coop.influencer_id != inf.id:   # 数据隔离红线:只能查自己的单
        raise HTTPException(403, "无权查看该寄样单")
    if not o.tracking_no or not o.courier_company:
        raise HTTPException(400, "该寄样单尚未发货")
    return await refresh_order_tracking(db, o)


@router.get("/products")
def my_products(inf: Influencer = Depends(current_influencer), db: Session = Depends(get_db)):
    """只返回被授权(AccessGrant)且上架的产品"""
    pids = db.scalars(select(AccessGrant.product_id)
                      .where(AccessGrant.influencer_id == inf.id)).all()
    rows = db.scalars(select(Product).where(Product.id.in_(pids or [0]),
                                            Product.status == "on")).all()
    return [{"id": p.id, "name": p.name, "price_text": p.price_text,
             "default_commission": float(p.default_commission) if p.default_commission is not None else None,
             "selling_points": p.selling_points,
             "product_image": storage.signed_url(p.product_image) if p.product_image else None}
            for p in rows]


def _assert_granted(db: Session, inf_id: int, product_id: int):
    ok = db.scalars(select(AccessGrant).where(AccessGrant.influencer_id == inf_id,
                                              AccessGrant.product_id == product_id)).first()
    if not ok:
        raise HTTPException(403, "该产品未对你开放")


@router.get("/products/{product_id}/materials")
async def my_materials(product_id: int, inf: Influencer = Depends(current_influencer),
                       db: Session = Depends(get_db)):
    _assert_granted(db, inf.id, product_id)
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(404, "产品不存在")
    # 该达人在本产品下的最新寄样(含物流轨迹),让"资料 + 快递"一屏聚合
    coop_ids = db.scalars(select(Cooperation.id)
                          .where(Cooperation.influencer_id == inf.id)).all() or [0]
    sample_rows = db.execute(
        select(SampleOrder)
        .where(SampleOrder.product_id == product_id,
               SampleOrder.cooperation_id.in_(coop_ids))
        .order_by(SampleOrder.created_at.desc())
    ).all()
    for row in sample_rows:
        await refresh_if_needed(db, row[0])
    deduped_samples = dedupe_sample_rows(sample_rows)
    o = deduped_samples[0][0] if deduped_samples else None
    sample = None
    if o:
        sample = {"id": o.id, "status": o.status, "tracking_no": o.tracking_no,
                  "courier_company": o.courier_company, "logistics_status": o.logistics_status,
                  "signed_at": o.signed_at.isoformat() if o.signed_at else None,
                  "reject_reason": o.reject_reason,
                  "created_at": o.created_at.isoformat()}
    materials = db.scalars(
        select(Material)
        .where(Material.product_id == product_id)
        .order_by(Material.created_at.desc(), Material.id.desc())
    ).all()
    return {"id": p.id, "name": p.name,
            "product_image": storage.signed_url(p.product_image) if p.product_image else None,
            "price_text": p.price_text,
            "default_commission": float(p.default_commission) if p.default_commission is not None else None,
            "selling_points": p.selling_points, "shooting_notes": p.shooting_notes,
            "promo_remark": p.promo_remark,
            "sample": sample,
            "materials": [{"id": m.id, "type": m.type, "title": m.title,
                           "url": storage.signed_url(m.oss_key) if m.oss_key else None,
                           "source_link": m.source_link, "parsed_text": m.parsed_text,
                           "report_id": m.report_id, "downloadable": m.downloadable}
                          for m in materials]}


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
