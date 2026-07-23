"""达人 H5(task.jisheng.yun):短信验证进入 → 自助提交资料 → 查看被开放产品的素材 → 看自己寄样进度。

数据隔离红线:达人能看全部上架产品与公开素材;申请/寄样/物流/评论等个人流程
只返回自己的数据,绝不返回他人手机/地址/真名或别人的带货状态。
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_influencer, make_token
from ..models import (Cooperation, Influencer, Material, MaterialComment,
                      MaterialDownloadLog, MaterialPost, MaterialReadState,
                      Product, ProductApplication, SampleOrder, VideoTask,
                      now)
from ..services import storage
from ..services.identity import normalize_douyin, normalize_phone
from ..services.oplog import log_op
from ..services.parser import parse_influencer_text
from ..services import product_applications as app_service
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
        raw = fields.get(field)
        value = normalize_douyin(raw) if field == "douyin_id" else _clean_identity(raw)
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
    # 归一化后再发码,保证验证码键、登录匹配键与商务建档口径完全一致
    phone = normalize_phone(body.phone)
    if not phone:
        raise HTTPException(400, "手机号格式不正确")
    try:
        await send_code(db, phone)
    except SmsError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


class VerifyIn(BaseModel):
    phone: str
    code: str


@router.post("/sms/verify")
def sms_verify(body: VerifyIn, db: Session = Depends(get_db)):
    phone = normalize_phone(body.phone)
    if not phone:
        raise HTTPException(400, "手机号格式不正确")
    if not verify_code(db, phone, body.code):
        raise HTTPException(400, "验证码错误或已过期")
    # 用归一化手机号匹配已有档案(含已停用):
    # - 命中在用档案 → 进入该档案(商务预先建好的资料即在此)
    # - 命中已停用档案 → 拒绝,不新开号(与内部端 auth 口径一致,避免绕过停用)
    # - 未命中 → 首次登录,新建自助档案
    inf = db.scalars(
        select(Influencer)
        .where(Influencer.phone == phone)
        .order_by(Influencer.id)
    ).first()
    if inf and inf.archived:
        raise HTTPException(403, "该账号已停用,请联系对接商务")
    created = False
    if not inf:
        inf = Influencer(nickname=f"达人{phone[-4:]}", phone=phone, source="h5")
        db.add(inf)
        db.commit()
        created = True
    # is_new 表示"本次首登新建的账号",而非"资料是否填过";商务预建的档案不应被当新用户
    return {"token": make_token("influencer", inf.id),
            "is_new": created, "nickname": inf.nickname}


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
            "product_image": storage.thumbnail_url(prod.product_image, 160),
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
            # 抖音号统一去前导 @,与内部端撞库口径一致,避免同一人两条档案
            setattr(inf, field, normalize_douyin(f[field]) if field == "douyin_id" else f[field])
    db.commit()
    return {"ok": True, "parsed": f}


VIDEO_STATUS_LABEL = {
    "submitted": "审核中", "approved": "已通过",
    "rejected": "未通过", "blocked": "卡审",
}


def _video_feedback(v: VideoTask) -> tuple[str | None, list]:
    """从 audit_result 提取给达人看的反馈:仅未通过/卡审时给出最近一次原因;时间点评论始终返回。"""
    ar = v.audit_result or {}
    reason = None
    if v.status in ("rejected", "blocked"):
        for rec in reversed(ar.get("records") or []):
            if rec.get("reason"):
                reason = rec["reason"]
                break
    return reason, list(ar.get("time_comments") or [])


@router.get("/videos")
def my_videos(inf: Influencer = Depends(current_influencer), db: Session = Depends(get_db)):
    """达人自己的视频审核情况(数据隔离:仅本人)。卡审/未通过带原因 + 时间点评论,便于自查整改。"""
    coop_ids = db.scalars(select(Cooperation.id)
                          .where(Cooperation.influencer_id == inf.id)).all() or [0]
    rows = db.execute(
        select(VideoTask, Product).join(Product, VideoTask.product_id == Product.id)
        .where(VideoTask.cooperation_id.in_(coop_ids))
        .order_by(VideoTask.created_at.desc())
    ).all()
    out = []
    for v, prod in rows:
        reason, time_comments = _video_feedback(v)
        out.append({
            "id": v.id, "product_name": prod.name,
            "product_image": storage.thumbnail_url(prod.product_image, 160),
            "dy_url": v.dy_url, "status": v.status,
            "status_label": VIDEO_STATUS_LABEL.get(v.status, v.status),
            "blocked": v.blocked,
            "need_fix": v.status in ("rejected", "blocked"),
            "reject_reason": reason, "time_comments": time_comments,
            "created_at": v.created_at.isoformat(),
        })
    return out


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
    """达人可浏览全部上架产品;带货/寄样资格由 ProductApplication 单独表达。"""
    rows = db.scalars(select(Product).where(Product.status == "on")
                      .order_by(Product.updated_at.desc(), Product.id.desc())).all()
    product_ids = [p.id for p in rows]
    apps_by_product = {}
    if product_ids:
        apps_by_product = {
            app.product_id: app
            for app in db.scalars(
                select(ProductApplication)
                .where(ProductApplication.influencer_id == inf.id,
                       ProductApplication.product_id.in_(product_ids))
            ).all()
        }
    unread_by_product = {pid: {"total": 0, "videos": 0, "comments": 0} for pid in product_ids}
    if product_ids:
        video_mats = db.scalars(
            select(Material)
            .where(Material.product_id.in_(product_ids),
                   Material.type == "video_output",
                   Material.is_public.is_(True))
        ).all()
        video_ids = [m.id for m in video_mats]
        states_by_material = {}
        comments_by_material = {}
        if video_ids:
            states = db.scalars(
                select(MaterialReadState)
                .where(MaterialReadState.influencer_id == inf.id,
                       MaterialReadState.material_id.in_(video_ids))
            ).all()
            states_by_material = {s.material_id: s for s in states}
            comments = db.scalars(
                select(MaterialComment)
                .where(MaterialComment.material_id.in_(video_ids),
                       MaterialComment.is_deleted.is_(False))
            ).all()
            for c in comments:
                comments_by_material.setdefault(c.material_id, []).append(c)
        for m in video_mats:
            state = states_by_material.get(m.id)
            mat_seen_at = state.last_seen_material_at if state else None
            comments_seen_at = state.last_seen_comments_at if state else None
            if mat_seen_at is None or m.created_at > mat_seen_at:
                unread_by_product[m.product_id]["videos"] += 1
                unread_by_product[m.product_id]["total"] += 1
            new_comments = [
                c for c in comments_by_material.get(m.id, [])
                if comments_seen_at is None or c.created_at > comments_seen_at
            ]
            unread_by_product[m.product_id]["comments"] += len(new_comments)
            unread_by_product[m.product_id]["total"] += len(new_comments)
    out = []
    for p in rows:
        app = apps_by_product.get(p.id)
        sample = app_service.sample_for_application(db, app) if app else None
        status = app_service.display_status(app, sample) if app else None
        out.append({"id": p.id, "name": p.name, "price_text": p.price_text,
                    "default_commission": float(p.default_commission) if p.default_commission is not None else None,
                    "merchant_promotion_commission": (float(p.merchant_promotion_commission)
                                                       if p.merchant_promotion_commission is not None else None),
                    "selling_points": p.selling_points,
                    "allow_promotion": p.allow_promotion,
                    "product_image": storage.thumbnail_url(p.product_image, 160),
                    "application_status": app.status if app else None,
                    "cooperation_status": status,
                    "reject_reason": app.reject_reason if app else None,
                    "sample_status": sample.status if sample else None,
                    "unread_badge": unread_by_product.get(p.id, {}).get("total", 0),
                    "unread_video_count": unread_by_product.get(p.id, {}).get("videos", 0),
                    "unread_comment_count": unread_by_product.get(p.id, {}).get("comments", 0)})
    return out


def _product_visible_or_404(db: Session, product_id: int) -> Product:
    p = db.get(Product, product_id)
    if not p or p.status != "on":
        raise HTTPException(404, "产品不存在或已下架")
    return p


def _sample_payload(o: SampleOrder | None) -> dict | None:
    if not o:
        return None
    return {"id": o.id, "status": o.status, "tracking_no": o.tracking_no,
            "courier_company": o.courier_company, "logistics_status": o.logistics_status,
            "signed_at": o.signed_at.isoformat() if o.signed_at else None,
            "reject_reason": o.reject_reason,
            "created_at": o.created_at.isoformat()}


def _application_payload(app: ProductApplication | None, sample: SampleOrder | None,
                         product: Product) -> dict:
    if not app:
        return {"status": "none", "status_label": "未申请",
                "can_apply": bool(product.allow_promotion)}
    status = app_service.display_status(app, sample)
    labels = {"pending": "审核中", "approved": "审核通过,待发货", "rejected": "已拒绝",
              "cancelled": "已取消", "shipped": "已发货", "in_transit": "运输中", "signed": "已签收"}
    return {"id": app.id, "status": status, "application_status": app.status,
            "status_label": labels.get(status, status),
            "reject_reason": app.reject_reason, "note": app.note,
            "can_apply": app.status in {"rejected", "cancelled"} and bool(product.allow_promotion),
            "applied_at": app.applied_at.isoformat() if app.applied_at else None,
            "reviewed_at": app.reviewed_at.isoformat() if app.reviewed_at else None}


def _comment_attachment_dict(a) -> dict:
    url = storage.material_comment_attachment_url(a.id)
    inline_preview = bool(a.oss_key and storage.is_image(a.oss_key))
    return {
        "id": a.id,
        "filename": a.filename,
        "file_type": a.file_type,
        "content_type": a.content_type,
        "url": url,
        "preview_url": url,
        "download_url": storage.material_comment_attachment_url(a.id, download=True),
        "inline_preview": inline_preview,
    }


def _material_comment_dict(c: MaterialComment) -> dict:
    return {
        "id": c.id,
        "material_id": c.material_id,
        "body": c.body,
        "author_name": c.author_name,
        "author_role": c.author_role,
        "created_at": c.created_at.isoformat(),
        "attachments": [_comment_attachment_dict(a) for a in c.attachments],
    }


@router.get("/products/{product_id}/materials")
async def my_materials(product_id: int, inf: Influencer = Depends(current_influencer),
                       db: Session = Depends(get_db)):
    p = _product_visible_or_404(db, product_id)
    application = db.scalars(
        select(ProductApplication)
        .where(ProductApplication.influencer_id == inf.id,
               ProductApplication.product_id == product_id)
    ).first()
    # 该达人在本产品下的寄样(含物流轨迹),让"资料 + 快递"一屏聚合。
    # 新流程优先读 ProductApplication 绑定单;无申请时兼容历史寄样入口。
    sample_stmt = None
    o = app_service.sample_for_application(db, application) if application else None
    if application:
        if o:
            await refresh_if_needed(db, o)
    else:
        coop_ids = db.scalars(select(Cooperation.id)
                              .where(Cooperation.influencer_id == inf.id)).all() or [0]
        sample_stmt = (select(SampleOrder)
                       .where(SampleOrder.product_id == product_id,
                              SampleOrder.cooperation_id.in_(coop_ids))
                       .order_by(SampleOrder.created_at.desc()))
        sample_rows = db.execute(sample_stmt).all()
        for row in sample_rows:
            await refresh_if_needed(db, row[0])
        deduped_samples = dedupe_sample_rows(sample_rows)
        o = deduped_samples[0][0] if deduped_samples else None
    sample = _sample_payload(o)
    # 达人端:达人成片(video_output)默认不展示,仅管理员公开(is_public)的才作为参考露出
    materials = db.scalars(
        select(Material)
        .where(Material.product_id == product_id,
               or_(Material.type != "video_output", Material.is_public.is_(True)))
        .order_by(Material.created_at.desc(), Material.id.desc())
    ).all()
    posts = db.scalars(
        select(MaterialPost)
        .where(MaterialPost.product_id == product_id, MaterialPost.status == "published")
        .order_by(MaterialPost.created_at.desc(), MaterialPost.id.desc())
    ).all()
    video_ids = [m.id for m in materials if m.type == "video_output"]
    states_by_material = {}
    comments_by_material = {}
    if video_ids:
        states = db.scalars(
            select(MaterialReadState)
            .where(MaterialReadState.influencer_id == inf.id,
                   MaterialReadState.material_id.in_(video_ids))
        ).all()
        states_by_material = {s.material_id: s for s in states}
        comments = db.scalars(
            select(MaterialComment)
            .where(MaterialComment.material_id.in_(video_ids),
                   MaterialComment.is_deleted.is_(False))
            .order_by(MaterialComment.created_at.asc(), MaterialComment.id.asc())
        ).all()
        for c in comments:
            comments_by_material.setdefault(c.material_id, []).append(c)

    def _unread_for(m: Material) -> dict:
        if m.type != "video_output":
            return {"is_new": False, "comment_count": 0, "unread_comment_count": 0, "unread_total": 0}
        state = states_by_material.get(m.id)
        mat_seen_at = state.last_seen_material_at if state else None
        comments_seen_at = state.last_seen_comments_at if state else None
        is_new = mat_seen_at is None or m.created_at > mat_seen_at
        all_comments = comments_by_material.get(m.id, [])
        unread_comments = [
            c for c in all_comments
            if comments_seen_at is None or c.created_at > comments_seen_at
        ]
        return {
            "is_new": is_new,
            "comment_count": len(all_comments),
            "unread_comment_count": len(unread_comments),
            "unread_total": (1 if is_new else 0) + len(unread_comments),
        }

    def _asset(a):
        return {"id": a.id, "type": a.type,
                "url": storage.public_or_signed_url(a.oss_key) if a.oss_key else a.source_link,
                "preview_url": storage.preview_url(a.oss_key) if a.oss_key else a.source_link,
                "inline_preview": storage.inline_preview_enabled(),
                "thumb": storage.thumbnail_url(a.oss_key, 200) if (a.type == "image" and a.oss_key) else None,
                "filename": a.filename, "source_link": a.source_link}

    material_items = []
    unread_badges = {"video_output": 0}
    for m in materials:
        unread = _unread_for(m)
        unread_badges["video_output"] += unread["unread_total"] if m.type == "video_output" else 0
        inline_preview = bool(m.oss_key and storage.is_image(m.oss_key))
        item = {"id": m.id, "type": m.type, "title": m.title,
                "url": storage.material_file_url(m.id) if m.oss_key else None,
                "preview_url": storage.material_file_url(m.id) if m.oss_key else None,
                "download_url": storage.material_file_url(m.id, download=True) if m.oss_key else None,
                "is_image": storage.is_image(m.oss_key) if m.oss_key else False,
                "inline_preview": inline_preview,
                "source_link": m.source_link, "parsed_text": m.parsed_text,
                "report_id": m.report_id, "downloadable": m.downloadable,
                **unread}
        if m.type == "video_output":
            item["comments"] = [_material_comment_dict(c) for c in comments_by_material.get(m.id, [])]
        material_items.append(item)

    return {"id": p.id, "name": p.name,
            "product_image": storage.thumbnail_url(p.product_image, 160),
            "price_text": p.price_text,
            "default_commission": float(p.default_commission) if p.default_commission is not None else None,
            "merchant_promotion_commission": (float(p.merchant_promotion_commission)
                                               if p.merchant_promotion_commission is not None else None),
            "selling_points": p.selling_points, "shooting_notes": p.shooting_notes,
            "promo_remark": p.promo_remark,
            "allow_promotion": p.allow_promotion,
            "application": _application_payload(application, o, p),
            "sample": sample,
            "material_posts": [{"id": post.id, "category": post.category, "title": post.title,
                                "caption": post.caption, "downloadable": post.downloadable,
                                "author_name": post.author_name,
                                "created_at": post.created_at.isoformat(),
                                "assets": [_asset(a) for a in post.assets]}
                               for post in posts],
            "unread_badges": unread_badges,
            # 达人端只见"域名 + 素材 id + 签名",不下发 bucket/key
            "materials": material_items}


@router.post("/material-posts/{post_id}/download")
def log_post_download(post_id: int, inf: Influencer = Depends(current_influencer),
                      db: Session = Depends(get_db)):
    """内容帖下载留痕:校验授权 + 写统一操作日志(达人视角,进达人时间轴)。"""
    post = db.get(MaterialPost, post_id)
    if not post or post.status != "published" or not post.downloadable:
        raise HTTPException(403, "素材不可下载")
    _product_visible_or_404(db, post.product_id)
    label = post.title or (post.caption[:20] if post.caption else "内容帖")
    log_op(db, influencer_id=inf.id, product_id=post.product_id,
           event_type="material_downloaded", actor=inf,
           summary=f"{inf.nickname} 下载素材:{label}")
    db.commit()
    return {"ok": True}


class ApplyProductIn(BaseModel):
    note: str | None = None


@router.post("/products/{product_id}/apply")
def apply_product(product_id: int, body: ApplyProductIn,
                  inf: Influencer = Depends(current_influencer),
                  db: Session = Depends(get_db)):
    """达人申请带货。重复提交有明确状态,拒绝/取消后允许重新申请并保留日志。"""
    product = _product_visible_or_404(db, product_id)
    if product.allow_promotion is False:
        raise HTTPException(400, "该产品当前不允许带货")
    note = (body.note or "").strip()[:1000] or None
    app = db.scalars(
        select(ProductApplication)
        .where(ProductApplication.influencer_id == inf.id,
               ProductApplication.product_id == product_id)
    ).first()
    if app and app.status in {"pending", "approved"}:
        sample = app_service.latest_sample(db, inf.id, product_id)
        return {"ok": True, "application": _application_payload(app, sample, product)}
    if not app:
        app = ProductApplication(
            product_id=product_id,
            influencer_id=inf.id,
            source="influencer_apply",
            created_by_influencer_id=inf.id,
            owner_bd_id=inf.owner_bd_id,
        )
        db.add(app)
    app.status = "pending"
    app.source = "influencer_apply"
    app.reject_reason = None
    app.sample_order_id = None
    app.note = note
    app.applied_at = now()
    app.reviewed_by = None
    app.reviewed_at = None
    app_service.log_application_event(db, app, "product_application_submitted", actor=inf,
                                      summary=f"{inf.nickname} 申请带货:{product.name}",
                                      detail={"note": note} if note else None)
    db.commit()
    db.refresh(app)
    return {"ok": True, "application": _application_payload(app, None, product)}


class MaterialReadIn(BaseModel):
    scope: str = "all"  # all / material / comments


@router.post("/materials/{material_id}/read")
def mark_material_read(material_id: int, body: MaterialReadIn,
                       inf: Influencer = Depends(current_influencer),
                       db: Session = Depends(get_db)):
    """达人打开达人成片后标记已读,用于 H5 红色数字角标。"""
    m = db.get(Material, material_id)
    if not m or (m.type == "video_output" and not m.is_public):
        raise HTTPException(404, "素材不存在")
    _product_visible_or_404(db, m.product_id)
    if body.scope not in {"all", "material", "comments"}:
        raise HTTPException(400, "已读范围不支持")
    state = db.scalars(
        select(MaterialReadState)
        .where(MaterialReadState.material_id == material_id,
               MaterialReadState.influencer_id == inf.id)
    ).first()
    if not state:
        state = MaterialReadState(material_id=material_id, influencer_id=inf.id)
        db.add(state)
    ts = now()
    if body.scope in {"all", "material"}:
        state.last_seen_material_at = ts
    if body.scope in {"all", "comments"}:
        state.last_seen_comments_at = ts
    db.commit()
    return {"ok": True}


@router.post("/materials/{material_id}/download")
def log_download(material_id: int, inf: Influencer = Depends(current_influencer),
                 db: Session = Depends(get_db)):
    """下载留痕;达人可下载全部上架产品中开放下载的素材。"""
    m = db.get(Material, material_id)
    if not m or not m.downloadable or not m.oss_key:
        raise HTTPException(403, "素材不可下载")
    # 达人成片未公开时,达人不得凭 id 直接下载
    if m.type == "video_output" and not m.is_public:
        raise HTTPException(403, "素材不可下载")
    _product_visible_or_404(db, m.product_id)
    db.add(MaterialDownloadLog(material_id=material_id, influencer_id=inf.id))
    db.commit()
    # 返回 id 网关下载地址(自家域名、私有可读、302 直读不占带宽),不暴露裸 OSS URL
    return {"url": storage.material_file_url(m.id, download=True)}
