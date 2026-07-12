"""数据模型(对应 docs/03 §6,含两个关键设计):

1. 快照语义:等级→权益是可版本化配置(LevelBenefitConfig);业务记录
   (Cooperation/SampleOrder/Promotion)创建时把当时生效的数值写进 *_snapshot
   字段,之后改配置不回溯历史。
2. 组织归属:达人归属商务(owner_bd_id),商务只见自己的达人,管理员全量+转移。
"""
from datetime import datetime

from sqlalchemy import (JSON, Boolean, DateTime, ForeignKey, Integer, Numeric,
                        String, Text, UniqueConstraint)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def now() -> datetime:
    return datetime.now()


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


# ---------- 组织 ----------

class User(Base, TimestampMixin):
    """内部账号:管理员 / 商务(统一手机验证码登录,角色由后台决定)"""
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    phone: Mapped[str | None] = mapped_column(String(20), unique=True, index=True)  # 登录标识
    username: Mapped[str | None] = mapped_column(String(64), unique=True)  # 兼容旧账号密码登录
    password_hash: Mapped[str | None] = mapped_column(String(128))         # 手机号加的商务可空
    display_name: Mapped[str] = mapped_column(String(64))
    role: Mapped[str] = mapped_column(String(16), default="bd")  # admin / bd
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


# ---------- 达人 ----------

class Influencer(Base, TimestampMixin):
    __tablename__ = "influencers"

    id: Mapped[int] = mapped_column(primary_key=True)
    douyin_id: Mapped[str | None] = mapped_column(String(64), index=True)      # 抖音号
    douyin_uid: Mapped[str | None] = mapped_column(String(64), index=True)     # UID(千川/百应绑定用)
    douyin_sec_uid: Mapped[str | None] = mapped_column(String(128))
    nickname: Mapped[str] = mapped_column(String(128))
    homepage_url: Mapped[str | None] = mapped_column(String(512))
    real_name: Mapped[str | None] = mapped_column(String(64))       # 敏感:仅管理员/归属商务可见
    phone: Mapped[str | None] = mapped_column(String(20), index=True)  # 敏感,同上;也是 H5 登录标识
    fans_count: Mapped[int | None] = mapped_column(Integer)
    gmv_30d: Mapped[int | None] = mapped_column(Integer)            # 人工填,蝉妈妈接入后自动
    category_tags: Mapped[list | None] = mapped_column(JSON)        # 内容品类,如 ["母婴","儿童"]
    shoot_type: Mapped[str | None] = mapped_column(String(16))      # 口播 / 桌拍
    source: Mapped[str] = mapped_column(String(16), default="bd")   # bd商务开发 / h5自来 / import迁移
    raw_intro: Mapped[str | None] = mapped_column(Text)             # 粘贴的原始自我介绍(留档溯源)

    level: Mapped[str] = mapped_column(String(4), default="L1")     # L1/L2/L3,商务人工定,调级留痕
    commission_tier: Mapped[Numeric] = mapped_column(Numeric(5, 2), default=5)  # 当前佣金档(默认随等级带出,可单独覆盖)
    promo_mode: Mapped[str] = mapped_column(String(16), default="merchant")     # merchant商家投流 / self达人自投

    owner_bd_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    owner_bd: Mapped[User | None] = relationship()
    tags: Mapped[list | None] = mapped_column(JSON)                 # 自定义标签
    cooperation_code: Mapped[str | None] = mapped_column(String(64), index=True)  # 合作码(百应/团长绑定用)
    default_address: Mapped[str | None] = mapped_column(String(255))              # 默认收货地址(敏感,同 real_name/phone 权限)
    homepage_raw: Mapped[str | None] = mapped_column(String(512))                 # 主页分享原文(无真实 http 链接时存原文备查)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)                 # 停用(软下架):默认从列表隐藏,不影响历史记录

    cooperations: Mapped[list["Cooperation"]] = relationship(back_populates="influencer")


class LevelChangeLog(Base):
    """调级/调档留痕:谁、何时、从什么调到什么、为什么"""
    __tablename__ = "level_change_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    influencer_id: Mapped[int] = mapped_column(ForeignKey("influencers.id"), index=True)
    field: Mapped[str] = mapped_column(String(32))  # level / commission_tier / owner_bd_id / promo_mode
    old_value: Mapped[str | None] = mapped_column(String(64))
    new_value: Mapped[str] = mapped_column(String(64))
    reason: Mapped[str | None] = mapped_column(String(255))
    changed_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    changed_at: Mapped[datetime] = mapped_column(DateTime, default=now)


# ---------- 配置(动态可改,只影响新数据) ----------

class LevelBenefitConfig(Base):
    """等级→权益配置,带版本:改配置=插入新版本行,旧版本保留可追溯。
    任何时刻某等级的生效配置 = 该等级 version 最大的一行。"""
    __tablename__ = "level_benefit_configs"
    __table_args__ = (UniqueConstraint("level", "version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    level: Mapped[str] = mapped_column(String(4))                    # L1/L2/L3
    version: Mapped[int] = mapped_column(Integer, default=1)
    commission_tier: Mapped[Numeric] = mapped_column(Numeric(5, 2))  # 默认佣金档
    max_sample_products: Mapped[int] = mapped_column(Integer)        # 默认可寄品数(0=全品类)
    video_audit_required: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    effective_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class SystemConfig(Base):
    """杂项配置:催拍天数(follow_up_days=7)、佣金档位列表等,key-value"""
    __tablename__ = "system_configs"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


# ---------- 合作与寄样 ----------

class Cooperation(Base, TimestampMixin):
    """一轮合作(第 N 次)。创建时快照当时的等级/佣金档。"""
    __tablename__ = "cooperations"

    id: Mapped[int] = mapped_column(primary_key=True)
    influencer_id: Mapped[int] = mapped_column(ForeignKey("influencers.id"), index=True)
    round_no: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(16), default="active")  # active / done / dropped
    # —— 快照字段:创建后不随配置/达人变化 ——
    level_snapshot: Mapped[str] = mapped_column(String(4))
    commission_tier_snapshot: Mapped[Numeric] = mapped_column(Numeric(5, 2))
    promo_mode_snapshot: Mapped[str] = mapped_column(String(16))

    influencer: Mapped[Influencer] = relationship(back_populates="cooperations")


class SampleOrder(Base, TimestampMixin):
    __tablename__ = "sample_orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    cooperation_id: Mapped[int] = mapped_column(ForeignKey("cooperations.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    # pending待审批 / approved已通过 / rejected已拒绝 / shipped已发货 / in_transit在途 / signed已签收
    reject_reason: Mapped[str | None] = mapped_column(String(255))   # 从拒绝理由库选或自定义
    address_snapshot: Mapped[dict | None] = mapped_column(JSON)      # 收货信息快照
    tracking_no: Mapped[str | None] = mapped_column(String(64), index=True)
    courier_company: Mapped[str | None] = mapped_column(String(32))  # 快递100单号识别结果
    logistics_status: Mapped[dict | None] = mapped_column(JSON)      # 快递100回调的最新轨迹
    signed_at: Mapped[datetime | None] = mapped_column(DateTime)     # 签收时间(催拍计时起点)
    followed_up: Mapped[bool] = mapped_column(Boolean, default=False)  # 已生成催拍待办
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))


class RejectReason(Base):
    """拒绝理由库(借鉴样例平台,管理员维护)"""
    __tablename__ = "reject_reasons"

    id: Mapped[int] = mapped_column(primary_key=True)
    text: Mapped[str] = mapped_column(String(255))
    scene: Mapped[str] = mapped_column(String(16), default="sample")  # sample寄样 / video视频
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


# ---------- 产品与素材 ----------

class Product(Base, TimestampMixin):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    price_text: Mapped[str | None] = mapped_column(String(32))
    shop_name: Mapped[str | None] = mapped_column(String(128))
    shop_product_id: Mapped[str | None] = mapped_column(String(64))  # 抖店商品ID
    link: Mapped[str | None] = mapped_column(String(512))
    default_commission: Mapped[Numeric | None] = mapped_column(Numeric(5, 2))
    status: Mapped[str] = mapped_column(String(16), default="on")    # on上架 / off下架
    selling_points: Mapped[str | None] = mapped_column(Text)         # 卖点文案
    shooting_notes: Mapped[str | None] = mapped_column(Text)         # 拍摄要求
    product_image: Mapped[str | None] = mapped_column(String(512))   # 主图(封面)URL/oss_key
    product_images: Mapped[list | None] = mapped_column(JSON)         # 商品图集(oss_key 数组,首张即封面)
    sample_remark: Mapped[str | None] = mapped_column(Text)          # 寄样备注(借鉴样例)
    promo_remark: Mapped[str | None] = mapped_column(Text)           # 带货备注
    auto_audit_type: Mapped[str] = mapped_column(String(16), default="must")  # must必审/none不需审/auto1830 18:30自动通过
    allow_promotion: Mapped[bool] = mapped_column(Boolean, default=True)      # 是否允许带货

    materials: Mapped[list["Material"]] = relationship(back_populates="product")


class Material(Base, TimestampMixin):
    __tablename__ = "materials"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    type: Mapped[str] = mapped_column(String(16))
    # video_ai AI生成视频 / video_hot 爆款参考 / video_output 达人成片 / image 图片 / pdf 质检报告 / copy 文案
    title: Mapped[str | None] = mapped_column(String(255))
    oss_key: Mapped[str | None] = mapped_column(String(512))         # OSS 文件
    source_link: Mapped[str | None] = mapped_column(String(512))     # 爆款原始抖音链接
    parsed_text: Mapped[str | None] = mapped_column(Text)            # 爆款解析出的文案
    report_id: Mapped[str | None] = mapped_column(String(64))        # 质检报告ID(挂视频下方用)
    downloadable: Mapped[bool] = mapped_column(Boolean, default=True)
    starred: Mapped[bool] = mapped_column(Boolean, default=False)

    product: Mapped[Product] = relationship(back_populates="materials")


class AccessGrant(Base):
    """达人 × 产品 开放权限(等级默认之外的单独授权)"""
    __tablename__ = "access_grants"
    __table_args__ = (UniqueConstraint("influencer_id", "product_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    influencer_id: Mapped[int] = mapped_column(ForeignKey("influencers.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    granted_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    granted_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class MaterialDownloadLog(Base):
    """达人下载留痕"""
    __tablename__ = "material_download_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id"), index=True)
    influencer_id: Mapped[int] = mapped_column(ForeignKey("influencers.id"), index=True)
    downloaded_at: Mapped[datetime] = mapped_column(DateTime, default=now)


# ---------- 视频 / 投流 / 出单(P0 出单登记,视频投流 P1 启用) ----------

class VideoTask(Base, TimestampMixin):
    __tablename__ = "video_tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    cooperation_id: Mapped[int] = mapped_column(ForeignKey("cooperations.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    dy_url: Mapped[str | None] = mapped_column(String(512))
    saved_oss_key: Mapped[str | None] = mapped_column(String(512))   # 转存(防链接失效/投流留证)
    status: Mapped[str] = mapped_column(String(16), default="submitted")
    # submitted / approved / rejected / blocked卡审
    audit_result: Mapped[dict | None] = mapped_column(JSON)          # 时间点评论等(P1)
    blocked: Mapped[bool] = mapped_column(Boolean, default=False)


class Promotion(Base, TimestampMixin):
    """投流状态机(P1 启用;千川 spike 结果决定是否 API 自动化)"""
    __tablename__ = "promotions"

    id: Mapped[int] = mapped_column(primary_key=True)
    video_task_id: Mapped[int] = mapped_column(ForeignKey("video_tasks.id"), index=True)
    mode_snapshot: Mapped[str] = mapped_column(String(16))           # 快照:商家投/自投
    auth_status: Mapped[str] = mapped_column(String(24), default="pending_request")
    # pending_request待发起授权 / pending_confirm待达人确认 / authorized已授权
    # promoted已投流 / failed投流失败 / done完成 / refused达人拒绝
    fail_proof_oss_key: Mapped[str | None] = mapped_column(String(512))
    fail_reason: Mapped[str | None] = mapped_column(String(255))
    days: Mapped[int | None] = mapped_column(Integer)                # 千川合作天数


class OrderRecord(Base, TimestampMixin):
    """出单登记(已拍板:蝉妈妈接入前人工登记,看板 GMV 数据源)"""
    __tablename__ = "order_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    influencer_id: Mapped[int] = mapped_column(ForeignKey("influencers.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    order_date: Mapped[datetime] = mapped_column(DateTime, index=True)
    amount: Mapped[Numeric] = mapped_column(Numeric(12, 2))          # 出单金额(GMV)
    note: Mapped[str | None] = mapped_column(String(255))
    recorded_by: Mapped[int] = mapped_column(ForeignKey("users.id"))


# ---------- 卡审知识库(P1) ----------

class BlockRecord(Base, TimestampMixin):
    __tablename__ = "block_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"))
    video_task_id: Mapped[int | None] = mapped_column(ForeignKey("video_tasks.id"))
    influencer_id: Mapped[int | None] = mapped_column(ForeignKey("influencers.id"))  # 关联达人(选填)
    screenshot_oss_key: Mapped[str | None] = mapped_column(String(512))  # 兼容旧单图
    screenshots: Mapped[list | None] = mapped_column(JSON)           # 多张截图 oss_key 数组
    video_url: Mapped[str | None] = mapped_column(String(512))       # 违规视频链接/转存
    text: Mapped[str | None] = mapped_column(Text)
    tag: Mapped[str | None] = mapped_column(String(64))              # 违规类型
    starred: Mapped[bool] = mapped_column(Boolean, default=False)
    happened_at: Mapped[datetime] = mapped_column(DateTime, default=now)


# ---------- 达人 H5 会话 ----------

class FollowUpTask(Base):
    """催拍待办:签收满 N 天(默认7,可配)无视频 → 系统生成,派给归属商务。"""
    __tablename__ = "follow_up_tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    sample_order_id: Mapped[int] = mapped_column(ForeignKey("sample_orders.id"), index=True)
    influencer_id: Mapped[int] = mapped_column(ForeignKey("influencers.id"), index=True)
    assignee_bd_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(24), default="follow_up_shoot")  # 催拍
    note: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(16), default="open")  # open / done
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    done_at: Mapped[datetime | None] = mapped_column(DateTime)


class SmsCode(Base):
    __tablename__ = "sms_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    phone: Mapped[str] = mapped_column(String(20), index=True)
    code: Mapped[str] = mapped_column(String(8))
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0)          # 校验失败次数,超限作废
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)  # 发送频控用
