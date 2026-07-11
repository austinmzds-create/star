"""管理员总览(A3):按商务 / 按产品 / 按佣金档,时间可筛,数字可下钻。"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_admin, current_user
from ..models import (Cooperation, FollowUpTask, Influencer, OrderRecord,
                      Promotion, SampleOrder, User, VideoTask)

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _range(days: int | None):
    return datetime.now() - timedelta(days=days) if days else None


@router.get("/workbench")
def workbench(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """工作台:今日待办 + 数据速览(商务只看自己达人,管理员全量)"""
    is_admin = user.role == "admin"
    # 我的达人范围
    inf_stmt = select(Influencer.id)
    if not is_admin:
        inf_stmt = inf_stmt.where(Influencer.owner_bd_id == user.id)
    inf_ids = db.scalars(inf_stmt).all() or [0]
    coop_ids = db.scalars(select(Cooperation.id)
                          .where(Cooperation.influencer_id.in_(inf_ids))).all() or [0]

    def cnt(model, *conds):
        return db.scalar(select(func.count()).select_from(model).where(*conds)) or 0

    pending_video = cnt(VideoTask, VideoTask.cooperation_id.in_(coop_ids),
                        VideoTask.status == "submitted")
    to_ship = cnt(SampleOrder, SampleOrder.cooperation_id.in_(coop_ids),
                  SampleOrder.status == "approved")
    pending_sample = cnt(SampleOrder, SampleOrder.cooperation_id.in_(coop_ids),
                         SampleOrder.status == "pending")
    followup = db.scalar(select(func.count()).select_from(FollowUpTask)
                         .where(FollowUpTask.status == "open",
                                *([] if is_admin else [FollowUpTask.assignee_bd_id == user.id]))) or 0
    video_ids = db.scalars(select(VideoTask.id)
                           .where(VideoTask.cooperation_id.in_(coop_ids))).all() or [0]
    pending_promo = cnt(Promotion, Promotion.video_task_id.in_(video_ids),
                        Promotion.auth_status.in_(["pending_request", "pending_confirm"]))

    week = datetime.now() - timedelta(days=7)
    inf_total = 0 if inf_ids == [0] else len(inf_ids)
    week_new = cnt(Influencer, Influencer.id.in_(inf_ids), Influencer.created_at >= week)
    week_gmv = db.scalar(select(func.coalesce(func.sum(OrderRecord.amount), 0))
                         .where(OrderRecord.influencer_id.in_(inf_ids),
                                OrderRecord.order_date >= week)) or 0

    return {
        "todos": {
            "pending_sample": pending_sample, "to_ship": to_ship,
            "pending_video": pending_video, "followup": followup,
            "pending_promotion": pending_promo,
        },
        "stats": {
            "influencer_total": inf_total, "week_new": week_new,
            "week_gmv": float(week_gmv),
        },
    }


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
