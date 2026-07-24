"""素材优化回归:达人成片维护权限、评论、达人端公开闸门;质检报告兼收图片。"""
import asyncio
import os
import sys

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.api.h5 import (ApplyProductIn, MaterialReadIn, SubmitVideoIn,  # noqa: E402
                        apply_product, mark_material_read, my_materials,
                        my_products, my_videos, submit_product_video)
from app.api.product_applications import (ReviewIn, list_applications,  # noqa: E402
                                          pending_count, review_application,
                                          status_counts)
from app.api.products import (MaterialCommentAttachmentIn, MaterialCommentIn,  # noqa: E402
                              MaterialAssetIn, MaterialEditIn, MaterialIn,
                              MaterialPostIn, MaterialPublishIn, ProductIn,
                              add_material,
                              create as create_product,
                              create_material_comment, create_material_post,
                              delete_material_comment, delete_product, detail as product_detail,
                              edit_material, list_material_comments, list_products,
                              publish_material)
from app.api.samples import (CreateIn as SampleCreateIn,  # noqa: E402
                             create as create_sample, delete_sample)
from app.db import Base  # noqa: E402
from app.models import (AccessGrant, Cooperation, Influencer, Material,  # noqa: E402
                        MaterialAsset, MaterialComment,
                        MaterialCommentAttachment, MaterialPost,
                        MaterialReadState, Product, SampleOrder, User,
                        VideoTask)


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
    """列表计数与详情可见性一致:商务可见达人成片,但不能维护。"""
    pid = _product(db, admin)
    add_material(pid, MaterialIn(type="video_output", oss_key="video_output/a.mp4"), admin, db)
    add_material(pid, MaterialIn(type="video_ai", oss_key="video_ai/b.mp4"), admin, db)
    admin_row = next(x for x in list_products(user=admin, db=db) if x["id"] == pid)
    bd_row = next(x for x in list_products(user=bd, db=db) if x["id"] == pid)
    assert admin_row["material_count"] == 2
    assert bd_row["material_count"] == 2


# ---------- 内部详情:商务看得到达人成片,但只能评论 ----------

def test_detail_shows_video_output_to_bd(db, admin, bd):
    pid = _product(db, admin)
    add_material(pid, MaterialIn(type="video_output", oss_key="video_output/a.mp4"), admin, db)
    add_material(pid, MaterialIn(type="video_ai", oss_key="video_ai/b.mp4"), admin, db)
    admin_detail = product_detail(pid, admin, db)
    bd_detail = product_detail(pid, bd, db)
    admin_types = {m["type"] for m in admin_detail["materials"]}
    bd_types = {m["type"] for m in bd_detail["materials"]}
    assert "video_output" in admin_types
    assert "video_output" in bd_types and "video_ai" in bd_types
    output = next(m for m in bd_detail["materials"] if m["type"] == "video_output")
    assert output["inline_preview"] is False


def test_bd_can_comment_on_video_output_with_attachments(db, admin, bd):
    pid = _product(db, admin)
    m = add_material(pid, MaterialIn(type="video_output", oss_key="video_output/a.mp4"), admin, db)

    c = create_material_comment(m["id"], MaterialCommentIn(
        body="开头需要补产品露出",
        attachments=[MaterialCommentAttachmentIn(
            oss_key="comments/proof.png", filename="proof.png",
            file_type="image", content_type="image/png"),
            MaterialCommentAttachmentIn(
                oss_key="comments/review.pdf", filename="review.pdf",
                file_type="pdf", content_type="application/pdf")],
    ), bd, db)

    assert c["body"] == "开头需要补产品露出"
    assert c["attachments"][0]["url"].startswith("/api/material-comment-attachments/")
    assert c["attachments"][0]["inline_preview"] is True
    assert c["attachments"][1]["inline_preview"] is False
    listed = list_material_comments(m["id"], bd, db)
    assert len(listed) == 1 and listed[0]["author_role"] == "bd"


def test_deleted_comment_attachment_gateway_returns_404(db, admin, bd):
    pid = _product(db, admin)
    m = add_material(pid, MaterialIn(type="video_output", oss_key="video_output/a.mp4"), admin, db)
    c = create_material_comment(m["id"], MaterialCommentIn(
        body="附件之后会删除",
        attachments=[MaterialCommentAttachmentIn(oss_key="comments/proof.png", filename="proof.png")],
    ), bd, db)
    attachment_id = c["attachments"][0]["id"]
    from app.api.uploads import serve_material_comment_attachment
    from app.services import storage
    import re
    url = storage.material_comment_attachment_url(attachment_id)
    e = re.search(r"e=(\d+)", url).group(1)
    s = re.search(r"s=([0-9a-f]+)", url).group(1)

    delete_material_comment(m["id"], c["id"], bd, db)

    with pytest.raises(HTTPException) as exc:
        serve_material_comment_attachment(attachment_id, request=None, db=db, e=e, s=s)
    assert exc.value.status_code == 404


def test_comment_rejects_empty_payload(db, admin, bd):
    pid = _product(db, admin)
    m = add_material(pid, MaterialIn(type="video_output", oss_key="video_output/a.mp4"), admin, db)
    with pytest.raises(HTTPException) as e:
        create_material_comment(m["id"], MaterialCommentIn(body="  ", attachments=[]), bd, db)
    assert e.value.status_code == 400


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


def _influencer(db, owner=None, phone="15000000000", douyin_id="d"):
    inf = Influencer(nickname="达人", douyin_id=douyin_id, phone=phone, source="h5",
                     owner_bd_id=getattr(owner, "id", None))
    db.add(inf)
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


def test_h5_lists_all_on_products_without_grant(db, admin):
    pid = _product(db, admin)
    inf = _influencer(db)
    rows = my_products(inf, db)
    assert [p["id"] for p in rows] == [pid]
    assert rows[0]["cooperation_status"] is None


def test_h5_apply_product_creates_pending_application(db, admin):
    pid = _product(db, admin)
    inf = _influencer(db)

    res = apply_product(pid, ApplyProductIn(), inf, db)

    assert res["application"]["status"] == "pending"
    detail = asyncio.run(my_materials(pid, inf, db))
    assert detail["application"]["status"] == "pending"
    listed = list_applications(status="pending", user=admin, db=db)["items"]
    assert len(listed) == 1 and listed[0]["influencer_id"] == inf.id
    product_row = next(x for x in list_products(user=admin, db=db) if x["id"] == pid)
    assert product_row["application_count"] == 1


def test_product_applications_mask_phone_and_scope_counts(db, admin, bd):
    pid = _product(db, admin)
    owner_inf = _influencer(db, owner=bd, phone="15000000001", douyin_id="owner1")
    other_bd = User(phone="13900000002", display_name="其他商务", role="bd")
    db.add(other_bd)
    db.commit()
    apply_product(pid, ApplyProductIn(), owner_inf, db)

    owner_rows = list_applications(status="pending", user=bd, db=db)["items"]
    other_rows = list_applications(status="pending", user=other_bd, db=db)["items"]

    assert owner_rows[0]["phone"] == "15000000001"
    assert owner_rows[0]["can_operate"] is True
    assert other_rows[0]["phone"] is None
    assert other_rows[0]["can_operate"] is False
    assert status_counts(user=other_bd, db=db)["pending"] == 1
    assert status_counts(mine_only=True, user=other_bd, db=db) == {}
    assert pending_count(user=other_bd, db=db)["count"] == 0


def test_review_application_approve_creates_to_ship_sample(db, admin, bd):
    pid = _product(db, admin)
    inf = _influencer(db, owner=bd)
    app = apply_product(pid, ApplyProductIn(note="想带这个品"), inf, db)["application"]

    review_application(app["id"], ReviewIn(approve=True), bd, db)

    detail = asyncio.run(my_materials(pid, inf, db))
    assert detail["application"]["status"] == "approved"
    assert detail["sample"]["status"] == "approved"
    listed = list_applications(status="approved", user=admin, db=db)["items"]
    assert listed[0]["status"] == "approved" and listed[0]["sample_order_id"]


def test_h5_submit_video_requires_approved_application(db, admin):
    pid = _product(db, admin)
    inf = _influencer(db)

    with pytest.raises(HTTPException) as exc:
        submit_product_video(pid, SubmitVideoIn(dy_url="https://v.douyin.com/test"), inf, db)

    assert exc.value.status_code == 400


def test_h5_submit_video_creates_task_private_material_and_feedback(db, admin, bd):
    pid = _product(db, admin)
    inf = _influencer(db, owner=bd)
    other = _influencer(db, phone="15000000002", douyin_id="other")
    app = apply_product(pid, ApplyProductIn(), inf, db)["application"]
    review_application(app["id"], ReviewIn(approve=True), bd, db)

    res = submit_product_video(pid, SubmitVideoIn(
        dy_url="https://v.douyin.com/submitted",
        oss_key="video_outputs/a.mp4",
        note="第一版成片,请帮忙看开头",
    ), inf, db)

    task = db.get(VideoTask, res["video_task_id"])
    mat = db.get(Material, res["material_id"])
    assert task.status == "submitted"
    assert task.submit_note == "第一版成片,请帮忙看开头"
    assert mat.type == "video_output"
    assert mat.influencer_id == inf.id
    assert mat.video_task_id == task.id
    assert mat.is_public is False

    owner_detail = asyncio.run(my_materials(pid, inf, db))
    owner_mat = next(m for m in owner_detail["materials"] if m["id"] == mat.id)
    assert owner_mat["mine"] is True
    assert owner_mat["source_link"] == "https://v.douyin.com/submitted"
    assert owner_mat["parsed_text"] == "第一版成片,请帮忙看开头"
    assert mat.id not in [m["id"] for m in asyncio.run(my_materials(pid, other, db))["materials"]]

    create_material_comment(mat.id, MaterialCommentIn(body="00:05 产品露出再提前一点"), bd, db)
    videos = my_videos(inf, db)
    assert videos[0]["material_id"] == mat.id
    assert videos[0]["unread_comment_count"] == 1
    assert videos[0]["comments"][0]["body"] == "00:05 产品露出再提前一点"


def test_application_overview_prefers_bound_sample_over_newer_pending_sample(db, admin, bd):
    pid = _product(db, admin)
    inf = _influencer(db, owner=bd)
    app = apply_product(pid, ApplyProductIn(), inf, db)["application"]
    review_application(app["id"], ReviewIn(approve=True), bd, db)
    bound_id = list_applications(status="approved", user=admin, db=db)["items"][0]["sample_order_id"]
    bound = db.get(SampleOrder, bound_id)
    bound.status = "signed"
    db.commit()

    create_sample(SampleCreateIn(influencer_id=inf.id, product_id=pid), bd, db)

    overview = product_detail(pid, admin, db)["application_overview"]
    assert overview["items"][0]["status"] == "signed"
    assert my_products(inf, db)[0]["cooperation_status"] == "signed"


def test_review_application_reject_requires_reason(db, admin, bd):
    pid = _product(db, admin)
    inf = _influencer(db, owner=bd)
    app = apply_product(pid, ApplyProductIn(), inf, db)["application"]
    with pytest.raises(HTTPException) as exc:
        review_application(app["id"], ReviewIn(approve=False), bd, db)
    assert exc.value.status_code == 400


def test_review_application_reject_syncs_linked_sample(db, admin, bd):
    """旧寄样入口生成的待审单被带货管理拒绝时,寄样单也必须闭环变成已拒绝。"""
    pid = _product(db, admin)
    inf = _influencer(db, owner=bd)
    db.add(Cooperation(influencer_id=inf.id, round_no=1, level_snapshot="L1",
                       commission_tier_snapshot=5, promo_mode_snapshot="merchant"))
    db.commit()
    sample = create_sample(SampleCreateIn(influencer_id=inf.id, product_id=pid), bd, db)

    review_application(sample["application_id"], ReviewIn(approve=False, reject_reason="不适合该产品"), bd, db)

    order = db.get(SampleOrder, sample["id"])
    assert order.status == "rejected"
    assert order.reject_reason == "不适合该产品"
    detail = asyncio.run(my_materials(pid, inf, db))
    assert detail["application"]["status"] == "rejected"
    assert detail["sample"]["status"] == "rejected"


def test_pending_application_can_be_rejected_after_product_off(db, admin, bd):
    pid = _product(db, admin)
    inf = _influencer(db, owner=bd)
    app = apply_product(pid, ApplyProductIn(), inf, db)["application"]
    db.get(Product, pid).status = "off"
    db.commit()

    review_application(app["id"], ReviewIn(approve=False, reject_reason="产品暂停"), bd, db)

    rejected = list_applications(status="rejected", user=admin, db=db)["items"]
    assert len(rejected) == 1
    assert rejected[0]["reject_reason"] == "产品暂停"


def test_sample_create_reopens_rejected_application(db, admin, bd):
    pid = _product(db, admin)
    inf = _influencer(db, owner=bd)
    db.add(Cooperation(influencer_id=inf.id, round_no=1, level_snapshot="L1",
                       commission_tier_snapshot=5, promo_mode_snapshot="merchant"))
    app = apply_product(pid, ApplyProductIn(), inf, db)["application"]
    review_application(app["id"], ReviewIn(approve=False, reject_reason="先拒绝"), bd, db)

    sample = create_sample(SampleCreateIn(influencer_id=inf.id, product_id=pid), bd, db)

    pending = list_applications(status="pending", user=admin, db=db)["items"]
    assert len(pending) == 1
    assert pending[0]["sample_order_id"] == sample["id"]
    assert pending[0]["reject_reason"] is None


def test_product_application_overview_counts_more_than_preview_limit(db, admin):
    pid = _product(db, admin)
    for i in range(25):
        inf = _influencer(db, phone=f"1500000{i:04d}", douyin_id=f"d{i}")
        apply_product(pid, ApplyProductIn(), inf, db)

    overview = product_detail(pid, admin, db)["application_overview"]

    assert overview["counts"]["total"] == 25
    assert overview["counts"]["pending"] == 25
    assert len(overview["items"]) == 20


def test_deleting_pending_sample_cancels_application_without_fk_break(db, admin, bd):
    pid = _product(db, admin)
    inf = _influencer(db, owner=bd)
    db.add(Cooperation(influencer_id=inf.id, round_no=1, level_snapshot="L1",
                       commission_tier_snapshot=5, promo_mode_snapshot="merchant"))
    db.commit()
    sample = create_sample(SampleCreateIn(influencer_id=inf.id, product_id=pid), bd, db)

    delete_sample(sample["id"], bd, db)

    cancelled = list_applications(status="cancelled", user=admin, db=db)["items"]
    assert len(cancelled) == 1
    assert cancelled[0]["sample_order_id"] is None


def test_delete_product_cleans_material_children(db, admin, bd):
    pid = _product(db, admin)
    m = add_material(pid, MaterialIn(type="video_output", oss_key="video_output/a.mp4"), admin, db)
    create_material_comment(m["id"], MaterialCommentIn(
        body="带附件评论",
        attachments=[MaterialCommentAttachmentIn(oss_key="comments/proof.png", filename="proof.png")],
    ), bd, db)
    db.add(MaterialReadState(material_id=m["id"], influencer_id=_influencer(db).id))
    create_material_post(pid, MaterialPostIn(
        caption="内容帖",
        assets=[MaterialAssetIn(type="image", oss_key="posts/a.png", filename="a.png")],
    ), admin, db)
    db.commit()

    delete_product(pid, admin, db)

    assert db.get(Product, pid) is None
    assert db.query(Material).count() == 0
    assert db.query(MaterialComment).count() == 0
    assert db.query(MaterialCommentAttachment).count() == 0
    assert db.query(MaterialReadState).count() == 0
    assert db.query(MaterialPost).count() == 0
    assert db.query(MaterialAsset).count() == 0


def test_h5_video_output_comments_and_unread_badges(db, admin, bd):
    pid = _product(db, admin)
    m = add_material(pid, MaterialIn(type="video_output", oss_key="video_output/a.mp4"), admin, db)
    create_material_comment(m["id"], MaterialCommentIn(body="这里要补一版字幕"), bd, db)
    inf = _grant_influencer(db, pid, admin.id)
    publish_material(m["id"], MaterialPublishIn(is_public=True), admin, db)

    products = my_products(inf, db)
    assert products[0]["unread_badge"] == 2

    res = asyncio.run(my_materials(pid, inf, db))
    mat = next(x for x in res["materials"] if x["type"] == "video_output")
    assert mat["comments"][0]["body"] == "这里要补一版字幕"
    assert mat["unread_total"] == 2       # 新成片 + 1 条新评论
    assert res["unread_badges"]["video_output"] == 2

    mark_material_read(m["id"], MaterialReadIn(scope="all"), inf, db)
    res2 = asyncio.run(my_materials(pid, inf, db))
    mat2 = next(x for x in res2["materials"] if x["type"] == "video_output")
    assert mat2["unread_total"] == 0
    assert res2["unread_badges"]["video_output"] == 0
    assert my_products(inf, db)[0]["unread_badge"] == 0


# ---------- 做法B:id 文件网关(域名+id+签名,后端反查 key) ----------

def test_material_file_url_is_signed_and_verifiable():
    from app.services import storage
    url = storage.material_file_url(42)
    assert url.startswith("/api/material-file/42?e=")
    import re
    e = re.search(r"e=(\d+)", url).group(1)
    s = re.search(r"s=([0-9a-f]+)", url).group(1)
    assert storage.verify_local("mat:42", e, s) is True
    assert storage.verify_local("mat:43", e, s) is False   # 换 id 签名失效
    # 下载地址带 dl=1
    assert "&dl=1" in storage.material_file_url(42, download=True)


def test_serve_material_file_rejects_bad_signature(db, admin):
    from app.api.uploads import serve_material_file
    pid = _product(db, admin)
    m = add_material(pid, MaterialIn(type="video_ai", oss_key="video_ai/x.mp4"), admin, db)
    with pytest.raises(HTTPException) as e:
        serve_material_file(m["id"], request=None, db=db, e="1", s="deadbeef")
    assert e.value.status_code == 403


def test_serve_material_file_missing_returns_404(db, admin):
    from app.services import storage
    from app.api.uploads import serve_material_file
    import re
    url = storage.material_file_url(999999)
    e = re.search(r"e=(\d+)", url).group(1); s = re.search(r"s=([0-9a-f]+)", url).group(1)
    with pytest.raises(HTTPException) as exc:
        serve_material_file(999999, request=None, db=db, e=e, s=s)
    assert exc.value.status_code == 404


def test_internal_material_dict_uses_id_gateway(db, admin):
    pid = _product(db, admin)
    m = add_material(pid, MaterialIn(type="pdf", oss_key="pdf/report.png"), admin, db)
    d = next(x for x in product_detail(pid, admin, db)["materials"] if x["id"] == m["id"])
    assert d["url"].startswith(f"/api/material-file/{m['id']}?")
    assert d["download_url"].endswith("dl=1") or "&dl=1" in d["download_url"]
    assert d["is_image"] is True            # .png 报告按图片
    assert "aliyuncs.com" not in (d["url"] or "")   # 不暴露裸 OSS 域名


def test_h5_material_dict_hides_key(db, admin):
    pid = _product(db, admin)
    add_material(pid, MaterialIn(type="video_ai", oss_key="video_ai/v.mp4"), admin, db)
    inf = _grant_influencer(db, pid, admin.id)
    res = asyncio.run(my_materials(pid, inf, db))
    mat = res["materials"][0]
    assert "oss_key" not in mat                      # 达人端不下发 key
    assert mat["url"].startswith(f"/api/material-file/{mat['id']}?")
