"""签收催拍扫描:已签收满 N 天(SystemConfig.follow_up_days,默认7)且该轮合作
无视频记录、又未生成过待办的寄样单 → 生成一条催拍待办派给归属商务。

设计为幂等:重复运行不会重复建待办(靠 SampleOrder.followed_up 标记)。
生产接 APScheduler/RQ 每日定时;当前提供函数 + 管理员手动触发端点。
"""
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (Cooperation, FollowUpTask, Influencer, SampleOrder,
                      SystemConfig, VideoTask)

DEFAULT_DAYS = 7


def follow_up_days(db: Session) -> int:
    cfg = db.get(SystemConfig, "follow_up_days")
    if cfg and isinstance(cfg.value, dict):
        return int(cfg.value.get("days", DEFAULT_DAYS))
    return DEFAULT_DAYS


def scan(db: Session) -> int:
    """返回本次新建的待办数量"""
    days = follow_up_days(db)
    deadline = datetime.now() - timedelta(days=days)
    orders = db.scalars(
        select(SampleOrder).where(
            SampleOrder.status == "signed",
            SampleOrder.signed_at.is_not(None),
            SampleOrder.signed_at <= deadline,
            SampleOrder.followed_up.is_(False),
        )
    ).all()

    created = 0
    for order in orders:
        coop = db.get(Cooperation, order.cooperation_id)
        if not coop:
            continue
        has_video = db.scalar(
            select(VideoTask.id).where(VideoTask.cooperation_id == coop.id).limit(1)
        )
        if has_video:
            order.followed_up = True  # 已产出视频,不用催
            continue
        inf = db.get(Influencer, coop.influencer_id)
        db.add(FollowUpTask(
            sample_order_id=order.id,
            influencer_id=coop.influencer_id,
            assignee_bd_id=inf.owner_bd_id if inf else None,
            note=f"签收满{days}天未见视频,请跟进催拍",
        ))
        order.followed_up = True
        created += 1
    db.commit()
    return created
