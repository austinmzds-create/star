"""巨量引擎/千川授权与绑定服务。

当前先实现标准 OAuth 授权码链路、状态签名和 token 换取入口。千川具体
接口路径由环境变量配置,避免把服务商后台参数写死在业务代码里。
"""
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
from itsdangerous import BadSignature, URLSafeTimedSerializer

from ..config import settings

STATE_MAX_AGE = 10 * 60
_state_serializer = URLSafeTimedSerializer(settings.secret_key, salt="qianchuan-oauth")


def oauth_configured() -> bool:
    return bool(settings.oceanengine_app_id and settings.oceanengine_secret
                and settings.oceanengine_redirect_uri)


def missing_config() -> list[str]:
    fields = []
    if not settings.oceanengine_app_id:
        fields.append("OCEANENGINE_APP_ID")
    if not settings.oceanengine_secret:
        fields.append("OCEANENGINE_SECRET")
    if not settings.oceanengine_redirect_uri:
        fields.append("OCEANENGINE_REDIRECT_URI")
    return fields


def cooperation_sync_configured() -> bool:
    return bool(oauth_configured() and settings.oceanengine_cooperation_sync_url)


def missing_cooperation_sync_config() -> list[str]:
    fields = missing_config()
    if not settings.oceanengine_cooperation_sync_url:
        fields.append("OCEANENGINE_COOPERATION_SYNC_URL")
    return fields


def sign_state(product_id: int | None, user_id: int) -> str:
    return _state_serializer.dumps({
        "product_id": product_id,
        "user_id": user_id,
        "ts": datetime.now().isoformat(),
    })


def load_state(state: str) -> dict:
    try:
        return _state_serializer.loads(state, max_age=STATE_MAX_AGE)
    except BadSignature as exc:
        raise ValueError("千川授权状态已过期或不合法,请重新发起授权") from exc


def build_auth_url(state: str) -> str:
    params = {
        "app_id": settings.oceanengine_app_id,
        "redirect_uri": settings.oceanengine_redirect_uri,
        "state": state,
        "response_type": "code",
    }
    if settings.oceanengine_scope:
        params["scope"] = settings.oceanengine_scope
    return f"{settings.oceanengine_auth_url}?{urlencode(params)}"


def _pick(data: dict, *keys):
    for key in keys:
        if key in data and data[key] not in (None, ""):
            return data[key]
    return None


def normalize_token_payload(payload: dict[str, Any]) -> dict:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    advertiser_ids = data.get("advertiser_ids") or data.get("advertiser_id_list") or []
    advertiser_id = _pick(data, "advertiser_id", "advertiserId")
    if not advertiser_id and advertiser_ids:
        advertiser_id = str(advertiser_ids[0])
    expires_in = _pick(data, "expires_in", "expiresIn")
    refresh_expires_in = _pick(data, "refresh_expires_in", "refreshExpiresIn")
    return {
        "access_token": _pick(data, "access_token", "accessToken"),
        "refresh_token": _pick(data, "refresh_token", "refreshToken"),
        "advertiser_id": str(advertiser_id) if advertiser_id else None,
        "shop_id": str(_pick(data, "shop_id", "shopId")) if _pick(data, "shop_id", "shopId") else None,
        "shop_name": _pick(data, "shop_name", "shopName", "name"),
        "scopes": data.get("scope") or data.get("scopes"),
        "expires_at": datetime.now() + timedelta(seconds=int(expires_in)) if expires_in else None,
        "refresh_expires_at": (
            datetime.now() + timedelta(seconds=int(refresh_expires_in))
            if refresh_expires_in else None
        ),
        "raw_payload": payload,
    }


async def exchange_code(code: str) -> dict:
    if not oauth_configured():
        raise ValueError("千川开放平台参数未配置:" + ",".join(missing_config()))
    body = {
        "app_id": settings.oceanengine_app_id,
        "secret": settings.oceanengine_secret,
        "grant_type": "auth_code",
        "auth_code": code,
        "code": code,
    }
    async with httpx.AsyncClient(timeout=12) as client:
        resp = await client.post(settings.oceanengine_token_url, json=body)
    try:
        payload = resp.json()
    except ValueError as exc:
        raise ValueError("千川 token 接口返回非 JSON 响应") from exc
    if resp.status_code >= 400:
        raise ValueError(payload.get("message") or payload.get("msg") or "千川 token 换取失败")
    code_value = payload.get("code")
    if code_value not in (None, 0, "0"):
        raise ValueError(payload.get("message") or payload.get("msg") or "千川 token 换取失败")
    return normalize_token_payload(payload)


def _extract_cooperation_id(payload: dict[str, Any]) -> str | None:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    value = _pick(data, "qianchuan_cooperation_id", "cooperation_id", "cooperationId", "id")
    return str(value) if value else None


async def sync_cooperation(access_token: str, body: dict[str, Any]) -> dict:
    """调用可配置的千川合作同步/创建接口。

    正式接口确认前不在业务代码中写死路径与返回字段。只有配置了
    OCEANENGINE_COOPERATION_SYNC_URL 时才会发起真实请求,否则上层拒绝操作。
    """
    if not cooperation_sync_configured():
        raise ValueError("千川合作同步接口未配置:" + ",".join(missing_cooperation_sync_config()))
    headers = {}
    params = {}
    mode = settings.oceanengine_access_token_mode.lower()
    if mode not in {"query", "header"}:
        raise ValueError("OCEANENGINE_ACCESS_TOKEN_MODE 仅支持 query/header")
    if mode == "header":
        headers[settings.oceanengine_access_token_header] = access_token
    else:
        params[settings.oceanengine_access_token_param] = access_token
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(settings.oceanengine_cooperation_sync_url, params=params,
                                 json=body, headers=headers)
    try:
        payload = resp.json()
    except ValueError as exc:
        raise ValueError("千川合作同步接口返回非 JSON 响应") from exc
    if resp.status_code >= 400:
        raise ValueError(payload.get("message") or payload.get("msg") or "千川合作同步失败")
    code_value = payload.get("code")
    if code_value not in (None, 0, "0"):
        raise ValueError(payload.get("message") or payload.get("msg") or "千川合作同步失败")
    external_id = _extract_cooperation_id(payload)
    if not external_id:
        raise ValueError("千川合作同步成功但未返回合作ID,请检查接口字段映射")
    return {"qianchuan_cooperation_id": external_id, "raw_payload": payload}
