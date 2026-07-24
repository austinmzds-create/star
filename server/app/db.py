import logging

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings

logger = logging.getLogger(__name__)

engine = create_engine(settings.database_url, echo=settings.sql_echo, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def ensure_columns() -> None:
    """轻量自动迁移(仅新增列):对比模型与实表,缺失列即 ALTER ADD COLUMN。

    骨架阶段用 create_all 建表,但它不会给已存在的表补列。此函数跨库(PostgreSQL/SQLite)
    补齐新增的可空列,避免迭代加字段后线上库缺列报错。生产正式版应切 Alembic。
    只做加法:不改类型、不删列、不加约束,新增列一律按可空处理(不影响历史行)。
    """
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue  # 新表交给 create_all
            have = {c["name"] for c in inspector.get_columns(table.name)}
            for col in table.columns:
                if col.name in have:
                    continue
                ddl_type = col.type.compile(dialect=engine.dialect)
                conn.execute(text(
                    f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {ddl_type}'
                ))
                logger.info("[auto-migrate] %s.%s 已补列 (%s)", table.name, col.name, ddl_type)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
