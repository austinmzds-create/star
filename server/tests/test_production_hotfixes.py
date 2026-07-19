import asyncio
import os
import sys

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.api.auth import DevSwitchIn, dev_switch  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import Base  # noqa: E402
from app.models import User  # noqa: E402
from app.services import storage  # noqa: E402
from app.services.logistics import Kd100Provider  # noqa: E402


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_signed_image_urls_are_stable_within_an_hour(monkeypatch):
    monkeypatch.setattr(storage.time, "time", lambda: 10_000)
    first = storage.thumbnail_url("products/demo.jpg", 96)
    monkeypatch.setattr(storage.time, "time", lambda: 10_100)
    second = storage.thumbnail_url("products/demo.jpg", 96)

    assert first == second
    assert first.startswith("/api/thumbs/96/products/demo.jpg?")


def test_non_image_thumbnail_falls_back_to_signed_file_url(monkeypatch):
    monkeypatch.setattr(storage.time, "time", lambda: 10_000)

    url = storage.thumbnail_url("materials/demo.pdf", 96)

    assert url.startswith("/api/files/materials/demo.pdf?")


def test_oss_material_preview_uses_public_object_url(monkeypatch):
    monkeypatch.setattr(storage, "use_oss", lambda: True)
    monkeypatch.setattr(settings, "oss_endpoint", "oss-cn-shanghai.aliyuncs.com")
    monkeypatch.setattr(settings, "oss_bucket", "viceo-public")
    monkeypatch.setattr(settings, "oss_public_base_url", "")
    monkeypatch.setattr(settings, "oss_inline_preview", False)

    url = storage.public_or_signed_url("materials/demo video.mp4")

    assert url == "https://viceo-public.oss-cn-shanghai.aliyuncs.com/materials/demo%20video.mp4"
    assert storage.inline_preview_enabled() is False
    assert storage.preview_url("materials/demo video.mp4").startswith("/api/files/materials/demo%20video.mp4?")


def test_custom_oss_domain_can_enable_inline_preview(monkeypatch):
    monkeypatch.setattr(storage, "use_oss", lambda: True)
    monkeypatch.setattr(settings, "oss_public_base_url", "https://assets.example.com")
    monkeypatch.setattr(settings, "oss_inline_preview", True)

    assert storage.inline_preview_enabled() is True
    assert storage.public_or_signed_url("materials/demo.mp4") == "https://assets.example.com/materials/demo.mp4"
    assert storage.preview_url("materials/demo.mp4") == "https://assets.example.com/materials/demo.mp4"


def test_kd100_missing_config_returns_actionable_result(monkeypatch):
    monkeypatch.setattr(settings, "kd100_key", "")
    monkeypatch.setattr(settings, "kd100_customer", "")

    result = asyncio.run(
        Kd100Provider().query_realtime("YT123", "yuantong")
    )

    assert result["ok"] is False
    assert result["code"] == "CONFIG_MISSING"
    assert "KD100_KEY" in result["message"]
    assert result["events"] == []


def test_production_role_switch_requires_admin(monkeypatch, db):
    monkeypatch.setattr(settings, "debug", False)
    monkeypatch.setattr(settings, "enable_test_role_switcher", True)
    admin = User(username="admin", display_name="管理员", role="admin")
    bd = User(phone="13900000000", display_name="商务", role="bd")
    db.add_all([admin, bd])
    db.commit()

    with pytest.raises(HTTPException) as exc:
        dev_switch(DevSwitchIn(role="bd"), db, actor=bd)
    assert exc.value.status_code == 403

    result = dev_switch(DevSwitchIn(role="bd"), db, actor=admin)
    assert result["kind"] == "staff"
    assert result["user"]["role"] == "bd"


def test_production_role_switch_can_be_disabled(monkeypatch, db):
    monkeypatch.setattr(settings, "debug", False)
    monkeypatch.setattr(settings, "enable_test_role_switcher", False)
    admin = User(username="admin", display_name="管理员", role="admin")
    db.add(admin)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        dev_switch(DevSwitchIn(role="admin"), db, actor=admin)
    assert exc.value.status_code == 404
