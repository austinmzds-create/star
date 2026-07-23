"""产品中心:产品维护 + 五类素材 + 授权达人 + 商品信息编辑 + 产品动态 + 出单登记。"""
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user, owns_or_admin
from ..models import (AccessGrant, Cooperation, Influencer, Material,
                      MaterialAsset, MaterialComment,
                      MaterialCommentAttachment, MaterialDownloadLog,
                      MaterialPost, MaterialReadState, OrderRecord, Product,
                      ProductApplication, ProductQianchuanBinding,
                      QianchuanCooperationBinding, QianchuanShopAuth,
                      SampleOrder, User, VideoTask)
from ..services import crypto, storage
from ..services import qianchuan as qianchuan_service
from ..services import product_applications as app_service
from ..services.oplog import log_op
from ..services.sample_orders import dedupe_sample_rows

router = APIRouter(prefix="/api/products", tags=["products"])

MATERIAL_TYPES = {"video_ai", "video_hot", "video_output", "image", "pdf", "copy"}
# 达人成片:商务/管理员均可查看和评论;上传、编辑、删除、公开仍只允许管理员维护。
ADMIN_ONLY_MATERIAL_TYPES = {"video_output"}
QIANCHUAN_BINDING_STATUSES = {"draft", "configured", "disabled"}
QIANCHUAN_COOP_STATUSES = {"bound", "pending", "failed", "disabled"}


class ProductIn(BaseModel):
    name: str
    price_text: str | None = None
    shop_name: str | None = None
    shop_product_id: str | None = None
    link: str | None = None
    default_commission: float | None = None
    merchant_promotion_commission: float | None = None
    selling_points: str | None = None
    shooting_notes: str | None = None
    product_image: str | None = None
    product_images: list[str] | None = None
    sample_remark: str | None = None
    promo_remark: str | None = None
    auto_audit_type: str | None = None
    allow_promotion: bool | None = None


class ProductUpdateIn(BaseModel):
    """编辑产品:所有字段可选,只更新前端"显式提交"的字段。

    关键语义:区分"没传"(不动)与"传了 null"(清空可空字段)。用同一个必填 name 的
    ProductIn 做 PUT 会导致:① 每次都得带 name;② 清空佣金/图片这类操作被"None 即跳过"
    吞掉(用户改了等于白改)。故单独定义全可选的更新模型。
    """
    name: str | None = None
    price_text: str | None = None
    shop_name: str | None = None
    shop_product_id: str | None = None
    link: str | None = None
    default_commission: float | None = None
    merchant_promotion_commission: float | None = None
    selling_points: str | None = None
    shooting_notes: str | None = None
    product_image: str | None = None
    product_images: list[str] | None = None
    sample_remark: str | None = None
    promo_remark: str | None = None
    auto_audit_type: str | None = None
    allow_promotion: bool | None = None


# NOT NULL 且带数据库默认值的列:前端即使误传 null 也不覆盖(避免 IntegrityError / 语义丢失)
_PRODUCT_NON_NULLABLE = {"name", "auto_audit_type", "allow_promotion"}


def _normalize_commission(data: dict, key: str, label: str) -> None:
    # data[key] 为 None 有两种含义:未提交(不在 data 里)或显式清空(在 data 里且为 None)。
    # 两种都不需要范围校验;显式清空时保留 None 让上层 setattr 置空。
    if data.get(key) is None:
        return
    if data[key] < 0 or data[key] > 100:
        raise HTTPException(400, f"{label}需在 0-100 之间")
    data[key] = Decimal(str(data[key]))


@router.post("")
def create(body: ProductIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    data["name"] = data["name"].strip()
    if not data["name"]:
        raise HTTPException(400, "产品名称不能为空")
    _normalize_commission(data, "default_commission", "自然流佣金")
    _normalize_commission(data, "merchant_promotion_commission", "商家投流佣金")
    # 首张图集自动作封面(未单独指定封面时)
    if data.get("product_images") and not data.get("product_image"):
        data["product_image"] = data["product_images"][0]
    p = Product(**data)
    db.add(p)
    db.commit()
    return {"id": p.id}


@router.put("/{product_id}")
def update_product(product_id: int, body: ProductUpdateIn,
                   user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(404, "产品不存在")
    # 只处理前端显式提交的字段:区分"未传"(不动)与"传 null"(清空可空列)
    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        name = (data["name"] or "").strip()
        if not name:
            raise HTTPException(400, "产品名称不能为空")
        data["name"] = name
    # NOT NULL 列若被误传 null,丢弃该键(保持原值),不清空也不触发约束错误
    for key in _PRODUCT_NON_NULLABLE:
        if key in data and data[key] is None:
            data.pop(key)
    _normalize_commission(data, "default_commission", "自然流佣金")
    _normalize_commission(data, "merchant_promotion_commission", "商家投流佣金")
    # 商品图与封面联动:显式提交了图集就同步封面——空集清空封面(否则残留已删除的失效图),
    # 非空取首张为封面(未单独指定封面时)。
    if "product_images" in data:
        images = data["product_images"] or []
        if images:
            data.setdefault("product_image", images[0])
        else:
            data["product_image"] = None
    for k, v in data.items():
        setattr(p, k, v)
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
            or db.scalar(select(OrderRecord.id).where(OrderRecord.product_id == product_id).limit(1))
            or db.scalar(select(ProductApplication.id).where(ProductApplication.product_id == product_id).limit(1))):
        raise HTTPException(400, "该产品已有带货申请/寄样/视频/出单记录,不能删除;请改用「下架」")
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
    configured = _qianchuan_binding_configured(row)
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


def _qianchuan_binding_configured(row: ProductQianchuanBinding | None) -> bool:
    return bool(row and any([
        row.shop_auth_id, row.shop_id, row.shop_name, row.advertiser_id, row.qianchuan_product_id,
    ]))


def _qianchuan_status_from_row(row: ProductQianchuanBinding | None) -> str:
    if not row:
        return "unconfigured"
    if row.bind_status == "disabled":
        return "disabled"
    return "configured" if _qianchuan_binding_configured(row) else "draft"


def _qianchuan_status(db: Session, product_id: int) -> str:
    row = db.scalars(select(ProductQianchuanBinding)
                     .where(ProductQianchuanBinding.product_id == product_id)).first()
    return _qianchuan_status_from_row(row)


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
    product_ids = [p.id for p in rows]
    material_counts = {}
    grant_counts = {}
    binding_by_product = {}
    if product_ids:
        mat_count_stmt = (select(Material.product_id, func.count(Material.id))
                          .where(Material.product_id.in_(product_ids)))
        material_counts = dict(db.execute(mat_count_stmt.group_by(Material.product_id)).all())
        grant_counts = dict(db.execute(
            select(AccessGrant.product_id, func.count(AccessGrant.id))
            .where(AccessGrant.product_id.in_(product_ids))
            .group_by(AccessGrant.product_id)
        ).all())
        binding_by_product = {
            row.product_id: row
            for row in db.scalars(
                select(ProductQianchuanBinding)
                .where(ProductQianchuanBinding.product_id.in_(product_ids))
            ).all()
        }
    items = [{"id": p.id, "name": p.name, "price_text": p.price_text, "shop_name": p.shop_name,
              "product_image": storage.thumbnail_url(p.product_image, 96),
              "default_commission": float(p.default_commission) if p.default_commission is not None else None,
              "merchant_promotion_commission": (float(p.merchant_promotion_commission)
                                                if p.merchant_promotion_commission is not None else None),
              "status": p.status, "material_count": int(material_counts.get(p.id, 0)),
              "granted_count": int(grant_counts.get(p.id, 0)),
              "qianchuan_status": _qianchuan_status_from_row(binding_by_product.get(p.id)),
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


def _normalized_material_data(data: dict, material_type: str) -> dict:
    for key in ("title", "oss_key", "source_link", "parsed_text", "report_id"):
        if isinstance(data.get(key), str):
            data[key] = data[key].strip() or None
    if material_type != "video_hot":
        data["source_link"] = None
    if material_type != "pdf":
        data["report_id"] = None
    return data


def _validate_material_data(data: dict, material_type: str):
    if material_type not in MATERIAL_TYPES:
        raise HTTPException(400, "素材类型不支持")
    has_file = bool(data.get("oss_key"))
    has_link = bool(data.get("source_link"))
    has_text = bool(data.get("parsed_text"))
    if has_file or has_link or has_text:
        return
    raise HTTPException(400, "请先上传文件、填写链接或填写文案")


@router.post("/{product_id}/materials")
def add_material(product_id: int, body: MaterialIn,
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not db.get(Product, product_id):
        raise HTTPException(404, "产品不存在")
    if body.type in ADMIN_ONLY_MATERIAL_TYPES and user.role != "admin":
        raise HTTPException(403, "达人成片仅管理员可维护")
    data = _normalized_material_data(body.model_dump(), body.type)
    _validate_material_data(data, body.type)
    m = Material(product_id=product_id, **data)
    db.add(m)
    db.commit()
    db.refresh(m)
    # TODO: source_link 非空时后台任务:下载视频→转存OSS→解析文案回填 parsed_text
    return _material_dict(m)


class MaterialEditIn(BaseModel):
    title: str | None = None
    oss_key: str | None = None
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
    if m.type in ADMIN_ONLY_MATERIAL_TYPES and user.role != "admin":
        raise HTTPException(403, "达人成片仅管理员可维护")
    data = _normalized_material_data(body.model_dump(exclude_unset=True), m.type)
    for k, v in data.items():
        setattr(m, k, v)
    _validate_material_data({
        "oss_key": m.oss_key,
        "source_link": m.source_link,
        "parsed_text": m.parsed_text,
    }, m.type)
    db.commit()
    return {"ok": True}


@router.delete("/materials/{material_id}")
def delete_material(material_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    m = db.get(Material, material_id)
    if m:
        if m.type in ADMIN_ONLY_MATERIAL_TYPES and user.role != "admin":
            raise HTTPException(403, "达人成片仅管理员可维护")
        db.query(MaterialReadState).filter(MaterialReadState.material_id == material_id).delete()
        db.query(MaterialDownloadLog).filter(MaterialDownloadLog.material_id == material_id).delete()
        db.delete(m)
        db.commit()
    return {"ok": True}


class MaterialPublishIn(BaseModel):
    is_public: bool


@router.post("/materials/{material_id}/publish")
def publish_material(material_id: int, body: MaterialPublishIn,
                     user: User = Depends(current_user), db: Session = Depends(get_db)):
    """公开/取消公开达人成片:仅管理员;公开后才在达人端(H5)作为参考展示。"""
    if user.role != "admin":
        raise HTTPException(403, "仅管理员可公开达人成片")
    m = db.get(Material, material_id)
    if not m:
        raise HTTPException(404, "素材不存在")
    if m.type not in ADMIN_ONLY_MATERIAL_TYPES:
        raise HTTPException(400, "该素材类型无需公开控制")
    m.is_public = body.is_public
    db.commit()
    return {"ok": True, "is_public": m.is_public}


def _material_dict(m: Material) -> dict:
    # 预览/下载都走"自家域名 + 素材 id + 签名"网关,不再向前端暴露裸 OSS URL。
    # 内部端保留 oss_key 供编辑时判断"是否已有文件/是否替换"(内部可信;达人端不下发)。
    has_file = bool(m.oss_key)
    return {"id": m.id, "type": m.type, "title": m.title, "oss_key": m.oss_key,
            "url": storage.material_file_url(m.id) if has_file else None,
            "preview_url": storage.material_file_url(m.id) if has_file else None,
            "download_url": storage.material_file_url(m.id, download=True) if has_file else None,
            "is_image": storage.is_image(m.oss_key) if has_file else False,
            "inline_preview": True,
            "source_link": m.source_link, "parsed_text": m.parsed_text,
            "report_id": m.report_id, "downloadable": m.downloadable,
            "starred": m.starred, "is_public": m.is_public,
            "comments": [_material_comment_dict(c) for c in getattr(m, "comments", []) if not c.is_deleted]
            if m.type == "video_output" else [],
            "comment_count": len([c for c in getattr(m, "comments", []) if not c.is_deleted])
            if m.type == "video_output" else 0,
            "created_at": m.created_at.isoformat()}


def _safe_uploaded_key(key: str | None) -> str | None:
    if not key:
        return None
    key = key.strip()
    parts = key.split("/")
    if not key or key.startswith("/") or ".." in parts or not storage.extension_allowed(key):
        raise HTTPException(400, "附件文件不合法")
    return key


def _file_type_from_key(key: str) -> str:
    ct = storage.content_type(key)
    if ct.startswith("image/"):
        return "image"
    if ct.startswith("video/"):
        return "video"
    if ct == "application/pdf":
        return "pdf"
    return "file"


def _comment_attachment_dict(a: MaterialCommentAttachment) -> dict:
    url = storage.material_comment_attachment_url(a.id)
    return {
        "id": a.id,
        "filename": a.filename,
        "file_type": a.file_type,
        "content_type": a.content_type,
        "url": url,
        "preview_url": url,
        "download_url": storage.material_comment_attachment_url(a.id, download=True),
        "inline_preview": True,
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


class MaterialCommentAttachmentIn(BaseModel):
    oss_key: str
    filename: str | None = None
    file_type: str | None = None
    content_type: str | None = None


class MaterialCommentIn(BaseModel):
    body: str | None = None
    attachments: list[MaterialCommentAttachmentIn] = Field(default_factory=list)


def _video_output_material(db: Session, material_id: int) -> Material:
    m = db.get(Material, material_id)
    if not m:
        raise HTTPException(404, "素材不存在")
    if m.type != "video_output":
        raise HTTPException(400, "仅达人成片支持评论")
    return m


@router.get("/materials/{material_id}/comments")
def list_material_comments(material_id: int, user: User = Depends(current_user),
                           db: Session = Depends(get_db)):
    _video_output_material(db, material_id)
    comments = db.scalars(
        select(MaterialComment)
        .where(MaterialComment.material_id == material_id,
               MaterialComment.is_deleted.is_(False))
        .order_by(MaterialComment.created_at.asc(), MaterialComment.id.asc())
    ).all()
    return [_material_comment_dict(c) for c in comments]


@router.post("/materials/{material_id}/comments")
def create_material_comment(material_id: int, body: MaterialCommentIn,
                            user: User = Depends(current_user),
                            db: Session = Depends(get_db)):
    m = _video_output_material(db, material_id)
    text = (body.body or "").strip()
    attachments = body.attachments or []
    if len(text) > 2000:
        raise HTTPException(400, "评论不能超过2000字")
    if len(attachments) > 9:
        raise HTTPException(400, "单条评论最多上传9个附件")
    if not text and not attachments:
        raise HTTPException(400, "请填写评论或上传附件")

    comment = MaterialComment(
        material_id=m.id,
        product_id=m.product_id,
        body=text or None,
        author_user_id=user.id,
        author_name=user.display_name,
        author_role=user.role or "bd",
    )
    db.add(comment)
    for i, item in enumerate(attachments):
        key = _safe_uploaded_key(item.oss_key)
        filename = (item.filename or "").strip()[:255] or key.rsplit("/", 1)[-1]
        file_type = item.file_type if item.file_type in {"image", "video", "pdf", "file"} else _file_type_from_key(key)
        content_type = (item.content_type or storage.content_type(key)).strip()[:128]
        comment.attachments.append(MaterialCommentAttachment(
            oss_key=key,
            filename=filename,
            file_type=file_type,
            content_type=content_type,
            sort_order=i,
        ))
    db.commit()
    db.refresh(comment)
    return _material_comment_dict(comment)


@router.delete("/materials/{material_id}/comments/{comment_id}")
def delete_material_comment(material_id: int, comment_id: int,
                            user: User = Depends(current_user),
                            db: Session = Depends(get_db)):
    _video_output_material(db, material_id)
    c = db.get(MaterialComment, comment_id)
    if not c or c.material_id != material_id or c.is_deleted:
        raise HTTPException(404, "评论不存在")
    if user.role != "admin" and c.author_user_id != user.id:
        raise HTTPException(403, "只能删除自己的评论")
    c.is_deleted = True
    db.commit()
    return {"ok": True}


MATERIAL_POST_CATEGORIES = {"video", "image", "doc", "copy"}
MATERIAL_ASSET_TYPES = {"image", "video", "pdf", "file", "link"}


def _asset_dict(a: MaterialAsset) -> dict:
    is_img = a.type == "image"
    return {"id": a.id, "type": a.type, "oss_key": a.oss_key,
            "filename": a.filename, "source_link": a.source_link, "sort_order": a.sort_order,
            "url": storage.public_or_signed_url(a.oss_key) if a.oss_key else a.source_link,
            "preview_url": storage.preview_url(a.oss_key) if a.oss_key else a.source_link,
            "inline_preview": storage.inline_preview_enabled(),
            "thumb": storage.thumbnail_url(a.oss_key, 200) if (is_img and a.oss_key) else None}


def _material_post_dict(post: MaterialPost) -> dict:
    return {"id": post.id, "product_id": post.product_id, "category": post.category,
            "title": post.title, "caption": post.caption, "downloadable": post.downloadable,
            "status": post.status, "author_name": post.author_name,
            "created_at": post.created_at.isoformat(),
            "assets": [_asset_dict(a) for a in post.assets]}


class MaterialAssetIn(BaseModel):
    type: str
    oss_key: str | None = None
    source_link: str | None = None
    filename: str | None = None


class MaterialPostIn(BaseModel):
    category: str = "image"
    title: str | None = None
    caption: str
    downloadable: bool = True
    status: str = "published"
    assets: list[MaterialAssetIn] = []


def _apply_assets(post: MaterialPost, assets: list[MaterialAssetIn]) -> None:
    post.assets.clear()
    for i, a in enumerate(assets):
        atype = a.type if a.type in MATERIAL_ASSET_TYPES else "file"
        post.assets.append(MaterialAsset(
            type=atype, oss_key=(a.oss_key or None), source_link=(a.source_link or None),
            filename=(a.filename or None), sort_order=i))


@router.get("/{product_id}/material-posts")
def list_material_posts(product_id: int, user: User = Depends(current_user),
                        db: Session = Depends(get_db)):
    """管理端:某产品的内容帖(含草稿)。"""
    posts = db.scalars(select(MaterialPost).where(MaterialPost.product_id == product_id)
                       .order_by(MaterialPost.created_at.desc(), MaterialPost.id.desc())).all()
    return [_material_post_dict(p) for p in posts]


@router.post("/{product_id}/material-posts")
def create_material_post(product_id: int, body: MaterialPostIn,
                         user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not db.get(Product, product_id):
        raise HTTPException(404, "产品不存在")
    caption = (body.caption or "").strip()
    if not caption:
        raise HTTPException(400, "说明文案必填")
    from ..models import now as _now
    category = body.category if body.category in MATERIAL_POST_CATEGORIES else "image"
    status = "draft" if body.status == "draft" else "published"
    post = MaterialPost(product_id=product_id, category=category, title=(body.title or None),
                        caption=caption, downloadable=body.downloadable, status=status,
                        author_id=user.id, author_name=user.display_name,
                        published_at=_now() if status == "published" else None)
    _apply_assets(post, body.assets)
    db.add(post)
    db.commit()
    return {"id": post.id}


class MaterialPostEditIn(BaseModel):
    category: str | None = None
    title: str | None = None
    caption: str | None = None
    downloadable: bool | None = None
    status: str | None = None
    assets: list[MaterialAssetIn] | None = None


@router.patch("/material-posts/{post_id}")
def edit_material_post(post_id: int, body: MaterialPostEditIn,
                       user: User = Depends(current_user), db: Session = Depends(get_db)):
    post = db.get(MaterialPost, post_id)
    if not post:
        raise HTTPException(404, "内容帖不存在")
    if body.category is not None and body.category in MATERIAL_POST_CATEGORIES:
        post.category = body.category
    if body.title is not None:
        post.title = body.title or None
    if body.caption is not None:
        caption = body.caption.strip()
        if not caption:
            raise HTTPException(400, "说明文案不能清空")
        post.caption = caption
    if body.downloadable is not None:
        post.downloadable = body.downloadable
    if body.status is not None:
        from ..models import now as _now
        new_status = "draft" if body.status == "draft" else "published"
        if new_status == "published" and post.status != "published":
            post.published_at = _now()
        post.status = new_status
    if body.assets is not None:
        _apply_assets(post, body.assets)
    db.commit()
    return {"ok": True}


@router.delete("/material-posts/{post_id}")
def delete_material_post(post_id: int, user: User = Depends(current_user),
                         db: Session = Depends(get_db)):
    post = db.get(MaterialPost, post_id)
    if post:
        db.delete(post)
        db.commit()
    return {"ok": True}


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
    # 店铺授权:区分"未提交"与"显式清空(解绑)"。前端清空需显式传 shop_auth_id: null,
    # 否则(undefined 被 JSON 丢键)无法解绑,旧授权会一直残留。
    if "shop_auth_id" in body.model_fields_set:
        if body.shop_auth_id is None:
            row.shop_auth_id = None      # 解绑店铺授权
        else:
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


def _product_application_overview(db: Session, product_id: int) -> dict:
    rows = db.execute(
        select(ProductApplication, Influencer, User)
        .join(Influencer, ProductApplication.influencer_id == Influencer.id)
        .outerjoin(User, Influencer.owner_bd_id == User.id)
        .where(ProductApplication.product_id == product_id)
        .order_by(ProductApplication.updated_at.desc(), ProductApplication.id.desc())
    ).all()
    counts = {"total": 0, "pending": 0, "approved": 0, "rejected": 0, "cancelled": 0,
              "shipped": 0, "in_transit": 0, "signed": 0}
    items = []
    for app, inf, owner in rows:
        sample = app_service.latest_sample(db, inf.id, product_id)
        status = app_service.display_status(app, sample)
        counts["total"] += 1
        counts[status] = counts.get(status, 0) + 1
        if len(items) >= 20:
            continue
        coop_ids = db.scalars(
            select(Cooperation.id).where(Cooperation.influencer_id == inf.id)
        ).all()
        video_count = 0
        if coop_ids:
            video_count = db.scalar(
                select(func.count(VideoTask.id))
                .where(VideoTask.product_id == product_id,
                       VideoTask.cooperation_id.in_(coop_ids))
            ) or 0
        gmv = db.scalar(
            select(func.coalesce(func.sum(OrderRecord.amount), 0))
            .where(OrderRecord.influencer_id == inf.id,
                   OrderRecord.product_id == product_id)
        ) or 0
        items.append({
            "id": app.id,
            "influencer_id": inf.id,
            "nickname": inf.nickname,
            "douyin_id": inf.douyin_id,
            "owner_bd_name": owner.display_name if owner else None,
            "status": status,
            "application_status": app.status,
            "sample_status": sample.status if sample else None,
            "tracking_no": sample.tracking_no if sample else None,
            "video_count": int(video_count),
            "gmv": float(gmv),
            "updated_at": app.updated_at.isoformat(),
        })
    total_gmv = db.scalar(
        select(func.coalesce(func.sum(OrderRecord.amount), 0))
        .where(OrderRecord.product_id == product_id)
    ) or 0
    total_videos = db.scalar(
        select(func.count(VideoTask.id)).where(VideoTask.product_id == product_id)
    ) or 0
    return {"counts": counts, "items": items, "gmv": float(total_gmv), "video_count": int(total_videos)}


@router.get("/{product_id}")
def detail(product_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(404, "产品不存在")
    mat_stmt = (select(Material)
                .where(Material.product_id == product_id)
                .order_by(Material.created_at.desc(), Material.id.desc()))
    materials = db.scalars(mat_stmt).all()
    binding = db.scalars(select(ProductQianchuanBinding)
                         .where(ProductQianchuanBinding.product_id == product_id)).first()
    return {"id": p.id, "name": p.name, "price_text": p.price_text, "shop_name": p.shop_name,
            "shop_product_id": p.shop_product_id, "link": p.link, "status": p.status,
            "product_image": storage.thumbnail_url(p.product_image, 160),
            "product_image_original": storage.signed_url(p.product_image) if p.product_image else None,
            "product_images": [storage.thumbnail_url(k, 160) for k in (p.product_images or [])],
            "product_images_keys": list(p.product_images or []),
            "default_commission": float(p.default_commission) if p.default_commission is not None else None,
            "merchant_promotion_commission": (float(p.merchant_promotion_commission)
                                              if p.merchant_promotion_commission is not None else None),
            "selling_points": p.selling_points, "shooting_notes": p.shooting_notes,
            "sample_remark": p.sample_remark, "promo_remark": p.promo_remark,
            "auto_audit_type": p.auto_audit_type, "allow_promotion": p.allow_promotion,
            "qianchuan_binding": _qianchuan_binding_dict(binding),
            "application_overview": _product_application_overview(db, product_id),
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
