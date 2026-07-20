import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from .api import (admin_config, auth, block_records, connection_requests,
                  dashboard, followups, h5, influencers, preferences,
                  products, qianchuan, samples, uploads, videos)
from .config import settings
from .db import Base, SessionLocal, engine, ensure_columns
from .models import RejectReason, User
from .security import hash_password
from .services import account_passwords, levels

logging.basicConfig(level=logging.INFO)
logging.getLogger("httpx").setLevel(logging.WARNING)

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", settings.h5_base_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (auth.router, influencers.router, samples.router, samples.webhook_router,
          products.router, qianchuan.router, dashboard.router, h5.router, admin_config.router,
          preferences.router,
          followups.router, uploads.router,
          block_records.router, block_records.h5_router,
          videos.router, videos.promotion_router, connection_requests.router):
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


# 已知的弱/示例密钥:生产(debug=False)拒绝使用,避免 token 被伪造
WEAK_SECRETS = {"", "change-me", "star-dev-please-rotate-in-prod"}


@app.on_event("startup")
def startup():
    # 生产环境(debug=False)必须显式设置足够强的 SECRET_KEY(非默认/示例、≥16 位)
    if not settings.debug and (settings.secret_key in WEAK_SECRETS or len(settings.secret_key) < 16):
        raise RuntimeError("生产环境必须设置足够强的 SECRET_KEY(非默认/示例值,长度≥16)")
    # 生产环境不建议用 SQLite:容器重建即丢数据,且多写(审批/回调/多 worker)会 database is locked。
    if not settings.debug and settings.database_url.startswith("sqlite"):
        logging.getLogger(__name__).warning(
            "[启动告警] 生产环境正在使用 SQLite(%s):数据不持久、并发写会锁。"
            "请将 DATABASE_URL 切换为 PostgreSQL。", settings.database_url)
    # 骨架阶段用 create_all;上生产前切 alembic 迁移
    Base.metadata.create_all(engine)
    ensure_columns()  # 自动补齐已存在表的新增列(create_all 不会 ALTER)
    with SessionLocal() as db:
        levels.seed_defaults(db)  # L1/L2/L3 → 5/6/7(可在配置中心改)
        # 默认管理员(admin/admin123)仅在开发环境种子;生产由 admin_phones 白名单短信登录引导,
        # 避免弱口令随包上线。
        if settings.debug and not db.scalars(select(User).where(User.role == "admin")).first():
            db.add(User(username="admin", password_hash=hash_password("admin123"),
                        display_name="管理员", role="admin"))
        account_passwords.seed_missing_passwords(db)
        if not db.scalars(select(RejectReason)).first():
            for text in SEED_REASONS:
                db.add(RejectReason(text=text, scene="sample"))
        db.commit()


@app.on_event("startup")
async def start_followup_scheduler():
    """催拍待办每日自动扫描(轻量 asyncio 定时,无需额外依赖)。"""
    import asyncio

    from .services import followup

    async def loop():
        while True:
            await asyncio.sleep(24 * 3600)
            try:
                with SessionLocal() as db:
                    n = followup.scan(db)
                    if n:
                        logging.info("[followup] 自动扫描生成 %s 条催拍待办", n)
            except Exception:
                logging.exception("[followup] 扫描失败")

    asyncio.create_task(loop())


@app.get("/api/health")
def health():
    return {"ok": True, "app": settings.app_name}
