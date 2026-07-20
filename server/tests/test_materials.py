"""素材优化回归:达人成片仅管理员可维护/可见 + 公开闸门;质检报告兼收图片(类型仍为 pdf)。"""
import asyncio
import os
import sys

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.api.h5 import my_materials  # noqa: E402
from app.api.products import (MaterialEditIn, MaterialIn, MaterialPublishIn, ProductIn,  # noqa: E402
                              add_material, create as create_product, detail as product_detail,
                              edit_material, list_products, publish_material)
from app.db import Base  # noqa: E402
from app.models import AccessGrant, Cooperation, Influencer, User  # noqa: E402


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
    u = User(username="admin", display_name="管理员", role="admin")
    db.add(u)
    db.commit()
    return u


@pytest.fixture
def bd(db):
    u = User(phone="13900000001", display_name="商务", role="bd")
    db.add(u)
    db.commit()
    return u


def _product(db, admin):
    return create_product(ProductIn(name="产品"), admin, db)["id"]


# ---------- 达人成片:仅管理员可维护 ----------

def test_video_output_create_requires_admin(db, admin, bd):
    pid = _product(db, admin)
    with pytest.raises(HTTPException) as e:
        add_material(pid, MaterialIn(type="video_output", oss_key="video_output/a.mp4"), bd, db)
    assert e.value.status_code == 403


def test_video_output_created_private_by_default(db, admin):
    pid = _product(db, admin)
    m = add_material(pid, MaterialIn(type="video_output", oss_key="video_output/a.mp4"), admin, db)
    assert m["is_public"] is False


def test_publish_requires_admin_and_toggles(db, admin, bd):
    pid = _product(db, admin)
    m = add_material(pid, MaterialIn(type="video_output", oss_key="video_output/a.mp4"), admin, db)
    with pytest.raises(HTTPException) as e:
        publish_material(m["id"], MaterialPublishIn(is_public=True), bd, db)
    assert e.value.status_code == 403
    r = publish_material(m["id"], MaterialPublishIn(is_public=True), admin, db)
    assert r["is_public"] is True


def test_publish_rejects_non_output_type(db, admin):
    pid = _product(db, admin)
    m = add_material(pid, MaterialIn(type="pdf", oss_key="pdf/r.pdf"), admin, db)
    with pytest.raises(HTTPException) as e:
        publish_material(m["id"], MaterialPublishIn(is_public=True), admin, db)
    assert e.value.status_code == 400


def test_edit_video_output_requires_admin(db, admin, bd):
    """越权防护:商务即使拿到成片 id 也不能编辑。"""
    pid = _product(db, admin)
    m = add_material(pid, MaterialIn(type="video_output", oss_key="video_output/a.mp4"), admin, db)
    with pytest.raises(HTTPException) as e:
        edit_material(m["id"], MaterialEditIn(title="改标题"), bd, db)
    assert e.value.status_code == 403


def test_material_count_role_consistent(db, admin, bd):
    """列表计数与详情可见性一致:商务看到的计数不含达人成片。"""
    pid = _product(db, admin)
    add_material(pid, MaterialIn(type="video_output", oss_key="video_output/a.mp4"), admin, db)
    add_material(pid, MaterialIn(type="video_ai", oss_key="video_ai/b.mp4"), admin, db)
    admin_row = next(x for x in list_products(user=admin, db=db) if x["id"] == pid)
    bd_row = next(x for x in list_products(user=bd, db=db) if x["id"] == pid)
    assert admin_row["material_count"] == 2
    assert bd_row["material_count"] == 1   # 不含达人成片


# ---------- 内部详情:商务看不到达人成片,管理员看得到 ----------

def test_detail_hides_video_output_from_bd(db, admin, bd):
    pid = _product(db, admin)
    add_material(pid, MaterialIn(type="video_output", oss_key="video_output/a.mp4"), admin, db)
    add_material(pid, MaterialIn(type="video_ai", oss_key="video_ai/b.mp4"), admin, db)
    admin_types = {m["type"] for m in product_detail(pid, admin, db)["materials"]}
    bd_types = {m["type"] for m in product_detail(pid, bd, db)["materials"]}
    assert "video_output" in admin_types
    assert "video_output" not in bd_types and "video_ai" in bd_types


# ---------- 达人端:未公开成片不展示/不可下载,公开后展示 ----------

def _grant_influencer(db, pid, granted_by):
    inf = Influencer(nickname="达人", douyin_id="d", phone="15000000000", source="h5")
    db.add(inf)
    db.commit()
    db.add(Cooperation(influencer_id=inf.id, round_no=1, level_snapshot="L1",
                       commission_tier_snapshot=5, promo_mode_snapshot="merchant"))
    db.add(AccessGrant(influencer_id=inf.id, product_id=pid, granted_by=granted_by))
    db.commit()
    return inf


def test_h5_hides_unpublished_output_shows_after_publish(db, admin):
    pid = _product(db, admin)
    m = add_material(pid, MaterialIn(type="video_output", oss_key="video_output/a.mp4"), admin, db)
    add_material(pid, MaterialIn(type="video_ai", oss_key="video_ai/b.mp4"), admin, db)
    inf = _grant_influencer(db, pid, admin.id)

    res = asyncio.run(my_materials(pid, inf, db))
    types = {x["type"] for x in res["materials"]}
    assert "video_output" not in types and "video_ai" in types

    publish_material(m["id"], MaterialPublishIn(is_public=True), admin, db)
    res2 = asyncio.run(my_materials(pid, inf, db))
    assert "video_output" in {x["type"] for x in res2["materials"]}
