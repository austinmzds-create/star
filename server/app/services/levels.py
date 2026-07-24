"""等级权益:动态配置 + 快照语义的唯一实现入口。

规则(docs/03 §4):
- 生效配置 = 该等级 version 最大的一行;改配置 = 插入新版本,不改旧行。
- 业务记录创建时调用 snapshot_for() 把数值固化进记录,历史永不回溯。
"""
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Cooperation, Influencer, LevelBenefitConfig

DEFAULTS = {  # 首次启动 seed 用(会议共识:5/6/7)
    "L1": dict(commission_tier=Decimal("5"), max_sample_products=1, video_audit_required=True),
    "L2": dict(commission_tier=Decimal("6"), max_sample_products=2, video_audit_required=True),
    "L3": dict(commission_tier=Decimal("7"), max_sample_products=0, video_audit_required=False),  # 0=全品类
}


def effective_config(db: Session, level: str) -> LevelBenefitConfig | None:
    return db.scalars(
        select(LevelBenefitConfig)
        .where(LevelBenefitConfig.level == level)
        .order_by(LevelBenefitConfig.version.desc())
        .limit(1)
    ).first()


def seed_defaults(db: Session) -> None:
    for level, cfg in DEFAULTS.items():
        if effective_config(db, level) is None:
            db.add(LevelBenefitConfig(level=level, version=1, **cfg))
    db.commit()


def update_config(db: Session, level: str, updated_by: int, **fields) -> LevelBenefitConfig:
    """改配置 = 插入新版本(只影响之后创建的业务记录)"""
    cur = effective_config(db, level)
    base = dict(
        commission_tier=cur.commission_tier,
        max_sample_products=cur.max_sample_products,
        video_audit_required=cur.video_audit_required,
    ) if cur else dict(DEFAULTS[level])
    base.update({k: v for k, v in fields.items() if v is not None})
    row = LevelBenefitConfig(level=level, version=(cur.version + 1 if cur else 1),
                             created_by=updated_by, **base)
    db.add(row)
    db.commit()
    return row


def new_cooperation(db: Session, influencer: Influencer) -> Cooperation:
    """开一轮新合作:round_no 自增 + 写入快照"""
    round_no = len(influencer.cooperations) + 1
    coop = Cooperation(
        influencer_id=influencer.id,
        round_no=round_no,
        level_snapshot=influencer.level,
        commission_tier_snapshot=influencer.commission_tier,
        promo_mode_snapshot=influencer.promo_mode,
    )
    db.add(coop)
    db.commit()
    return coop
