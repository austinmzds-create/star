"""千川授权入口:生成授权 URL、OAuth 回调与已授权店铺查询。"""
import html
import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user
from ..models import Product, ProductQianchuanBinding, QianchuanShopAuth, User
from ..services import qianchuan

router = APIRouter(prefix="/api/qianchuan", tags=["qianchuan"])


class OAuthStartIn(BaseModel):
    product_id: int | None = None


@router.get("/config")
def config(user: User = Depends(current_user)):
    return {
        "oauth_configured": qianchuan.oauth_configured(),
        "missing": qianchuan.missing_config(),
        "cooperation_sync_configured": qianchuan.cooperation_sync_configured(),
        "missing_cooperation_sync": qianchuan.missing_cooperation_sync_config(),
        "integration_status": "config_missing" if not qianchuan.oauth_configured() else "oauth_ready",
    }


def _shop_auth_dict(row: QianchuanShopAuth) -> dict:
    return {
        "id": row.id,
        "platform": row.platform,
        "advertiser_id": row.advertiser_id,
        "shop_id": row.shop_id,
        "shop_name": row.shop_name,
        "auth_status": row.auth_status,
        "scopes": row.scopes,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
        "updated_at": row.updated_at.isoformat(),
    }


@router.get("/shop-auths")
def list_shop_auths(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(QianchuanShopAuth)
        .where(QianchuanShopAuth.auth_status == "active")
        .order_by(QianchuanShopAuth.updated_at.desc())
    ).all()
    return [_shop_auth_dict(row) for row in rows]


@router.post("/oauth/start")
def oauth_start(body: OAuthStartIn, user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    if body.product_id is not None and not db.get(Product, body.product_id):
        raise HTTPException(404, "产品不存在")
    if not qianchuan.oauth_configured():
        raise HTTPException(400, "千川开放平台参数未配置:" + ",".join(qianchuan.missing_config()))
    state = qianchuan.sign_state(body.product_id, user.id)
    return {"auth_url": qianchuan.build_auth_url(state), "state": state}


def _html(message: str) -> HTMLResponse:
    safe_message = html.escape(message)
    payload = json.dumps({"type": "qianchuan-oauth-finished"}, ensure_ascii=False)
    return HTMLResponse(f"""<!doctype html>
<meta charset="utf-8">
<title>千川授权</title>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px">
  <h3>{safe_message}</h3>
  <p>可以关闭此页面，回到产品中心继续操作。</p>
  <script>
    if (window.opener) window.opener.postMessage({payload}, '*');
  </script>
</body>""")


@router.get("/oauth/callback")
async def oauth_callback(code: str | None = None, state: str | None = None,
                         error: str | None = None,
                         db: Session = Depends(get_db)):
    if error:
        return _html(f"授权失败:{error}")
    if not code or not state:
        return _html("授权失败:缺少 code 或 state")
    try:
        state_data = qianchuan.load_state(state)
        token_data = await qianchuan.exchange_code(code)
    except ValueError as exc:
        return _html(str(exc))
    if not token_data.get("access_token"):
        return _html("授权失败:千川未返回 access_token")

    advertiser_id = token_data.get("advertiser_id")
    shop_id = token_data.get("shop_id")
    shop = None
    if advertiser_id:
        shop = db.scalars(select(QianchuanShopAuth)
                          .where(QianchuanShopAuth.advertiser_id == advertiser_id)).first()
    if not shop and shop_id:
        shop = db.scalars(select(QianchuanShopAuth)
                          .where(QianchuanShopAuth.shop_id == shop_id)).first()
    if not shop:
        shop = QianchuanShopAuth()
        db.add(shop)

    shop.platform = "oceanengine"
    shop.advertiser_id = advertiser_id
    shop.shop_id = shop_id
    shop.shop_name = token_data.get("shop_name")
    shop.auth_status = "active"
    scopes = token_data.get("scopes")
    if isinstance(scopes, str):
        scopes = [s.strip() for s in scopes.replace(",", " ").split() if s.strip()]
    shop.scopes = scopes if isinstance(scopes, list) else None
    shop.access_token = token_data.get("access_token")
    shop.refresh_token = token_data.get("refresh_token")
    shop.expires_at = token_data.get("expires_at")
    shop.refresh_expires_at = token_data.get("refresh_expires_at")
    shop.raw_payload = token_data.get("raw_payload")
    shop.last_error = None
    shop.authorized_by = state_data.get("user_id")
    db.flush()

    product_id = state_data.get("product_id")
    if product_id and db.get(Product, product_id):
        binding = db.scalars(select(ProductQianchuanBinding)
                             .where(ProductQianchuanBinding.product_id == product_id)).first()
        if not binding:
            binding = ProductQianchuanBinding(product_id=product_id)
            db.add(binding)
        binding.shop_auth_id = shop.id
        binding.shop_id = shop.shop_id
        binding.shop_name = shop.shop_name
        binding.advertiser_id = shop.advertiser_id
        binding.bind_status = "configured"
        binding.updated_by = state_data.get("user_id")
    db.commit()
    return _html("千川店铺授权成功")
