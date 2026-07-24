"""Sample order business helpers shared by staff and H5 APIs."""
from datetime import datetime
from typing import Iterable

from ..models import SampleOrder
from .tracking import has_tracking_events

SHIPPED_BUCKET_STATUSES = ("shipped", "in_transit")
OPEN_SAMPLE_STATUSES = ("pending", "approved", "shipped", "in_transit")

_STATUS_RANK = {
    "rejected": 0,
    "pending": 1,
    "approved": 2,
    "shipped": 3,
    "in_transit": 4,
    "signed": 5,
}


def status_filter_values(status: str | None) -> list[str] | None:
    if not status:
        return None
    if status == "shipped":
        return list(SHIPPED_BUCKET_STATUSES)
    return [status]


def status_bucket(status: str | None) -> str | None:
    if status in SHIPPED_BUCKET_STATUSES:
        return "shipped"
    return status


def sample_dedupe_key(order: SampleOrder, influencer_id: int | None = None) -> tuple:
    tracking_no = (order.tracking_no or "").strip().upper()
    if tracking_no:
        return ("tracking", influencer_id, order.product_id, tracking_no)
    return ("order", order.id)


def _dt_value(value: datetime | None) -> float:
    return value.timestamp() if value else 0


def sample_quality_rank(order: SampleOrder) -> tuple:
    return (
        1 if has_tracking_events(order.logistics_status) else 0,
        _STATUS_RANK.get(order.status, 0),
        _dt_value(order.updated_at),
        _dt_value(order.created_at),
        order.id or 0,
    )


def dedupe_sample_rows(rows: Iterable, order_index: int = 0,
                       influencer_index: int | None = None) -> list:
    """Collapse duplicated shipments caused by historical merges.

    Duplicate means: same influencer + product + tracking number. Distinct
    tracking numbers stay visible because they represent real shipments.
    """
    best = {}
    for row in rows:
        order = row[order_index]
        influencer_id = None
        if influencer_index is not None:
            influencer = row[influencer_index]
            influencer_id = getattr(influencer, "id", None)
        key = sample_dedupe_key(order, influencer_id)
        current = best.get(key)
        if current is None or sample_quality_rank(order) > sample_quality_rank(current[order_index]):
            best[key] = row
    return sorted(
        best.values(),
        key=lambda row: (
            _dt_value(row[order_index].created_at),
            _dt_value(row[order_index].updated_at),
            row[order_index].id or 0,
        ),
        reverse=True,
    )
