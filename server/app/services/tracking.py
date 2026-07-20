"""寄样物流刷新与落库。

所有物流轨迹以 sample_orders.logistics_status 为准。实时查询失败或返回空轨迹时,
优先复用同单号历史缓存,避免同一快递在重复寄样单/合并达人后出现一边有轨迹一边空白。
"""
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import SampleOrder
from .logistics import get_provider


def _now_iso() -> str:
    return datetime.now().isoformat()


def _events(status: dict | None) -> list:
    return (status or {}).get("events") or []


def has_tracking_events(status: dict | None) -> bool:
    return bool((status or {}).get("last_event") or _events(status))


def _with_checked_at(status: dict | None) -> dict:
    data = dict(status or {})
    data["queried_at"] = _now_iso()
    return data


def _is_stale(status: dict | None, minutes: int) -> bool:
    if not status:
        return True
    value = status.get("queried_at")
    if not value:
        return True
    try:
        return datetime.fromisoformat(value) < datetime.now() - timedelta(minutes=minutes)
    except (TypeError, ValueError):
        return True


def _cached_status(db: Session, order: SampleOrder) -> dict | None:
    if not order.tracking_no or not order.courier_company:
        return None
    rows = db.scalars(
        select(SampleOrder)
        .where(
            SampleOrder.id != order.id,
            SampleOrder.tracking_no == order.tracking_no,
            SampleOrder.courier_company == order.courier_company,
            SampleOrder.logistics_status.is_not(None),
        )
        .order_by(SampleOrder.updated_at.desc(), SampleOrder.id.desc())
    ).all()
    for row in rows:
        if has_tracking_events(row.logistics_status):
            cached = dict(row.logistics_status or {})
            cached["ok"] = True
            cached["source"] = "cached_same_tracking"
            return _with_checked_at(cached)
    return None


def _apply_status(order: SampleOrder, status: dict) -> None:
    order.logistics_status = status
    if status.get("signed") and not order.signed_at:
        order.signed_at = datetime.now()
        order.status = "signed"
    # 签收是终态,只进不退:已签收单不因后续(缓存回填/重查)非签收轨迹被改回在途,
    # 否则催拍扫描(只认 signed)会把已签收单漏掉。
    elif status.get("status") and order.status in ("shipped", "in_transit"):
        order.status = status["status"]


async def refresh_order_tracking(db: Session, order: SampleOrder) -> dict:
    """实时查询并落库;空结果不覆盖已有有效轨迹。"""
    if not order.tracking_no or not order.courier_company:
        return order.logistics_status or {}

    phone = (order.address_snapshot or {}).get("tel")
    result = await get_provider().query_realtime(order.tracking_no, order.courier_company, phone)
    result = _with_checked_at(result)
    current = order.logistics_status

    if has_tracking_events(result):
        _apply_status(order, result)
        db.commit()
        return result

    fallback = current if has_tracking_events(current) else _cached_status(db, order)
    if fallback:
        merged = dict(fallback)
        merged["message"] = "已保留同单号有效轨迹"
        merged["ok"] = True
        merged["queried_at"] = result["queried_at"]
        _apply_status(order, merged)
        db.commit()
        return merged

    _apply_status(order, result)
    db.commit()
    return result


async def refresh_if_needed(db: Session, order: SampleOrder | None,
                            stale_minutes: int = 30) -> SampleOrder | None:
    """读接口兜底刷新:缺轨迹或轨迹过期时更新一次。"""
    if not order or not order.tracking_no or not order.courier_company:
        return order
    if order.status == "signed" and has_tracking_events(order.logistics_status):
        return order
    if has_tracking_events(order.logistics_status) and not _is_stale(order.logistics_status, stale_minutes):
        return order
    await refresh_order_tracking(db, order)
    db.refresh(order)
    return order
