"""签名直传端点:白名单、大小限制、签名票据形态(OSS 调用打桩)。"""
import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.api.uploads import DirectUploadIn, direct_upload_ticket  # noqa: E402
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
    assert "part_size" not in t                   # 前端统一单次签名 PUT,不再走自研分片


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
