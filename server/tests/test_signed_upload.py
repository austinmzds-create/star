"""签名直传端点:白名单、大小限制、签名票据形态(OSS 调用打桩)。"""
import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.api.uploads import (DirectUploadIn, MultipartAbortIn,  # noqa: E402
                             MultipartCompleteIn, MultipartInitIn,
                             direct_upload_ticket, multipart_abort,
                             multipart_complete, multipart_init)
from app.services import storage  # noqa: E402


class _User:
    id = 1
    display_name = "admin"


@pytest.fixture
def signed(monkeypatch):
    """模拟已配 AK 的签名直传环境,打桩所有 OSS 调用。"""
    monkeypatch.setattr(storage, "use_oss", lambda: True)
    monkeypatch.setattr(storage, "use_signed_upload", lambda: True)
    monkeypatch.setattr(storage, "signed_put_url",
                        lambda key, content_type, expires=3600: f"https://oss/{key}?ct={content_type}&sig=put")
    monkeypatch.setattr(storage, "preview_url", lambda key: f"/api/files/{key}?e=1&s=x")
    monkeypatch.setattr(storage, "inline_preview_enabled", lambda: False)


def test_direct_ticket_returns_signed(signed):
    t = direct_upload_ticket(
        DirectUploadIn(filename="a.png", content_type="text/html", size_bytes=1024),
        _User(),
    )
    assert t["signed"] is True
    assert t["upload_url"].endswith("sig=put")
    assert t["content_type"] == "image/png"       # 采信扩展名,不采信前端 text/html
    assert t["part_size"] == storage.MULTIPART_PART_SIZE   # 大文件走分片并行直传


def test_direct_ticket_rejects_bad_ext(signed):
    with pytest.raises(HTTPException) as e:
        direct_upload_ticket(DirectUploadIn(filename="x.html", size_bytes=1), _User())
    assert e.value.status_code == 400


def test_direct_ticket_rejects_empty_or_missing_size(signed):
    for size in (None, 0, -1):
        with pytest.raises(HTTPException) as e:
            direct_upload_ticket(DirectUploadIn(filename="x.mp4", size_bytes=size), _User())
        assert e.value.status_code == 400


def test_direct_ticket_rejects_over_limit(signed):
    with pytest.raises(HTTPException) as e:
        direct_upload_ticket(
            DirectUploadIn(filename="x.mp4", size_bytes=201 * 1024 * 1024),
            _User(),
        )
    assert e.value.status_code == 413


def test_unsigned_ticket_shape_when_anonymous(monkeypatch):
    """未配 AK(匿名公共 bucket):票据 signed=False,保持旧公共 URL 行为。"""
    monkeypatch.setattr(storage, "use_oss", lambda: True)
    monkeypatch.setattr(storage, "use_signed_upload", lambda: False)
    monkeypatch.setattr(storage, "public_object_url", lambda key: f"https://pub/{key}")
    monkeypatch.setattr(storage, "preview_url", lambda key: f"/api/files/{key}?e=1&s=x")
    monkeypatch.setattr(storage, "inline_preview_enabled", lambda: False)
    t = direct_upload_ticket(DirectUploadIn(filename="a.png", size_bytes=1), _User())
    assert t["signed"] is False and t["upload_url"].startswith("https://pub/")


def test_https_url_forces_https():
    assert storage._https_url("http://x.oss/y?z=1") == "https://x.oss/y?z=1"
    assert storage._https_url("https://x.oss/y") == "https://x.oss/y"


@pytest.fixture
def multipart(monkeypatch):
    """打桩分片直传所需的 OSS 调用。"""
    monkeypatch.setattr(storage, "use_signed_upload", lambda: True)
    monkeypatch.setattr(storage, "init_multipart", lambda key, ct=None: "UP123")
    monkeypatch.setattr(storage, "signed_part_url",
                        lambda key, upload_id, i, expires=3600: f"https://oss/{key}?partNumber={i}&uploadId={upload_id}&sig=p")


def test_multipart_init_signs_each_part(multipart):
    r = multipart_init(MultipartInitIn(key="materials/a.mp4", parts=3), _User())
    assert r["upload_id"] == "UP123"
    assert [p["part_number"] for p in r["parts"]] == [1, 2, 3]
    assert all("uploadId=UP123" in p["url"] for p in r["parts"])


def test_multipart_init_rejects_bad_key(multipart):
    for bad in ("materials/a.html", "../etc/passwd", "/abs/x.mp4"):
        with pytest.raises(HTTPException) as e:
            multipart_init(MultipartInitIn(key=bad, parts=1), _User())
        assert e.value.status_code == 400


def test_multipart_requires_signed_upload(monkeypatch):
    monkeypatch.setattr(storage, "use_signed_upload", lambda: False)
    with pytest.raises(HTTPException) as e:
        multipart_init(MultipartInitIn(key="materials/a.mp4", parts=1), _User())
    assert e.value.status_code == 400


def test_multipart_complete_ok_and_rejects_empty(multipart, monkeypatch):
    seen = {}
    monkeypatch.setattr(storage, "complete_multipart",
                        lambda key, uid, parts: seen.update(key=key, uid=uid, n=len(parts)))
    r = multipart_complete(MultipartCompleteIn(
        key="materials/a.mp4", upload_id="UP123",
        parts=[{"part_number": 1, "etag": "e1"}, {"part_number": 2, "etag": "e2"}]), _User())
    assert r["ok"] is True and seen == {"key": "materials/a.mp4", "uid": "UP123", "n": 2}
    with pytest.raises(HTTPException) as e:
        multipart_complete(MultipartCompleteIn(key="materials/a.mp4", upload_id="UP123", parts=[]), _User())
    assert e.value.status_code == 400


def test_multipart_abort_best_effort(multipart, monkeypatch):
    called = {}
    monkeypatch.setattr(storage, "abort_multipart", lambda key, uid: called.update(key=key, uid=uid))
    r = multipart_abort(MultipartAbortIn(key="materials/a.mp4", upload_id="UP123"), _User())
    assert r["ok"] is True and called == {"key": "materials/a.mp4", "uid": "UP123"}


def test_maybe_accelerate_swaps_host_only_when_enabled(monkeypatch):
    """开传输加速:只换 host 为加速域名,path/query(含签名)原样保留;关则不动。"""
    monkeypatch.setattr(storage.settings, "oss_bucket", "viceo-public")
    monkeypatch.setattr(storage.settings, "oss_accelerate_endpoint", "oss-accelerate.aliyuncs.com")
    url = "https://viceo-public.oss-cn-shanghai.aliyuncs.com/materials/x.mp4?Signature=abc%2B%3D&Expires=1"

    monkeypatch.setattr(storage.settings, "oss_accelerate", False)
    assert storage._maybe_accelerate(url) == url

    monkeypatch.setattr(storage.settings, "oss_accelerate", True)
    out = storage._maybe_accelerate(url)
    assert out == "https://viceo-public.oss-accelerate.aliyuncs.com/materials/x.mp4?Signature=abc%2B%3D&Expires=1"
    # 签名串(query)未被改动,换域名后签名依然有效
    assert out.split("?", 1)[1] == url.split("?", 1)[1]
