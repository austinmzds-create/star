"""P1 数据一致性/状态机回归:投流防重、视频删除留证、签收终态、建联审批、寄样并发、
达人字段校验与置空。"""
import os
import sys

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.api.connection_requests import CreateIn as ConnCreateIn, ReviewIn  # noqa: E402
from app.api.connection_requests import create_request, review  # noqa: E402
from app.api.influencers import CreateIn, UpdateIn  # noqa: E402
from app.api.influencers import create as create_influencer, update as update_influencer  # noqa: E402
from app.api.products import ProductIn, create as create_product  # noqa: E402
from app.api.samples import AuditIn, audit  # noqa: E402
from app.api.videos import CreatePromotionIn, TransitionIn, create_promotion, delete_video, transition  # noqa: E402
from app.db import Base  # noqa: E402
from app.models import (Cooperation, Influencer, Promotion, SampleOrder,  # noqa: E402
                        User, VideoTask)
from app.services.tracking import _apply_status  # noqa: E402


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


def _bd(db, phone, name):
    u = User(phone=phone, display_name=name, role="bd")
    db.add(u)
    db.commit()
    return u


def _graph(db, admin, dycount=1):
    """建 influencer→cooperation→product→video_task,返回 (inf_id, vt)。"""
    inf = create_influencer(CreateIn(nickname="达人", douyin_id=f"d{dycount}", phone=None), admin, db)
    iid = inf["id"]
    coop = Cooperation(influencer_id=iid, round_no=1, level_snapshot="L1",
                       commission_tier_snapshot=5, promo_mode_snapshot="merchant")
    pid = create_product(ProductIn(name="产品"), admin, db)["id"]
    db.add(coop)
    db.commit()
    vt = VideoTask(cooperation_id=coop.id, product_id=pid, status="approved")
    db.add(vt)
    db.commit()
    return iid, vt


# ---------- 投流防重复发起 ----------

def test_create_promotion_rejects_duplicate_active(db, admin):
    _, vt = _graph(db, admin)
    create_promotion(CreatePromotionIn(video_task_id=vt.id), admin, db)
    with pytest.raises(HTTPException) as exc:
        create_promotion(CreatePromotionIn(video_task_id=vt.id), admin, db)
    assert exc.value.status_code == 409


def test_create_promotion_allowed_after_terminal(db, admin):
    _, vt = _graph(db, admin)
    r = create_promotion(CreatePromotionIn(video_task_id=vt.id), admin, db)
    # 拒绝(refused)是终态,可再次发起
    promo = db.get(Promotion, r["id"])
    promo.auth_status = "refused"
    db.commit()
    r2 = create_promotion(CreatePromotionIn(video_task_id=vt.id), admin, db)
    assert r2["id"] != r["id"]


# ---------- 视频删除保护投流留证 ----------

def test_delete_video_blocked_when_promoted(db, admin):
    _, vt = _graph(db, admin)
    db.add(Promotion(video_task_id=vt.id, mode_snapshot="merchant", auth_status="promoted"))
    db.commit()
    with pytest.raises(HTTPException) as exc:
        delete_video(vt.id, admin, db)
    assert exc.value.status_code == 400
    assert db.get(VideoTask, vt.id) is not None   # 未被删除


def test_delete_video_ok_when_only_pending(db, admin):
    _, vt = _graph(db, admin)
    db.add(Promotion(video_task_id=vt.id, mode_snapshot="merchant", auth_status="pending_request"))
    db.commit()
    delete_video(vt.id, admin, db)
    assert db.get(VideoTask, vt.id) is None


# ---------- 签收是终态,不被退回在途 ----------

def test_signed_order_not_downgraded():
    order = SampleOrder(cooperation_id=1, product_id=1, status="signed")
    order.signed_at = __import__("datetime").datetime(2026, 1, 1)
    _apply_status(order, {"status": "in_transit"})
    assert order.status == "signed"


def test_in_transit_order_still_updates():
    order = SampleOrder(cooperation_id=1, product_id=1, status="shipped")
    _apply_status(order, {"status": "in_transit"})
    assert order.status == "in_transit"


# ---------- 建联审批:归属以当前真实值为准 + 其余申请自动失效 ----------

def test_review_transfers_and_invalidates_other_pending(db, admin):
    bd_a = _bd(db, "13900000001", "商务A")
    bd_b = _bd(db, "13900000002", "商务B")
    bd_c = _bd(db, "13900000003", "商务C")
    inf = create_influencer(CreateIn(nickname="抢手达人", douyin_id="hot"), bd_a, db)
    iid = inf["id"]
    req_b = create_request(ConnCreateIn(influencer_id=iid), bd_b, db)
    req_c = create_request(ConnCreateIn(influencer_id=iid), bd_c, db)
    # 通过 B 的申请
    review(req_b["id"], ReviewIn(approve=True), admin, db)
    db.expire_all()
    assert db.get(Influencer, iid).owner_bd_id == bd_b.id
    # C 的申请自动失效
    from app.models import ConnectionRequest
    assert db.get(ConnectionRequest, req_c["id"]).status == "rejected"


def test_review_uses_actual_current_owner_not_stale_snapshot(db, admin):
    bd_a = _bd(db, "13900000001", "商务A")
    bd_b = _bd(db, "13900000002", "商务B")
    inf = create_influencer(CreateIn(nickname="达人", douyin_id="d"), bd_a, db)
    iid = inf["id"]
    req = create_request(ConnCreateIn(influencer_id=iid), bd_b, db)
    # 期间归属已被改到 admin(模拟别处转移),申请快照过期
    db.get(Influencer, iid).owner_bd_id = admin.id
    db.commit()
    review(req["id"], ReviewIn(approve=True), admin, db)
    db.expire_all()
    assert db.get(Influencer, iid).owner_bd_id == bd_b.id


# ---------- 寄样并发双审 ----------

def _sample_order(db, admin):
    inf = create_influencer(CreateIn(nickname="达人", douyin_id="sd"), admin, db)
    coop = Cooperation(influencer_id=inf["id"], round_no=1, level_snapshot="L1",
                       commission_tier_snapshot=5, promo_mode_snapshot="merchant")
    pid = create_product(ProductIn(name="产品"), admin, db)["id"]
    db.add(coop)
    db.commit()
    order = SampleOrder(cooperation_id=coop.id, product_id=pid, status="pending")
    db.add(order)
    db.commit()
    return order


def test_double_audit_second_gets_409(db, admin):
    order = _sample_order(db, admin)
    audit(order.id, AuditIn(approve=True), admin, db)
    with pytest.raises(HTTPException) as exc:
        audit(order.id, AuditIn(approve=False, reject_reason="x"), admin, db)
    assert exc.value.status_code == 409


# ---------- 达人更新:非法值校验 + 可空字段置空 ----------

def test_update_rejects_invalid_level(db, admin):
    inf = create_influencer(CreateIn(nickname="达人", douyin_id="d"), admin, db)
    with pytest.raises(HTTPException) as exc:
        update_influencer(inf["id"], UpdateIn(level="L9"), admin, db)
    assert exc.value.status_code == 400


def test_update_rejects_invalid_promo_mode(db, admin):
    inf = create_influencer(CreateIn(nickname="达人", douyin_id="d"), admin, db)
    with pytest.raises(HTTPException) as exc:
        update_influencer(inf["id"], UpdateIn(promo_mode="xxx"), admin, db)
    assert exc.value.status_code == 400


def test_update_rejects_unknown_owner(db, admin):
    inf = create_influencer(CreateIn(nickname="达人", douyin_id="d"), admin, db)
    with pytest.raises(HTTPException) as exc:
        update_influencer(inf["id"], UpdateIn(owner_bd_id=99999), admin, db)
    assert exc.value.status_code == 400


def test_update_can_clear_gmv_and_phone(db, admin):
    inf = create_influencer(CreateIn(nickname="达人", douyin_id="d", phone="13800138000",
                                     gmv_30d=1000), admin, db)
    iid = inf["id"]
    update_influencer(iid, UpdateIn(gmv_30d=None, phone=None), admin, db)
    db.expire_all()
    row = db.get(Influencer, iid)
    assert row.gmv_30d is None
    assert row.phone is None


# ---------- 达人列表:tag 过滤下沉 SQL(total 正确 + 不丢行) ----------

def test_tag_filter_total_and_items_correct(db, admin):
    from app.api.influencers import list_influencers
    create_influencer(CreateIn(nickname="A", douyin_id="a", category_tags=None), admin, db)
    ia = create_influencer(CreateIn(nickname="B", douyin_id="b"), admin, db)
    ic = create_influencer(CreateIn(nickname="C", douyin_id="c"), admin, db)
    # 给 B、C 打标签"美妆"
    from app.api.influencers import update as upd
    upd(ia["id"], UpdateIn(tags=["美妆"]), admin, db)
    upd(ic["id"], UpdateIn(tags=["美妆", "护肤"]), admin, db)
    res = list_influencers(tag="美妆", page=1, page_size=1, user=admin, db=db)
    assert res["total"] == 2                       # total 反映过滤结果,不虚高
    assert len(res["items"]) == 1                  # 分页正确
    # "妆"不应命中"美妆"(带引号锚定整元素)
    res2 = list_influencers(tag="妆", user=admin, db=db)
    assert res2["total"] == 0


# ---------- 硬删除:出单记录拦删 + 元数据清理 ----------

def test_delete_blocked_by_order_record(db, admin):
    from datetime import datetime
    from app.models import OrderRecord
    inf = create_influencer(CreateIn(nickname="有出单", douyin_id="ord"), admin, db)
    pid = create_product(ProductIn(name="产品"), admin, db)["id"]
    db.add(OrderRecord(influencer_id=inf["id"], product_id=pid, amount=100,
                       order_date=datetime(2026, 1, 1), recorded_by=admin.id))
    db.commit()
    from app.api.influencers import delete_influencer
    with pytest.raises(HTTPException) as exc:
        delete_influencer(inf["id"], admin, db)
    assert exc.value.status_code == 400


def test_delete_cleans_metadata(db, admin):
    from app.models import ConnectionRequest, Influencer, OperationLog
    bd = _bd(db, "13900000009", "商务")
    inf = create_influencer(CreateIn(nickname="待删", douyin_id="del"), bd, db)
    iid = inf["id"]
    # 制造元数据:建联申请 + 操作日志
    db.add(ConnectionRequest(influencer_id=iid, requester_bd_id=admin.id,
                             current_owner_bd_id=bd.id, status="pending"))
    db.add(OperationLog(influencer_id=iid, event_type="x", summary="y", actor_id=admin.id))
    db.commit()
    from app.api.influencers import delete_influencer
    delete_influencer(iid, admin, db)
    assert db.get(Influencer, iid) is None
    assert db.scalar(select(func.count()).select_from(ConnectionRequest)
                     .where(ConnectionRequest.influencer_id == iid)) == 0
    assert db.scalar(select(func.count()).select_from(OperationLog)
                     .where(OperationLog.influencer_id == iid)) == 0
