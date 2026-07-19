import os
import sys

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.api.admin_config import BdIn, BdToggleIn, create_bd, delete_bd, list_bd, update_bd  # noqa: E402
from app.api.preferences import PreferenceIn, get_preference, set_preference  # noqa: E402
from app.api.products import ProductIn, create as create_product, detail as product_detail  # noqa: E402
from app.api.products import list_products, update_product  # noqa: E402
from app.db import Base  # noqa: E402
from app.models import Product, User  # noqa: E402
from app.security import verify_password  # noqa: E402


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


@pytest.fixture
def admin(db):
    user = User(username="admin", display_name="管理员", role="admin")
    db.add(user)
    db.commit()
    return user


def test_bd_management_create_edit_disable_delete_and_password_reset(db, admin):
    result = create_bd(BdIn(phone=" 13900001234 ", display_name=" 张三 "), admin, db)
    bd = db.get(User, result["id"])
    assert bd.display_name == "张三"
    assert bd.phone == "13900001234"
    assert bd.is_active is True
    assert verify_password("001234", bd.password_hash)

    update_bd(
        bd.id,
        BdToggleIn(display_name="李四", phone="13900005678", is_active=False),
        admin,
        db,
    )
    db.refresh(bd)

    assert bd.display_name == "李四"
    assert bd.phone == "13900005678"
    assert bd.is_active is False
    assert verify_password("005678", bd.password_hash)
    assert not verify_password("001234", bd.password_hash)
    assert list_bd(admin, db)[0]["display_name"] == "李四"

    delete_bd(bd.id, admin, db)
    assert db.get(User, bd.id) is None


def test_bd_management_rejects_duplicate_phone(db, admin):
    db.add(User(phone="13900001234", display_name="已有商务", role="bd"))
    db.commit()

    with pytest.raises(HTTPException) as exc:
        create_bd(BdIn(phone="13900001234", display_name="新商务"), admin, db)

    assert exc.value.status_code == 400
    assert exc.value.detail == "该手机号已是内部账号"


def test_product_commissions_are_persisted_and_returned(db, admin):
    result = create_product(
        ProductIn(
            name=" 测试产品 ",
            price_text="99",
            default_commission=0,
            merchant_promotion_commission=12.5,
        ),
        admin,
        db,
    )
    product = db.get(Product, result["id"])
    assert product.name == "测试产品"

    listed = list_products(user=admin, db=db)
    assert listed[0]["default_commission"] == 0
    assert listed[0]["merchant_promotion_commission"] == 12.5

    detail = product_detail(product.id, user=admin, db=db)
    assert detail["default_commission"] == 0
    assert detail["merchant_promotion_commission"] == 12.5

    update_product(
        product.id,
        ProductIn(
            name="测试产品",
            default_commission=6,
            merchant_promotion_commission=18,
        ),
        admin,
        db,
    )
    db.refresh(product)
    assert float(product.default_commission) == 6
    assert float(product.merchant_promotion_commission) == 18


def test_product_merchant_commission_must_be_percent_range(db, admin):
    with pytest.raises(HTTPException) as exc:
        create_product(
            ProductIn(name="测试产品", merchant_promotion_commission=120),
            admin,
            db,
        )

    assert exc.value.status_code == 400
    assert exc.value.detail == "商家投流佣金需在 0-100 之间"


def test_influencer_column_preference_is_per_user_and_validated(db):
    first = User(phone="13900000001", display_name="商务一", role="bd")
    second = User(phone="13900000002", display_name="商务二", role="bd")
    db.add_all([first, second])
    db.commit()

    assert get_preference("influencer_columns", first, db)["value"] is None
    saved = set_preference(
        "influencer_columns",
        PreferenceIn(value={"columns": ["gmv_30d", "nickname", "nickname"]}),
        first,
        db,
    )

    assert saved["value"] == {"columns": ["gmv_30d", "nickname"]}
    assert get_preference("influencer_columns", first, db)["value"] == saved["value"]
    assert get_preference("influencer_columns", second, db)["value"] is None


def test_influencer_column_preference_rejects_unknown_columns(db):
    user = User(phone="13900000001", display_name="商务", role="bd")
    db.add(user)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        set_preference(
            "influencer_columns",
            PreferenceIn(value={"columns": ["nickname", "unknown"]}),
            user,
            db,
        )

    assert exc.value.status_code == 400
    assert exc.value.detail == "存在不支持的列"
