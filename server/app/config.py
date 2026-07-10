"""集中配置:全部通过环境变量注入,见 server/.env.example"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "达人管理平台"
    debug: bool = True
    secret_key: str = "change-me"

    # 本地开发默认 sqlite,生产切 PostgreSQL:postgresql+psycopg://user:pass@host/db
    database_url: str = "sqlite:///./dev.db"
    redis_url: str = "redis://localhost:6379/0"

    # 达人 H5 站点(已拍板:二级域名)
    h5_base_url: str = "https://task.jisheng.yun"

    # 阿里云 OSS
    oss_endpoint: str = ""
    oss_bucket: str = ""
    oss_access_key_id: str = ""
    oss_access_key_secret: str = ""

    # 阿里云短信(达人 H5 手机验证码)
    sms_access_key_id: str = ""
    sms_access_key_secret: str = ""
    sms_sign_name: str = ""
    sms_template_code: str = ""

    # 快递100(已拍板:订阅式轨迹 + 单号识别)
    kd100_key: str = ""
    kd100_customer: str = ""
    kd100_callback_url: str = ""  # 例如 https://task.jisheng.yun/api/webhooks/kd100

    # 客户现有智能体平台(已拍板:达人信息 LLM 解析走这里)
    agent_api_base: str = ""
    agent_api_key: str = ""

    # 巨量引擎开放平台(服务商资质,P0 spike)
    oceanengine_app_id: str = ""
    oceanengine_secret: str = ""


settings = Settings()
