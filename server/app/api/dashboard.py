"""管理员总览(A3):按商务 / 按产品 / 按佣金档,时间可筛,数字可下钻。"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_admin
from ..models import (Cooperation, Influencer, OrderRecord, SampleOrder, User,
                      VideoTask)

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _range(days: int | None):
    return datetime.now() - timedelta(days=days) if days else None


@router.get("/by-bd")
def by_bd(days: int | None = 30, admin: User = Depends(current_admin),
          db: Session = Depends(get_db)):
    since = _range(days)
    out = []
    for bd in db.scalars(select(User).where(User.role == "bd", User.is_active)).all():
        inf_ids = db.scalars(select(Influencer.id)
                             .where(Influencer.owner_bd_id == bd.id)).all()
        new_inf = db.scalar(select(func.count()).select_from(Influencer)
                            .where(Influencer.owner_bd_id == bd.id,
                                   *( [Influencer.created_at >= since] if since else [] )))
        gmv = db.scalar(select(func.coalesce(func.sum(OrderRecord.amount), 0))
                        .where(OrderRecord.influencer_id.in_(inf_ids or [0]),
                               *( [OrderRecord.order_date >= since] if since else [] )))
        coop_ids = db.scalars(select(Cooperation.id)
                              .where(Cooperation.influencer_id.in_(inf_ids or [0]))).all()
        videos = db.scalar(select(func.count()).select_from(VideoTask)
                           .where(VideoTask.cooperation_id.in_(coop_ids or [0]),
                                  *( [VideoTask.created_at >= since] if since else [] )))
        samples = db.scalar(select(func.count()).select_from(SampleOrder)
                            .where(SampleOrder.cooperation_id.in_(coop_ids or [0]),
                                   *( [SampleOrder.created_at >= since] if since else [] )))
        out.append({"bd_id": bd.id, "bd_name": bd.display_name,
                    "influencer_total": len(inf_ids), "influencer_new": new_inf,
                    "sample_count": samples, "video_count": videos, "gmv": float(gmv)})
    return out


@router.get("/by-product")
def by_product(days: int | None = 30, admin: User = Depends(current_admin),
               db: Session = Depends(get_db)):
    since = _range(days)
    rows = db.execute(
        select(OrderRecord.product_id,
               func.count(func.distinct(OrderRecord.influencer_id)),
               func.coalesce(func.sum(OrderRecord.amount), 0))
        .where(*( [OrderRecord.order_date >= since] if since else [] ))
        .group_by(OrderRecord.product_id)
    ).all()
    return [{"product_id": pid, "influencer_count": cnt, "gmv": float(gmv)}
            for pid, cnt, gmv in rows]


@router.get("/by-tier")
def by_tier(admin: User = Depends(current_admin), db: Session = Depends(get_db)):
    """解决'佣金5%的达人有多少我感知不到':当前档位分布"""
    rows = db.execute(select(Influencer.commission_tier, func.count())
                      .group_by(Influencer.commission_tier)).all()
    levels_ = db.execute(select(Influencer.level, func.count())
                         .group_by(Influencer.level)).all()
    return {"by_commission": [{"tier": float(t), "count": c} for t, c in rows],
            "by_level": [{"level": l, "count": c} for l, c in levels_]}
