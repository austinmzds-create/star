from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Influencer, User
from ..security import assign_default_password_if_missing


def seed_missing_passwords(db: Session) -> int:
    accounts = [
        *db.scalars(
            select(User).where(
                User.phone.is_not(None),
                User.password_hash.is_(None),
            )
        ),
        *db.scalars(
            select(Influencer).where(
                Influencer.phone.is_not(None),
                Influencer.password_hash.is_(None),
            )
        ),
    ]
    changed = sum(assign_default_password_if_missing(account) for account in accounts)
    if changed:
        db.commit()
    return changed
