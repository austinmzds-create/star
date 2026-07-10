import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from .api import admin_config, auth, dashboard, h5, influencers, products, samples
from .config import settings
from .db import Base, SessionLocal, engine
from .models import RejectReason, User
from .security import hash_password
from .services import levels

logging.basicConfig(level=logging.INFO)

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", settings.h5_base_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (auth.router, influencers.router, samples.router, samples.webhook_router,
          products.router, dashboard.router, h5.router, admin_config.router):
    app.include_router(r)

# 拒绝理由库初始数据(采自样例平台,docs/01 §2.1)
SEED_REASONS = [
    "资质未达标,暂不寄样",
    "账号月销售额等级暂不符合寄样标准",
    "账号拍摄与视频质量暂不符合寄样标准",
    "账号仅支持桌拍,暂不符合口播类寄样要求",
    "账号已对接商家其他商务,请与原合作商务对接寄样事宜",
    "需完成之前合作产品的视频或出单目标,方可继续合作",
]


@app.on_event("startup")
def startup():
    # 骨架阶段用 create_all;上生产前切 alembic 迁移
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        levels.seed_defaults(db)  # L1/L2/L3 → 5/6/7(可在配置中心改)
        if not db.scalars(select(User).where(User.role == "admin")).first():
            db.add(User(username="admin", password_hash=hash_password("admin123"),
                        display_name="管理员", role="admin"))
        if not db.scalars(select(RejectReason)).first():
            for text in SEED_REASONS:
                db.add(RejectReason(text=text, scene="sample"))
        db.commit()


@app.get("/api/health")
def health():
    return {"ok": True, "app": settings.app_name}
