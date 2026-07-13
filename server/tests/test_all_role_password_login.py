import os
import sys
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, update
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db import Base  # noqa: E402
from app.api.auth import LoginIn, login  # noqa: E402
from app.models import Influencer, User  # noqa: E402
from app.security import hash_password, verify_password  # noqa: E402


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


def test_new_phone_accounts_receive_default_passwords(db):
    user = User(phone="13900001234", display_name="商务")
    influencer = Influencer(phone="15095037973", nickname="达人")

    db.add_all([user, influencer])
    db.commit()

    assert verify_password("001234", user.password_hash)
    assert verify_password("037973", influencer.password_hash)


def test_default_phone_password_uses_fast_bcrypt_cost(db):
    user = User(phone="13900001234", display_name="商务")

    db.add(user)
    db.commit()

    assert int(user.password_hash.split("$")[2]) == 4


def test_influencer_without_phone_has_no_password(db):
    influencer = Influencer(nickname="暂无手机号")

    db.add(influencer)
    db.commit()

    assert influencer.password_hash is None


def test_seed_missing_passwords_only_fills_phone_accounts_without_hash(db):
    from app.services.account_passwords import seed_missing_passwords

    missing_user = User(phone="13900005678", display_name="历史商务")
    missing_influencer = Influencer(phone="15000004321", nickname="历史达人")
    no_phone_influencer = Influencer(nickname="无手机号达人")
    custom_password_hash = hash_password("custom-password")
    custom_user = User(
        phone="13900009999",
        display_name="自定义密码商务",
        password_hash=custom_password_hash,
    )
    db.add_all([
        missing_user,
        missing_influencer,
        no_phone_influencer,
        custom_user,
    ])
    db.commit()

    # 绕过模型事件，模拟升级前 password_hash 为空的历史数据。
    db.execute(
        update(User)
        .where(User.id == missing_user.id)
        .values(password_hash=None)
    )
    db.execute(
        update(Influencer)
        .where(Influencer.id == missing_influencer.id)
        .values(password_hash=None)
    )
    db.commit()

    with patch.object(db, "commit", wraps=db.commit) as commit_spy:
        changed = seed_missing_passwords(db)

    assert changed == 2
    assert commit_spy.call_count == 1
    assert verify_password("005678", missing_user.password_hash)
    assert verify_password("004321", missing_influencer.password_hash)
    assert no_phone_influencer.password_hash is None
    assert custom_user.password_hash == custom_password_hash
    assert verify_password("custom-password", custom_user.password_hash)


def test_seed_missing_passwords_does_not_commit_when_nothing_changes(db):
    from app.services.account_passwords import seed_missing_passwords

    with patch.object(db, "commit", wraps=db.commit) as commit_spy:
        changed = seed_missing_passwords(db)

    assert changed == 0
    assert commit_spy.call_count == 0


def test_explicit_admin_password_is_not_replaced_by_default_rule(db):
    admin_password_hash = hash_password("admin123")
    admin = User(
        username="admin",
        phone="13900001234",
        password_hash=admin_password_hash,
        display_name="管理员",
        role="admin",
    )

    db.add(admin)
    db.commit()

    assert admin.password_hash == admin_password_hash
    assert verify_password("admin123", admin.password_hash)
    assert not verify_password("001234", admin.password_hash)


def test_adding_phone_later_assigns_default_password(db):
    influencer = Influencer(nickname="后补手机号达人")
    db.add(influencer)
    db.commit()

    influencer.phone = "15000007777"
    db.commit()

    assert verify_password("007777", influencer.password_hash)


def test_explicit_admin_can_still_log_in_with_username(db):
    admin = User(
        username="admin",
        password_hash=hash_password("admin123"),
        display_name="管理员",
        role="admin",
    )
    db.add(admin)
    db.commit()

    result = login(LoginIn(username="admin", password="admin123"), db)

    assert result["kind"] == "staff"
    assert result["user"]["role"] == "admin"


def test_business_user_can_log_in_with_phone_and_default_password(db):
    user = User(phone="13900001234", display_name="商务", role="bd")
    db.add(user)
    db.commit()

    result = login(LoginIn(username="13900001234", password="001234"), db)

    assert result["kind"] == "staff"
    assert result["user"]["role"] == "bd"


def test_influencer_can_log_in_with_phone_and_default_password(db):
    influencer = Influencer(phone="15095037973", nickname="达人")
    db.add(influencer)
    db.commit()

    result = login(LoginIn(username="15095037973", password="037973"), db)

    assert result["kind"] == "influencer"
    assert result["user"]["role"] == "influencer"


def test_staff_account_wins_when_phone_matches_both_account_types(db):
    user = User(phone="13900001234", display_name="商务", role="bd")
    influencer = Influencer(phone="13900001234", nickname="同号达人")
    db.add_all([user, influencer])
    db.commit()

    result = login(LoginIn(username="13900001234", password="001234"), db)

    assert result["kind"] == "staff"
    assert result["user"]["id"] == user.id


@pytest.mark.parametrize(
    ("account", "username", "password"),
    [
        (
            User(phone="13900001234", display_name="停用商务", is_active=False),
            "13900001234",
            "001234",
        ),
        (
            Influencer(phone="15095037973", nickname="停用达人", archived=True),
            "15095037973",
            "037973",
        ),
    ],
    ids=["inactive-staff", "archived-influencer"],
)
def test_disabled_account_with_correct_password_is_rejected(db, account, username, password):
    db.add(account)
    db.commit()

    with pytest.raises(HTTPException) as exc_info:
        login(LoginIn(username=username, password=password), db)

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "账号已停用"


@pytest.mark.parametrize(
    ("account", "username", "password"),
    [
        (None, "missing", "anything"),
        (User(username="no-password", display_name="无密码商务"), "no-password", "anything"),
        (User(phone="13900001234", display_name="商务"), "13900001234", "wrong-password"),
        (Influencer(phone="15095037973", nickname="达人"), "15095037973", "wrong-password"),
    ],
    ids=["unknown-account", "no-password", "wrong-staff-password", "wrong-influencer-password"],
)
def test_invalid_password_login_has_one_error_response(db, account, username, password):
    if account is not None:
        db.add(account)
        db.commit()

    with pytest.raises(HTTPException) as exc_info:
        login(LoginIn(username=username, password=password), db)

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "账号或密码错误"
