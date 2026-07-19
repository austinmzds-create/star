"""当前内部用户的轻量偏好设置。"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user
from ..models import SystemConfig, User

router = APIRouter(prefix="/api/preferences", tags=["preferences"])

INFLUENCER_COLUMNS = {
    "nickname", "douyin_id", "fans_count", "gmv_30d", "data_source",
    "level", "commission_tier", "tags", "owner_bd_name", "round_count",
    "updated_at",
}
ALLOWED_KEYS = {"influencer_columns"}


class PreferenceIn(BaseModel):
    value: dict


def _pref_key(user_id: int, key: str) -> str:
    if key not in ALLOWED_KEYS:
        raise HTTPException(404, "偏好不存在")
    return f"user:{user_id}:{key}"


def _validate(key: str, value: dict) -> dict:
    if key == "influencer_columns":
        columns = value.get("columns")
        if not isinstance(columns, list):
            raise HTTPException(400, "columns 必须是数组")
        seen = []
        for item in columns:
            if not isinstance(item, str) or item not in INFLUENCER_COLUMNS:
                raise HTTPException(400, "存在不支持的列")
            if item not in seen:
                seen.append(item)
        return {"columns": seen}
    return value


@router.get("/{key}")
def get_preference(key: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.get(SystemConfig, _pref_key(user.id, key))
    return {"key": key, "value": row.value if row else None}


@router.put("/{key}")
def set_preference(key: str, body: PreferenceIn,
                   user: User = Depends(current_user), db: Session = Depends(get_db)):
    value = _validate(key, body.value)
    db.merge(SystemConfig(key=_pref_key(user.id, key), value=value, updated_by=user.id))
    db.commit()
    return {"ok": True, "value": value}
