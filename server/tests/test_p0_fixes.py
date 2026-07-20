"""P0 修复回归测试:落库置空语义、封面联动、脱敏、手机号归一化绑定、上传白名单。"""
import os
import sys
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.api.h5 import VerifyIn, sms_verify  # noqa: E402
from app.api.influencers import CreateIn  # noqa: E402
from app.api.influencers import create as create_influencer  # noqa: E402
from app.api.influencers import detail as influencer_detail  # noqa: E402
from app.api.products import (ProductIn, ProductUpdateIn, QianchuanBindingIn,  # noqa: E402
                              create as create_product, save_qianchuan_binding, update_product)
from app.api.uploads import DirectUploadIn, direct_upload_ticket  # noqa: E402
from app.api.videos import TransitionIn, list_promotions, transition  # noqa: E402
from app.db import Base  # noqa: E402
from app.deps import _load_token  # noqa: E402
from app.models import (Cooperation, Influencer, Product,  # noqa: E402
                        ProductQianchuanBinding, Promotion, QianchuanShopAuth,
                        SmsCode, User, VideoTask)
from app.services import storage  # noqa: E402
from app.services.identity import normalize_phone  # noqa: E402


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture
def admin(db):
    user = User(username="admin", display_name="管理员", role="admin")
    db.add(user)
    db.commit()
    return user


# ---------- 项1/项2:update_product 置空语义 + 封面联动 ----------

def test_clearing_commission_persists_null(db, admin):
    pid = create_product(ProductIn(name="牙膏", default_commission=8), admin, db)["id"]
    # 显式传 null 清空(前端 el-input-number 清空即 null)
    update_product(pid, ProductUpdateIn(default_commission=None), admin, db)
    p = db.get(Product, pid)
    assert p.default_commission is None


def test_clearing_product_images_clears_cover(db, admin):
    pid = create_product(ProductIn(name="牙膏", product_images=["product/a.jpg", "product/b.jpg"]), admin, db)["id"]
    assert db.get(Product, pid).product_image == "product/a.jpg"
    # 删光图片:封面必须一起清空,不能残留已删除的失效图
    update_product(pid, ProductUpdateIn(product_images=[]), admin, db)
    p = db.get(Product, pid)
    assert (p.product_images or []) == []
    assert p.product_image is None


def test_replacing_images_updates_cover_to_first(db, admin):
    pid = create_product(ProductIn(name="牙膏", product_images=["product/old.jpg"]), admin, db)["id"]
    update_product(pid, ProductUpdateIn(product_images=["product/new1.jpg", "product/new2.jpg"]), admin, db)
    p = db.get(Product, pid)
    assert p.product_images == ["product/new1.jpg", "product/new2.jpg"]
    assert p.product_image == "product/new1.jpg"


def test_partial_update_does_not_require_name_and_keeps_untouched_fields(db, admin):
    pid = create_product(ProductIn(name="牙膏", shop_name="旧店铺", default_commission=5), admin, db)["id"]
    # 不带 name 的部分更新应成功,且未提交字段保持不变
    update_product(pid, ProductUpdateIn(shop_name="新店铺"), admin, db)
    p = db.get(Product, pid)
    assert p.name == "牙膏"
    assert p.shop_name == "新店铺"
    assert float(p.default_commission) == 5


def test_update_rejects_blank_name(db, admin):
    pid = create_product(ProductIn(name="牙膏"), admin, db)["id"]
    with pytest.raises(HTTPException) as exc:
        update_product(pid, ProductUpdateIn(name="   "), admin, db)
    assert exc.value.status_code == 400


def test_non_nullable_fields_not_cleared_by_null(db, admin):
    pid = create_product(ProductIn(name="牙膏", auto_audit_type="must", allow_promotion=True), admin, db)["id"]
    # 误传 null 不应清空 NOT NULL 列(否则 IntegrityError / 语义丢失)
    update_product(pid, ProductUpdateIn(auto_audit_type=None, allow_promotion=None), admin, db)
    p = db.get(Product, pid)
    assert p.auto_audit_type == "must"
    assert p.allow_promotion is True


# ---------- 项6:非归属商务读达人详情,raw_intro 脱敏 ----------

def test_raw_intro_masked_for_non_owner(db, admin):
    bd_a = User(phone="13900000001", display_name="商务A", role="bd")
    bd_b = User(phone="13900000002", display_name="商务B", role="bd")
    db.add_all([bd_a, bd_b])
    db.commit()
    inf = create_influencer(CreateIn(nickname="达人X", douyin_id="daren_x",
                                     raw_intro="微信13800001111 收货张三 北京朝阳"), bd_a, db)
    iid = inf["id"]
    owned = influencer_detail(iid, bd_a, db)
    masked = influencer_detail(iid, bd_b, db)
    assert owned["raw_intro"] and owned["can_edit"] is True
    assert masked["raw_intro"] is None and masked["masked"] is True


# ---------- 项8:手机号归一化 + 建档↔登录绑定 ----------

@pytest.mark.parametrize("raw,expected", [
    ("13800138000", "13800138000"),
    ("138 0013 8000", "13800138000"),
    ("138-0013-8000", "13800138000"),
    ("+8613800138000", "13800138000"),
    ("8613800138000", "13800138000"),
    ("１３８００１３８０００", "13800138000"),   # 全角
    ("12345", None),
    ("abcdefghijk", None),
    ("", None),
    (None, None),
])
def test_normalize_phone(raw, expected):
    assert normalize_phone(raw) == expected


def test_create_stores_normalized_phone(db, admin):
    inf = create_influencer(CreateIn(nickname="达人", douyin_id="d1", phone="138 0013 8002"), admin, db)
    assert db.get(Influencer, inf["id"]).phone == "13800138002"


def test_create_rejects_invalid_phone(db, admin):
    with pytest.raises(HTTPException) as exc:
        create_influencer(CreateIn(nickname="达人", douyin_id="d2", phone="12345"), admin, db)
    assert exc.value.status_code == 400


def _insert_valid_code(db, phone, code="123456"):
    db.add(SmsCode(phone=phone, code=code, expires_at=datetime.utcnow() + timedelta(minutes=5)))
    db.commit()


def test_sms_login_binds_to_prebuilt_account_despite_format(db, admin):
    """核心场景:商务用带空格手机号建档,达人用标准 11 位登录 → 进同一档案,不新建空号。"""
    inf = create_influencer(CreateIn(nickname="王五", douyin_id="wangwu",
                                     phone="138 0013 8002", default_address="北京"), admin, db)
    prebuilt_id = inf["id"]
    _insert_valid_code(db, "13800138002")
    res = sms_verify(VerifyIn(phone="13800138002", code="123456"), db)
    # token 指向预建档案,且不是新账号;库里仍只有 1 条(没有产生重复空号)
    assert res["is_new"] is False
    assert db.scalar(select(func.count()).select_from(Influencer)) == 1
    assert _load_token(res["token"], "influencer") == prebuilt_id


def test_sms_login_new_user_creates_account(db):
    _insert_valid_code(db, "13800139999")
    res = sms_verify(VerifyIn(phone="13800139999", code="123456"), db)
    assert res["is_new"] is True


def test_archived_influencer_cannot_reopen_via_sms(db, admin):
    inf = create_influencer(CreateIn(nickname="停用达人", douyin_id="stopped", phone="13800130000"), admin, db)
    row = db.get(Influencer, inf["id"])
    row.archived = True
    db.commit()
    _insert_valid_code(db, "13800130000")
    with pytest.raises(HTTPException) as exc:
        sms_verify(VerifyIn(phone="13800130000", code="123456"), db)
    assert exc.value.status_code == 403


# ---------- 项10:上传类型白名单 + 内联安全 ----------

def test_direct_ticket_rejects_dangerous_extension(db, admin, monkeypatch):
    monkeypatch.setattr(storage, "use_oss", lambda: True)
    with pytest.raises(HTTPException) as exc:
        direct_upload_ticket(DirectUploadIn(filename="evil.html", content_type="text/html"), admin)
    assert exc.value.status_code == 400


def test_direct_ticket_ignores_client_content_type(db, admin, monkeypatch):
    monkeypatch.setattr(storage, "use_oss", lambda: True)
    monkeypatch.setattr(storage.settings, "oss_endpoint", "oss-cn-shanghai.aliyuncs.com")
    monkeypatch.setattr(storage.settings, "oss_bucket", "viceo-public")
    ticket = direct_upload_ticket(DirectUploadIn(filename="pic.png", content_type="text/html"), admin)
    # 采信扩展名而非前端伪造的 text/html
    assert ticket["content_type"] == "image/png"


def test_extension_and_inline_safety_helpers():
    assert storage.extension_allowed("a.png") and storage.extension_allowed("v.MP4")
    assert not storage.extension_allowed("x.html") and not storage.extension_allowed("x.svg")
    assert storage.is_inline_safe("a.png") and storage.is_inline_safe("r.pdf")
    assert not storage.is_inline_safe("x.html")


# ---------- 项3:投流失败凭证多张不丢 ----------

def _make_promotion(db, admin, status="authorized"):
    inf = create_influencer(CreateIn(nickname="投流达人", douyin_id="promo_d",
                                     phone="13800120000"), admin, db)
    iid = inf["id"]
    coop = Cooperation(influencer_id=iid, round_no=1, level_snapshot="L1",
                       commission_tier_snapshot=5, promo_mode_snapshot="merchant")
    pid = create_product(ProductIn(name="投流产品"), admin, db)["id"]
    db.add(coop)
    db.commit()
    vt = VideoTask(cooperation_id=coop.id, product_id=pid, status="approved")
    db.add(vt)
    db.commit()
    promo = Promotion(video_task_id=vt.id, mode_snapshot="merchant", auth_status=status)
    db.add(promo)
    db.commit()
    return promo


def test_fail_proof_keeps_all_screenshots(db, admin):
    promo = _make_promotion(db, admin)
    transition(promo.id, TransitionIn(action="mark_failed", fail_reason="被拒",
               fail_proof_oss_keys=["promo_fail/a.png", "promo_fail/b.png", "promo_fail/c.png"]),
               admin, db)
    db.refresh(promo)
    assert promo.auth_status == "failed"
    assert promo.fail_proof_oss_keys == ["promo_fail/a.png", "promo_fail/b.png", "promo_fail/c.png"]
    assert promo.fail_proof_oss_key == "promo_fail/a.png"   # 旧列兼容:首张
    # 列表接口把凭证暴露出来(此前只写不读)
    listed = list_promotions(user=admin, db=db)
    assert len(listed["items"][0]["fail_proof_urls"]) == 3


def test_fail_proof_rejects_too_many(db, admin):
    promo = _make_promotion(db, admin)
    with pytest.raises(HTTPException) as exc:
        transition(promo.id, TransitionIn(action="mark_failed",
                   fail_proof_oss_keys=[f"promo_fail/{i}.png" for i in range(7)]), admin, db)
    assert exc.value.status_code == 400


# ---------- 项4:千川店铺授权可解绑 ----------

def test_qianchuan_shop_auth_can_be_unbound(db, admin):
    pid = create_product(ProductIn(name="千川产品"), admin, db)["id"]
    auth = QianchuanShopAuth(advertiser_id="adv1", shop_id="shop1", shop_name="旗舰店",
                             auth_status="active")
    db.add(auth)
    db.commit()
    # 绑定
    save_qianchuan_binding(pid, QianchuanBindingIn(shop_auth_id=auth.id, bind_status="configured"),
                           admin, db)
    row = db.scalars(select(ProductQianchuanBinding)
                     .where(ProductQianchuanBinding.product_id == pid)).first()
    assert row.shop_auth_id == auth.id
    # 显式传 null 解绑
    save_qianchuan_binding(pid, QianchuanBindingIn(shop_auth_id=None), admin, db)
    db.refresh(row)
    assert row.shop_auth_id is None
