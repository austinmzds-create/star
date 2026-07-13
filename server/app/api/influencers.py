"""达人库:智能录入(粘贴解析)、档案、定级(留痕)、商务归属。"""
from io import BytesIO
from decimal import Decimal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user, owns_or_admin
from ..models import (Cooperation, Influencer, LevelChangeLog, Product,
                      Promotion, SampleOrder, User, VideoTask)
from ..services import levels
from ..services.parser import parse_influencer_text
from ..services.sample_orders import dedupe_sample_rows
from ..services.tracking import refresh_if_needed

router = APIRouter(prefix="/api/influencers", tags=["influencers"])

TRACKED_FIELDS = ("level", "commission_tier", "promo_mode", "owner_bd_id")
IDENTITY_FIELDS = ("douyin_uid", "douyin_id", "phone", "cooperation_code")
VALID_LEVELS = ("L1", "L2", "L3")

IMPORT_COLUMNS = [
    ("昵称", "nickname", True),
    ("抖音号", "douyin_id", True),
    ("UID", "douyin_uid", False),
    ("主页链接", "homepage_url", False),
    ("手机号", "phone", False),
    ("粉丝数", "fans_count", False),
    ("近30天GMV", "gmv_30d", False),
    ("内容品类(逗号分隔)", "category_tags", False),
    ("拍摄类型", "shoot_type", False),
    ("合作码", "cooperation_code", False),
    ("收件人", "real_name", False),
    ("收件地址", "default_address", False),
    ("等级(L1/L2/L3)", "level", False),
    ("标签(逗号分隔)", "tags", False),
    ("数据来源", "data_source", False),
    ("来源备注", "source_note", False),
    ("归属商务ID", "owner_bd_id", False),
    ("归属商务手机号", "owner_bd_phone", False),
]


def scope(db_query, user: User):
    """商务只见自己的达人;管理员全量"""
    if user.role == "admin":
        return db_query
    return db_query.where(Influencer.owner_bd_id == user.id)


class ParseIn(BaseModel):
    text: str


def _identity_conditions(fields: dict, exclude_id: int | None = None):
    conds = []
    for field in IDENTITY_FIELDS:
        value = _clean_identity(fields.get(field))
        if value:
            conds.append(getattr(Influencer, field) == value)
    stmt = select(Influencer)
    if conds:
        stmt = stmt.where(or_(*conds))
        if exclude_id is not None:
            stmt = stmt.where(Influencer.id != exclude_id)
    return stmt if conds else None


def _find_duplicate(db: Session, fields: dict, exclude_id: int | None = None) -> Influencer | None:
    stmt = _identity_conditions(fields, exclude_id)
    if stmt is None:
        return None
    return db.scalars(stmt.order_by(Influencer.archived, Influencer.id)).first()


def _clean_identity(value):
    if isinstance(value, str):
        value = value.strip()
    return value or None


def _normalize_create(body) -> dict:
    data = body.model_dump()
    data["nickname"] = (data.get("nickname") or "").strip()
    data["douyin_id"] = _clean_identity(data.get("douyin_id"))
    data["douyin_uid"] = _clean_identity(data.get("douyin_uid"))
    data["phone"] = _clean_identity(data.get("phone"))
    data["cooperation_code"] = _clean_identity(data.get("cooperation_code"))
    data["data_source"] = _clean_identity(data.get("data_source"))
    data["source_note"] = _clean_identity(data.get("source_note"))
    data["level"] = (data.get("level") or "L1").strip().upper()
    if not data["nickname"]:
        raise HTTPException(400, "达人昵称不能为空")
    if not data["douyin_id"]:
        raise HTTPException(400, "抖音号必填,它是达人唯一识别标识")
    if data["level"] not in VALID_LEVELS:
        raise HTTPException(400, "等级只能填写 L1/L2/L3")
    return data


def _cell_to_str(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
    elif isinstance(value, float) and value.is_integer():
        text = str(int(value))
    else:
        text = str(value).strip()
    return text or None


def _split_list(value) -> list[str] | None:
    text = _cell_to_str(value)
    if not text:
        return None
    import re
    parts = [p.strip() for p in re.split(r"[,，;；、|\n]+", text) if p.strip()]
    return parts or None


def _parse_int(value, field_name: str) -> int | None:
    text = _cell_to_str(value)
    if not text:
        return None
    text = text.replace(",", "").replace("，", "").replace(" ", "")
    multiplier = Decimal("1")
    if text[-1:].lower() == "w" or text.endswith("万"):
        multiplier = Decimal("10000")
        text = text[:-1]
    elif text.endswith("亿"):
        multiplier = Decimal("100000000")
        text = text[:-1]
    text = text.replace("¥", "").replace("￥", "").replace("元", "")
    try:
        value_decimal = Decimal(text) * multiplier
    except Exception as exc:
        raise ValueError(f"{field_name}格式不正确") from exc
    if value_decimal < 0:
        raise ValueError(f"{field_name}不能为负数")
    return int(value_decimal)


def _normal_header(value) -> str:
    text = _cell_to_str(value) or ""
    return (text.replace("（", "(").replace("）", ")")
            .replace("*", "").replace(" ", "").strip())


def _import_header_aliases() -> dict[str, str]:
    aliases = {}
    for label, key, _required in IMPORT_COLUMNS:
        aliases[_normal_header(label)] = key
        aliases[_normal_header(key)] = key
    aliases.update({
        "昵称(必填)": "nickname",
        "达人昵称": "nickname",
        "抖音号(必填唯一)": "douyin_id",
        "抖音号(必填)": "douyin_id",
        "抖音ID": "douyin_id",
        "达人UID": "douyin_uid",
        "主页": "homepage_url",
        "主页URL": "homepage_url",
        "手机号/联系电话": "phone",
        "联系电话": "phone",
        "粉丝": "fans_count",
        "GMV": "gmv_30d",
        "30天GMV": "gmv_30d",
        "品类": "category_tags",
        "内容品类": "category_tags",
        "达人类型": "shoot_type",
        "收货人": "real_name",
        "收货地址": "default_address",
        "等级": "level",
        "标签": "tags",
        "来源": "data_source",
        "官方来源": "data_source",
        "数据来源/官方来源": "data_source",
        "备注": "source_note",
        "官方备注": "source_note",
        "归属商务": "owner_bd_phone",
        "商务手机号": "owner_bd_phone",
    })
    return {_normal_header(k): v for k, v in aliases.items()}


def _owner_for_import(db: Session, user: User, row_data: dict) -> int | None:
    if user.role != "admin":
        return user.id
    owner_id = _parse_int(row_data.get("owner_bd_id"), "归属商务ID")
    owner_phone = _clean_identity(_cell_to_str(row_data.get("owner_bd_phone")))
    if owner_id:
        owner = db.get(User, owner_id)
        if not owner or not owner.is_active:
            raise ValueError("归属商务ID不存在或已停用")
        return owner.id
    if owner_phone:
        owner = db.scalars(select(User).where(User.phone == owner_phone, User.is_active.is_(True))).first()
        if not owner:
            raise ValueError("归属商务手机号不存在或已停用")
        return owner.id
    return user.id


def _payload_from_import_row(db: Session, user: User, row_data: dict) -> tuple[dict, list[str] | None, int | None]:
    nickname = _cell_to_str(row_data.get("nickname"))
    douyin_id = _clean_identity(_cell_to_str(row_data.get("douyin_id")))
    if not nickname:
        raise ValueError("昵称必填")
    if not douyin_id:
        raise ValueError("抖音号必填,它是达人唯一识别标识")
    level = (_cell_to_str(row_data.get("level")) or "L1").upper()
    if level not in VALID_LEVELS:
        raise ValueError("等级只能填写 L1/L2/L3")

    payload = {
        "nickname": nickname,
        "douyin_id": douyin_id,
        "douyin_uid": _clean_identity(_cell_to_str(row_data.get("douyin_uid"))),
        "homepage_url": _cell_to_str(row_data.get("homepage_url")),
        "real_name": _cell_to_str(row_data.get("real_name")),
        "phone": _clean_identity(_cell_to_str(row_data.get("phone"))),
        "fans_count": _parse_int(row_data.get("fans_count"), "粉丝数"),
        "gmv_30d": _parse_int(row_data.get("gmv_30d"), "近30天GMV"),
        "category_tags": _split_list(row_data.get("category_tags")),
        "shoot_type": _cell_to_str(row_data.get("shoot_type")),
        "cooperation_code": _clean_identity(_cell_to_str(row_data.get("cooperation_code"))),
        "default_address": _cell_to_str(row_data.get("default_address")),
        "homepage_raw": None,
        "data_source": _cell_to_str(row_data.get("data_source")),
        "source_note": _cell_to_str(row_data.get("source_note")),
        "level": level,
        "source": "import",
    }
    tags = _split_list(row_data.get("tags"))
    owner_bd_id = _owner_for_import(db, user, row_data)
    return payload, tags, owner_bd_id


def _create_imported_influencer(db: Session, user: User, payload: dict,
                                tags: list[str] | None, owner_bd_id: int | None) -> Influencer:
    existing = _find_duplicate(db, payload)
    if existing:
        if owns_or_admin(user, existing.owner_bd_id):
            raise ValueError(f"达人已存在(ID {existing.id}),请打开已有档案维护")
        owner = db.get(User, existing.owner_bd_id) if existing.owner_bd_id else None
        raise ValueError(f"该达人已由{owner.display_name if owner else '其他商务'}对接,请勿重复导入")
    cfg = levels.effective_config(db, payload["level"])
    inf = Influencer(**payload,
                     commission_tier=cfg.commission_tier if cfg else Decimal("5"),
                     owner_bd_id=owner_bd_id,
                     tags=tags)
    db.add(inf)
    db.flush()
    db.add(Cooperation(
        influencer_id=inf.id,
        round_no=1,
        level_snapshot=inf.level,
        commission_tier_snapshot=inf.commission_tier,
        promo_mode_snapshot=inf.promo_mode,
    ))
    db.commit()
    return inf


@router.post("/parse")
async def parse(body: ParseIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """粘贴自我介绍 → 解析字段 + 撞库查重(老达人提示第N次合作)"""
    result = await parse_influencer_text(body.text)
    f = result["fields"]
    dup = None
    existing = _find_duplicate(db, f)
    if existing:
        if owns_or_admin(user, existing.owner_bd_id):
            dup = {"id": existing.id, "nickname": existing.nickname,
                   "round_count": len(existing.cooperations),
                   "owner_bd_id": existing.owner_bd_id}
        else:
            # 已被其他商务对接:只提示归属,不泄漏其达人档案(数据隔离)
            owner = db.get(User, existing.owner_bd_id) if existing.owner_bd_id else None
            dup = {"owned_by_other_bd": True,
                   "owner_bd_name": owner.display_name if owner else None}
    return {**result, "duplicate": dup}


class CreateIn(BaseModel):
    nickname: str
    douyin_id: str | None = None
    douyin_uid: str | None = None
    homepage_url: str | None = None
    real_name: str | None = None
    phone: str | None = None
    fans_count: int | None = None
    gmv_30d: int | None = None
    category_tags: list[str] | None = None
    shoot_type: str | None = None
    raw_intro: str | None = None
    cooperation_code: str | None = None
    default_address: str | None = None
    homepage_raw: str | None = None
    data_source: str | None = None
    source_note: str | None = None
    level: str = "L1"
    source: str = "bd"


@router.post("")
def create(body: CreateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    data = _normalize_create(body)
    existing = _find_duplicate(db, data)
    if existing:
        if owns_or_admin(user, existing.owner_bd_id):
            raise HTTPException(409, f"达人已存在(ID {existing.id}),请打开已有档案继续合作")
        owner = db.get(User, existing.owner_bd_id) if existing.owner_bd_id else None
        raise HTTPException(409, f"该达人已由{owner.display_name if owner else '其他商务'}对接,请勿重复建档")
    cfg = levels.effective_config(db, body.level)
    inf = Influencer(**data,
                     commission_tier=cfg.commission_tier if cfg else Decimal("5"),
                     owner_bd_id=user.id)
    db.add(inf)
    db.commit()
    levels.new_cooperation(db, inf)  # 录入即开第1轮合作(写入快照)
    return {"id": inf.id}


@router.get("/import-template")
def import_template(user: User = Depends(current_user)):
    """下载达人批量导入 Excel 模板。"""
    from openpyxl import Workbook
    from openpyxl.comments import Comment
    from openpyxl.styles import Font, PatternFill
    from openpyxl.worksheet.datavalidation import DataValidation

    wb = Workbook()
    ws = wb.active
    ws.title = "达人导入"
    headers = [label for label, _key, _required in IMPORT_COLUMNS]
    ws.append(headers)
    ws.append([
        "二宝妈妈", "douyin_123456", "1122334455", "https://www.douyin.com/user/xxx",
        "15000000000", "1.2万", "23000", "母婴,儿童", "口播", "BY123",
        "张三", "上海市浦东新区示例路 1 号", "L1", "高潜,母婴",
        "官方达人库", "2026-07-13 官方后台导出,待商务复核", "", "",
    ])
    required_fill = PatternFill("solid", fgColor="FFF2CC")
    for idx, (_label, _key, required) in enumerate(IMPORT_COLUMNS, start=1):
        cell = ws.cell(row=1, column=idx)
        cell.font = Font(bold=True)
        if required:
            cell.fill = required_fill
            cell.comment = Comment("必填。抖音号是唯一识别标识,重复会导入失败。", "system")
        ws.column_dimensions[cell.column_letter].width = 18
    ws.freeze_panes = "A2"
    dv = DataValidation(type="list", formula1='"L1,L2,L3"', allow_blank=True)
    ws.add_data_validation(dv)
    dv.add("M2:M2000")
    bio = BytesIO()
    wb.save(bio)
    bio.seek(0)
    headers = {"Content-Disposition": "attachment; filename=influencer_import_template.xlsx"}
    return StreamingResponse(
        bio,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


@router.post("/import")
async def import_influencers(file: UploadFile = File(...),
                             user: User = Depends(current_user),
                             db: Session = Depends(get_db)):
    """批量导入达人:逐行校验,成功行落库,失败行回传。"""
    from openpyxl import load_workbook

    filename = file.filename or ""
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "请上传 .xlsx 格式的 Excel 文件")
    content = await file.read()
    if not content:
        raise HTTPException(400, "上传文件为空")
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(400, "Excel 文件不能超过 5MB")
    try:
        wb = load_workbook(BytesIO(content), read_only=True, data_only=True)
    except Exception as exc:
        raise HTTPException(400, "Excel 文件解析失败,请使用系统模板重新导入") from exc
    ws = wb.active
    rows = ws.iter_rows(values_only=True)
    try:
        header_row = next(rows)
    except StopIteration as exc:
        raise HTTPException(400, "Excel 为空") from exc
    aliases = _import_header_aliases()
    col_map = {}
    for idx, header in enumerate(header_row):
        key = aliases.get(_normal_header(header))
        if key:
            col_map[idx] = key
    required = {key for _label, key, is_required in IMPORT_COLUMNS if is_required}
    missing = required - set(col_map.values())
    if missing:
        labels = {key: label for label, key, _required in IMPORT_COLUMNS}
        raise HTTPException(400, "模板缺少必填列:" + ",".join(labels.get(k, k) for k in missing))

    created = []
    failures = []
    seen_douyin = set()
    total = 0
    for row_no, row in enumerate(rows, start=2):
        if row_no > 2001:
            failures.append({"row": row_no, "reason": "单次最多导入 2000 行,剩余行请拆分文件"})
            break
        if not any(_cell_to_str(value) for value in row):
            continue
        total += 1
        row_data = {key: row[idx] if idx < len(row) else None for idx, key in col_map.items()}
        try:
            payload, tags, owner_bd_id = _payload_from_import_row(db, user, row_data)
            douyin_key = payload["douyin_id"].lower()
            if douyin_key in seen_douyin:
                raise ValueError("Excel 内抖音号重复")
            inf = _create_imported_influencer(db, user, payload, tags, owner_bd_id)
            seen_douyin.add(douyin_key)
            created.append({
                "row": row_no,
                "id": inf.id,
                "nickname": inf.nickname,
                "douyin_id": inf.douyin_id,
            })
        except ValueError as exc:
            db.rollback()
            failures.append({
                "row": row_no,
                "nickname": _cell_to_str(row_data.get("nickname")),
                "douyin_id": _cell_to_str(row_data.get("douyin_id")),
                "reason": str(exc),
            })
        except Exception:
            db.rollback()
            failures.append({
                "row": row_no,
                "nickname": _cell_to_str(row_data.get("nickname")),
                "douyin_id": _cell_to_str(row_data.get("douyin_id")),
                "reason": "系统处理失败,请检查该行数据后重试",
            })
    return {
        "total": total,
        "success_count": len(created),
        "failed_count": len(failures),
        "created": created,
        "failures": failures,
    }


@router.get("")
def list_influencers(q: str | None = None, level: str | None = None,
                     commission_tier: float | None = None,
                     owner_bd_id: int | None = None, tag: str | None = None,
                     include_archived: bool = False,
                     page: int = 1, page_size: int = 50,
                     user: User = Depends(current_user), db: Session = Depends(get_db)):
    from sqlalchemy import func
    base = scope(select(Influencer), user)
    if not include_archived:
        base = base.where(Influencer.archived.is_not(True))
    if q:
        like = f"%{q}%"
        base = base.where(or_(Influencer.nickname.like(like), Influencer.douyin_id.like(like),
                              Influencer.douyin_uid.like(like), Influencer.phone.like(like),
                              Influencer.cooperation_code.like(like),
                              Influencer.data_source.like(like)))
    if level:
        base = base.where(Influencer.level == level)
    if commission_tier is not None:
        base = base.where(Influencer.commission_tier == Decimal(str(commission_tier)))
    if owner_bd_id is not None:
        base = base.where(Influencer.owner_bd_id == owner_bd_id)
    total = db.scalar(select(func.count()).select_from(base.subquery()))
    page = max(1, page)
    page_size = min(max(1, page_size), 200)
    rows = db.scalars(base.order_by(Influencer.updated_at.desc())
                      .offset((page - 1) * page_size).limit(page_size)).all()
    # 归属商务名字(一次性查出映射)
    bd_ids = {r.owner_bd_id for r in rows if r.owner_bd_id}
    names = {u.id: u.display_name for u in
             db.scalars(select(User).where(User.id.in_(bd_ids or [0]))).all()}
    items = [{"id": r.id, "nickname": r.nickname, "douyin_id": r.douyin_id,
              "fans_count": r.fans_count, "gmv_30d": r.gmv_30d, "level": r.level,
              "commission_tier": float(r.commission_tier), "promo_mode": r.promo_mode,
              "tags": r.tags, "round_count": len(r.cooperations),
              "owner_bd_id": r.owner_bd_id, "owner_bd_name": names.get(r.owner_bd_id),
              "source": r.source, "data_source": r.data_source,
              "updated_at": r.updated_at.isoformat()}
             for r in rows]
    # tag 过滤(tags 存 JSON,DB 层不易过滤,内存过滤本页)
    if tag:
        items = [i for i in items if i["tags"] and tag in i["tags"]]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


class UpdateIn(BaseModel):
    level: str | None = None
    commission_tier: float | None = None
    promo_mode: str | None = None
    owner_bd_id: int | None = None  # 转移分配:仅管理员
    tags: list[str] | None = None
    gmv_30d: int | None = None
    shoot_type: str | None = None
    reason: str | None = None       # 调级/调档原因(留痕)
    archived: bool | None = None    # 停用/启用
    # 核心档案字段(录错可改)
    nickname: str | None = None
    douyin_id: str | None = None
    douyin_uid: str | None = None
    real_name: str | None = None
    phone: str | None = None
    fans_count: int | None = None
    category_tags: list[str] | None = None
    cooperation_code: str | None = None
    default_address: str | None = None
    homepage_url: str | None = None
    data_source: str | None = None
    source_note: str | None = None
    admin_note: str | None = None       # 管理员私密备注:仅管理员可看可改


CORE_FIELDS = ("nickname", "douyin_id", "douyin_uid", "real_name", "phone",
               "fans_count", "category_tags", "cooperation_code",
               "default_address", "homepage_url", "data_source",
               "source_note", "archived")


@router.patch("/{influencer_id}")
def update(influencer_id: int, body: UpdateIn,
           user: User = Depends(current_user), db: Session = Depends(get_db)):
    inf = db.scalars(scope(select(Influencer).where(Influencer.id == influencer_id), user)).first()
    if not inf:
        raise HTTPException(404, "达人不存在或无权限")
    if body.owner_bd_id is not None and user.role != "admin":
        raise HTTPException(403, "无权转移达人(仅管理员可分配归属)")
    if "admin_note" in body.model_fields_set and user.role != "admin":
        raise HTTPException(403, "管理员备注仅管理员可维护")

    for field in TRACKED_FIELDS:
        new_val = getattr(body, field, None)
        if new_val is None:
            continue
        old_val = getattr(inf, field)
        if str(old_val) != str(new_val):
            db.add(LevelChangeLog(influencer_id=inf.id, field=field,
                                  old_value=str(old_val), new_value=str(new_val),
                                  reason=body.reason, changed_by=user.id))
            setattr(inf, field, new_val if field != "commission_tier" else Decimal(str(new_val)))
        # 调级时联动默认佣金档(可再被单独覆盖)
        if field == "level" and body.commission_tier is None:
            cfg = levels.effective_config(db, str(new_val))
            if cfg:
                inf.commission_tier = cfg.commission_tier
    for field in ("tags", "gmv_30d", "shoot_type"):
        if getattr(body, field) is not None:
            setattr(inf, field, getattr(body, field))
    # 核心档案字段(录错可改);身份字段统一撞库校验,避免重复达人。
    identity_updates = {}
    for field in IDENTITY_FIELDS:
        if getattr(body, field, None) is not None:
            identity_updates[field] = _clean_identity(getattr(body, field))
    if "douyin_id" in identity_updates and not identity_updates["douyin_id"]:
        raise HTTPException(400, "抖音号不能为空")
    if identity_updates:
        clash = _find_duplicate(db, identity_updates, exclude_id=inf.id)
        if clash and clash.archived is not True:
            raise HTTPException(400, f"该达人已存在(ID {clash.id}),不能重复使用相同抖音号/UID/手机号/合作码")
    for field in CORE_FIELDS:
        if getattr(body, field) is not None:
            value = getattr(body, field)
            if field in IDENTITY_FIELDS:
                value = _clean_identity(value)
            setattr(inf, field, value)
    if "admin_note" in body.model_fields_set:
        inf.admin_note = body.admin_note
    db.commit()
    return {"ok": True}


@router.delete("/{influencer_id}")
def delete_influencer(influencer_id: int, user: User = Depends(current_user),
                      db: Session = Depends(get_db)):
    """硬删除:仅在无寄样/视频业务记录时允许(录入即开的空合作轮次会一并清理);
    已有寄样/视频请改用「停用」(archived) 以保留历史。"""
    from ..models import AccessGrant
    inf = db.scalars(scope(select(Influencer).where(Influencer.id == influencer_id), user)).first()
    if not inf:
        raise HTTPException(404, "达人不存在或无权限")
    coop_ids = [c.id for c in inf.cooperations] or [0]
    has_sample = db.scalar(select(SampleOrder.id)
                           .where(SampleOrder.cooperation_id.in_(coop_ids)).limit(1))
    has_video = db.scalar(select(VideoTask.id)
                          .where(VideoTask.cooperation_id.in_(coop_ids)).limit(1))
    if has_sample or has_video:
        raise HTTPException(400, "该达人已有寄样/视频记录,不能删除;请改用「停用」")
    db.query(AccessGrant).filter(AccessGrant.influencer_id == inf.id).delete()
    db.query(LevelChangeLog).filter(LevelChangeLog.influencer_id == inf.id).delete()
    for c in inf.cooperations:
        db.delete(c)
    db.delete(inf)
    db.commit()
    return {"ok": True}


@router.get("/{influencer_id}")
def detail(influencer_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inf = db.scalars(scope(select(Influencer).where(Influencer.id == influencer_id), user)).first()
    if not inf:
        raise HTTPException(404, "达人不存在或无权限")
    logs = db.scalars(select(LevelChangeLog).where(LevelChangeLog.influencer_id == inf.id)
                      .order_by(LevelChangeLog.changed_at.desc()).limit(50)).all()
    data = {
        "id": inf.id, "nickname": inf.nickname, "douyin_id": inf.douyin_id,
        "douyin_uid": inf.douyin_uid, "homepage_url": inf.homepage_url,
        "real_name": inf.real_name, "phone": inf.phone,
        "fans_count": inf.fans_count, "gmv_30d": inf.gmv_30d,
        "category_tags": inf.category_tags, "shoot_type": inf.shoot_type,
        "level": inf.level, "commission_tier": float(inf.commission_tier),
        "promo_mode": inf.promo_mode, "tags": inf.tags, "source": inf.source,
        "data_source": inf.data_source, "source_note": inf.source_note,
        "raw_intro": inf.raw_intro, "owner_bd_id": inf.owner_bd_id,
        "cooperation_code": inf.cooperation_code, "default_address": inf.default_address,
        "homepage_raw": inf.homepage_raw, "archived": inf.archived,
        "cooperations": [{"id": c.id, "round_no": c.round_no, "status": c.status,
                          "level_snapshot": c.level_snapshot,
                          "commission_tier_snapshot": float(c.commission_tier_snapshot),
                          "created_at": c.created_at.isoformat()} for c in inf.cooperations],
        "change_logs": [{"field": l.field, "old": l.old_value, "new": l.new_value,
                         "reason": l.reason, "at": l.changed_at.isoformat()} for l in logs],
    }
    if user.role == "admin":
        data["admin_note"] = inf.admin_note
    return data


@router.get("/{influencer_id}/activity")
async def activity(influencer_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """达人一站式动态:该达人的寄样 / 视频 / 投流(达人视角聚合)"""
    inf = db.scalars(scope(select(Influencer).where(Influencer.id == influencer_id), user)).first()
    if not inf:
        raise HTTPException(404, "达人不存在或无权限")
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
            "id": o.id, "product_name": prod.name, "status": o.status,
            "tracking_no": o.tracking_no, "courier_company": o.courier_company,
            "logistics_status": o.logistics_status,
            "signed_at": o.signed_at.isoformat() if o.signed_at else None,
            "reject_reason": o.reject_reason,
            "created_at": o.created_at.isoformat(),
        })

    videos = []
    for v, prod in db.execute(
        select(VideoTask, Product).join(Product, VideoTask.product_id == Product.id)
        .where(VideoTask.cooperation_id.in_(coop_ids))
        .order_by(VideoTask.created_at.desc())
    ).all():
        videos.append({"id": v.id, "product_name": prod.name, "status": v.status,
                       "blocked": v.blocked, "dy_url": v.dy_url,
                       "created_at": v.created_at.isoformat()})

    video_ids = [v["id"] for v in videos] or [0]
    promotions = []
    for p in db.scalars(select(Promotion).where(Promotion.video_task_id.in_(video_ids))
                        .order_by(Promotion.created_at.desc())).all():
        promotions.append({"id": p.id, "auth_status": p.auth_status,
                           "mode_snapshot": p.mode_snapshot, "fail_reason": p.fail_reason,
                           "created_at": p.created_at.isoformat()})

    return {"samples": samples, "videos": videos, "promotions": promotions}
