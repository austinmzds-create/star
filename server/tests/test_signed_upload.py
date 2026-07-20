"""签名直传端点:白名单、签名票据、分片编排入参校验(OSS 调用打桩)。"""
import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.api import uploads  # noqa: E402
from app.api.uploads import (DirectUploadIn, MultipartCompleteIn, MultipartInitIn,  # noqa: E402
                             direct_upload_ticket, multipart_complete, multipart_init)
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
    monkeypatch.setattr(storage, "signed_part_url",
                        lambda key, uid, pn, expires=3600: f"https://oss/{key}?partNumber={pn}&uploadId={uid}&sig=1")
    monkeypatch.setattr(storage, "init_multipart", lambda key, content_type=None: "UPLOAD123")
    completed = {}
    monkeypatch.setattr(storage, "complete_multipart",
                        lambda key, uid, parts: completed.update({"key": key, "parts": parts}))
    monkeypatch.setattr(storage, "preview_url", lambda key: f"/api/files/{key}?e=1&s=x")
    monkeypatch.setattr(storage, "inline_preview_enabled", lambda: False)
    return completed


def test_direct_ticket_returns_signed(signed):
    t = direct_upload_ticket(DirectUploadIn(filename="a.png", content_type="text/html"), _User())
    assert t["signed"] is True
    assert t["upload_url"].endswith("sig=put")
    assert t["content_type"] == "image/png"       # 采信扩展名,不采信前端 text/html
    assert "part_size" in t


def test_direct_ticket_rejects_bad_ext(signed):
    with pytest.raises(HTTPException) as e:
        direct_upload_ticket(DirectUploadIn(filename="x.html"), _User())
    assert e.value.status_code == 400


def test_multipart_init_returns_part_urls(signed):
    r = multipart_init(MultipartInitIn(key="materials/x.mp4", parts=3), _User())
    assert r["upload_id"] == "UPLOAD123"
    assert [p["part_number"] for p in r["parts"]] == [1, 2, 3]


def test_multipart_init_rejects_dangerous_key(signed):
    with pytest.raises(HTTPException) as e:
        multipart_init(MultipartInitIn(key="materials/evil.html", parts=1), _User())
    assert e.value.status_code == 400


def test_multipart_complete_passes_parts_through(signed):
    parts = [{"part_number": 1, "etag": '"abc"'}]
    r = multipart_complete(MultipartCompleteIn(key="materials/x.mp4", upload_id="U", parts=parts), _User())
    assert r["ok"] is True
    assert signed["key"] == "materials/x.mp4"


def test_multipart_complete_requires_parts(signed):
    with pytest.raises(HTTPException) as e:
        multipart_complete(MultipartCompleteIn(key="materials/x.mp4", upload_id="U", parts=[]), _User())
    assert e.value.status_code == 400


def test_endpoints_reject_when_not_signed(monkeypatch):
    monkeypatch.setattr(storage, "use_signed_upload", lambda: False)
    with pytest.raises(HTTPException) as e:
        multipart_init(MultipartInitIn(key="materials/x.mp4", parts=1), _User())
    assert e.value.status_code == 400


def test_unsigned_ticket_shape_when_anonymous(monkeypatch):
    """未配 AK(匿名公共 bucket):票据 signed=False,保持旧公共 URL 行为。"""
    monkeypatch.setattr(storage, "use_oss", lambda: True)
    monkeypatch.setattr(storage, "use_signed_upload", lambda: False)
    monkeypatch.setattr(storage, "public_object_url", lambda key: f"https://pub/{key}")
    monkeypatch.setattr(storage, "preview_url", lambda key: f"/api/files/{key}?e=1&s=x")
    monkeypatch.setattr(storage, "inline_preview_enabled", lambda: False)
    t = direct_upload_ticket(DirectUploadIn(filename="a.png"), _User())
    assert t["signed"] is False and t["upload_url"].startswith("https://pub/")
