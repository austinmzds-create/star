"""统一操作留痕助手(方案B 阶段1)。

在各业务动作的**同一事务**里调用 log_op(...);不单独 commit,由调用方的
db.commit() 一起落库,保证「动作成功=留痕成功」原子一致。刷新/重启后时间轴、
变更记录都从 OperationLog 恢复。
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ..models import Cooperation, Influencer, OperationLog, User


def _actor_fields(actor) -> tuple[int | None, str | None, str]:
    """把操作人(User / Influencer / None)拆成 (id, 名称快照, 角色)。"""
    if actor is None:
        return None, "系统", "system"
    if isinstance(actor, User):
        return actor.id, actor.display_name, actor.role or "bd"
    if isinstance(actor, Influencer):
        return actor.id, actor.nickname, "influencer"
    # 兜底:传了别的对象,尽量取到能展示的名字
    name = getattr(actor, "display_name", None) or getattr(actor, "nickname", None)
    return getattr(actor, "id", None), name, "system"


def log_op(db: Session, *, influencer_id: int, event_type: str, summary: str,
           actor=None, product_id: int | None = None,
           detail: dict | None = None) -> OperationLog:
    """写一条操作日志(不 commit)。actor 传当前 User/Influencer,系统回调传 None。"""
    actor_id, actor_name, actor_role = _actor_fields(actor)
    entry = OperationLog(
        influencer_id=influencer_id,
        product_id=product_id,
        event_type=event_type,
        actor_id=actor_id,
        actor_name=actor_name,
        actor_role=actor_role,
        summary=summary[:255] if summary else "",
        detail=detail,
    )
    db.add(entry)
    return entry


def influencer_id_for_coop(db: Session, cooperation_id: int) -> int | None:
    """由合作轮次反查达人 id(寄样/视频挂在 cooperation 上,日志需要落到达人)。"""
    coop = db.get(Cooperation, cooperation_id)
    return coop.influencer_id if coop else None
