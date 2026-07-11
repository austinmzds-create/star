# star — 达人管理平台

给牙膏品类抖音商家的「达人全生命周期管理」小平台:达人录入建档 → 人工定级(定佣金/寄样策略)→ 商务分工维护 → 寄样物流自动跟踪 → 产品素材自助获取 → 管理员总览产出。替代微信 + Excel。

- 设计文档:`docs/`(01 样例平台Review / 02 需求梳理 / 03 共创方案 **v0.3 已冻结**)
- 达人 H5 域名:`task.jisheng.yun`

## 结构

```
server/   FastAPI + SQLAlchemy(PostgreSQL/Redis/阿里云OSS)
web/      Vue 3 + Element Plus(内部端 + /h5 达人端)
docs/     方案与评审文档
```

## 本地启动

```bash
# 后端(默认 sqlite,零依赖直接跑;生产配 server/.env 切 PostgreSQL)
cd server
pip install -r requirements.txt
uvicorn app.main:app --reload          # http://localhost:8000/docs
# 初始管理员:admin / admin123(首次启动自动创建,请立即修改)

# 前端
cd web
npm install
npm run dev                            # http://localhost:5173,/api 已代理到 8000
```

或 `docker-compose up`(Postgres + Redis + API)。

## 功能模块

内部端(管理员/商务):达人库(智能录入/定级/标签/转移)、寄样管理(审批/发货/物流)、催拍待办、视频与投流(feed 审核 + 投流状态机)、产品中心(五类素材)、卡审知识库、总览看板、配置中心。
达人端 H5(`task.jisheng.yun`):短信验证进入、自助提交资料、查看/下载产品素材、拍摄前必读(卡审知识库)。

## 关键设计

- **快照语义**:等级→佣金等权益是版本化配置(`level_benefit_configs`);合作/寄样/投流记录创建时把当时数值写进 `*_snapshot` 字段,改配置只影响新数据,历史不回溯。
- **组织归属**:达人归属商务(`owner_bd_id`),商务只见自己的达人;管理员全量+转移+总览看板。
- **智能录入**:正则(确定性字段)+ 客户智能体平台 LLM(非结构化字段)双通道解析,低置信度字段前端标黄人工确认;UID/抖音号/手机号撞库识别老达人。
- **物流**:快递100 订阅式(Provider 抽象,可切快递鸟),签收回调触发催拍计时(默认7天,可配)。
- **外部集成全部走适配器**:快递100 / 阿里云短信 / 智能体LLM / 巨量引擎(千川绑定 spike)。
