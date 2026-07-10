# 部署运维

> **定位**：从零把真实环境跑起来的 runbook；兼说明本地无 Docker 容器时的降级验证方式。
> **读者**：后端工程师、运维。
> **最后更新**：2026-07-10（Phase 2）。
> **关联文档**：[系统架构](./architecture.md) · [数据模型](./data-model.md) · [API 规范](./api-spec.md)

---

## 1. 环境矩阵

| 环境 | Postgres/Redis | docker | 能做什么 |
| --- | --- | --- | --- |
| 本地开发容器（当前 CI 同款） | ❌ 无 | ❌ 无 | `prisma generate` + typecheck + build + 单测（mock/内存实现）；`celestial`/`health` 接口可真跑，登记接口返回 503 |
| 真实开发机 | `infra/docker-compose.yml` 起 | ✅ | 全功能：migrate + seed + api + web 联调 |
| 生产 | 托管 PG / Redis + 阿里云 OSS | 视托管形态 | 全功能 + OSS 证书（Phase 3） |

## 2. 前置要求

- **Node 22**、**pnpm**（版本见根 `package.json` 的 `packageManager`）。
- Docker Compose v2（`docker compose` 子命令），仅真实环境需要。
- 一次性：`pnpm install`（仓库根，装全 workspace）。

## 3. 基础设施：infra/docker-compose.yml

只起两样（OSS 用云上真实服务，不做本地模拟）：

| 服务 | 镜像 | 端口 | 持久化 | healthcheck |
| --- | --- | --- | --- | --- |
| `postgres` | `postgres:16-alpine` | 5432 | volume `pgdata` | `pg_isready -U star -d star_memorial`，5s 间隔 ×10 |
| `redis` | `redis:7-alpine` | 6379 | volume `redisdata` | `redis-cli ping`，5s 间隔 ×10 |

初始库：用户 `star` / 密码 `star_password` / 库名 `star_memorial`（仅本地开发用默认值；
生产一律换强密码并通过环境变量注入）。

```bash
# 启动（仓库根执行）
docker compose -f infra/docker-compose.yml up -d
# 等待就绪
docker compose -f infra/docker-compose.yml ps   # 两个服务 healthy 即可
# 停止（保数据）
docker compose -f infra/docker-compose.yml down
# 数据重置（连 volume 一起删，慎用）
docker compose -f infra/docker-compose.yml down -v
```

## 4. 环境变量

### 4.1 全量清单

样例文件：根 `.env.example`、`services/api/.env.example`、`apps/web/.env.example`。

| 变量 | 消费方 | 说明 |
| --- | --- | --- |
| `PORT` | api | HTTP 端口，默认 `3001`（web 占 3000） |
| `WEB_ORIGIN` | api | CORS 允许来源，逗号分隔，如 `http://localhost:3000`；未配置则放开（仅限开发） |
| `DATABASE_URL` | api | Postgres 连接串，如 `postgresql://star:star_password@localhost:5432/star_memorial?schema=public` |
| `REDIS_URL` | api | 可选。**未配置时 Redis 能力整体优雅降级**（health 上报 `skipped`），api 照常启动 |
| `OSS_REGION` / `OSS_BUCKET` / `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` | api | 见 §4.2 |
| `NEXT_PUBLIC_API_BASE_URL` | web（会内联进客户端 bundle） | api 基址。**留空 = 纯前端演示模式**（命名弹窗本地出编号、`/m/[slug]` 渲染降级页） |
| `API_BASE_URL` | web（仅 SSR） | 可选，服务端组件专用内网基址（容器编排里如 `http://api:3001`），优先于上者 |

> **基址书写规则**：web 客户端（`apps/web/src/lib/api.ts`）请求路径自带 `/api/` 前缀，
> 因此基址**只写到主机端口**（如 `http://localhost:3001`），不要带 `/api` 后缀，否则会拼出 `/api/api/…`。

### 4.2 OSS 四项 = 占位配置

- 本期代码**只读取配置、不强依赖**：四项缺省时，证书上传路径降级为本地 no-op + 日志，
  api 正常启动、全部现有接口不受影响。
- Phase 3 接入证书渲染 worker 后，真实环境填入即启用（bucket 建议私有读 + 签名 URL 下发，
  见 [api-spec.md §3.4](./api-spec.md)）。

### 4.3 密钥管理红线

- 仓库**永不提交**真实密钥：只提交 `.env.example`（占位值），`.env*` 在 `.gitignore` 内。
- 生产密钥走部署平台的 secret 注入；OSS AK 建议用 RAM 子账号最小权限（仅目标 bucket 读写）。

## 5. 数据库初始化

### 5.1 任何环境（含无 DB 的本地容器）

```bash
pnpm --filter @star/api prisma:generate   # 生成 Prisma Client，typecheck/build/test 的前置
```

**本地无 DB 容器到此为止**——不 migrate、不 seed（硬性约束），验证走 §7。

### 5.2 真实环境（有 Postgres）

```bash
# ① 首次：生成迁移文件（开发机，一次性；迁移文件随仓库提交）
pnpm --filter @star/api exec prisma migrate dev --name init
# ② 之后每次发布：只应用已有迁移
pnpm --filter @star/api db:migrate        # = prisma migrate deploy
# ③ 灌入 60 颗精选星（celestial_object + celestial_name_alias，按 objectUid 幂等 upsert）
pnpm --filter @star/api db:seed           # = prisma db seed（tsx prisma/seed.ts）
# ④（Phase 3，可选）星表扩容 ETL 导入 ~5000 亮星，见 docs/data-model.md §8
```

顺序不可乱：**seed 是登记接口的前置**（`memorial_registration.starObjectUid` 外键引用目录表）。

## 6. 应用启动

### 6.1 services/api

```bash
# 开发（watch 模式，自带 prisma generate）
pnpm --filter @star/api dev
# 生产
pnpm --filter @star/api build             # = prisma generate && nest build（webpack 单文件 dist/main.js）
pnpm --filter @star/api start             # = node dist/main.js
# 就绪确认
curl http://localhost:3001/api/health     # deps.db=up / deps.redis=up 即全功能就绪
```

启动依赖顺序：Postgres/Redis healthy → api。api 对依赖是**容错启动**：DB 连不上不 crash
（登记接口 503），Redis 未配置/连不上降级——因此编排上无需硬 `depends_on`，但建议等 healthcheck。

### 6.2 apps/web

```bash
# 开发
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm --filter @star/web dev   # http://localhost:3000
# 生产
pnpm --filter @star/web build && pnpm --filter @star/web start
```

需要的变量仅 `NEXT_PUBLIC_API_BASE_URL`（可选 `API_BASE_URL`，见 §4.1）。
不配置也能跑：整站进入纯前端演示模式。

### 6.3 BullMQ worker 形态（定稿）

**Phase 3 初期与 api 同进程**（NestJS 内注册 BullMQ processor）：部署面最小、
共享 Prisma/配置，证书渲染量级（每单一次）远够。当渲染耗时开始影响 API 延迟或需独立伸缩时，
拆为**同一镜像、不同启动命令**（`node dist/main.js --worker`）的独立进程——代码不动，只改编排。

## 7. 无 DB 环境的验证策略（本地容器 / CI 同策略）

```bash
pnpm install
pnpm --filter @star/api prisma:generate
pnpm typecheck      # 全 workspace 类型检查
pnpm test           # astro-core / astro-data / api（api 单测全部 mock PrismaService，零外部依赖）
pnpm --filter @star/api build
pnpm --filter @star/web build
```

以上全绿 = 可合入。运行时行为（登记落库、纪念页）在真实开发机按 §3–§6 联调验证。

## 8. 常见故障排查

| 症状 | 定位 | 处置 |
| --- | --- | --- |
| api 启动日志「数据库连接失败，纪念登记接口将返回 503」 | `DATABASE_URL` 错 / PG 未就绪 | `docker compose ps` 看 healthy；核对连接串；api 无需重启逻辑修复后重启即可 |
| `prisma migrate deploy` 报 P1001 | 网络/端口/凭据 | 先 `psql "$DATABASE_URL" -c 'select 1'` 验通 |
| migrate 报迁移历史冲突（P3005 等） | 库不是由本仓库迁移创建 | 新库重来；或 `prisma migrate resolve` 显式标记基线，**禁止**手工改 `_prisma_migrations` |
| 登记接口 404 `CELESTIAL_NOT_FOUND`（uid 明明存在） | 忘了 seed | 跑 §5.2 ③ |
| health 里 `redis: "down"` | `REDIS_URL` 通不了 | 本期无业务影响（`skipped`/`down` 均可运行）；Phase 3 前修复 |
| OSS 上传 403 | AK 权限/Bucket 策略 | RAM 子账号需目标 bucket `PutObject`；核对 `OSS_REGION` 与 bucket 所在地域一致 |
| `pg_trgm` 建索引报 `operator class "gin_trgm_ops" does not exist` | 扩展未启用 | 超级用户执行 `CREATE EXTENSION pg_trgm;`（Phase 3 搜索 DB 化时才需要） |
| typecheck 报找不到 `@prisma/client` 类型 | 未 generate | `pnpm --filter @star/api prisma:generate` |
| web 请求打到 `/api/api/…` | 基址带了 `/api` 后缀 | 按 §4.1 规则改基址 |

## 9. 升级与回滚

- **镜像钉版本**：compose 里 `postgres:16-alpine` / `redis:7-alpine` 属大版本钉住；
  生产建议进一步钉 minor（如 `postgres:16.4-alpine`），升级走先备份后升级。
- **迁移回滚**：`prisma migrate` 无自动 down——回滚 = 部署旧版应用 + 前滚一条修复迁移
  （forward-fix）。因此破坏性迁移（删列/改类型）必须拆两步发布：先双写/兼容，后清理。
- **应用回滚**：api 为无状态单文件产物，回滚即换旧版本产物重启；
  web 为 Next standalone 产物，同理。数据层不动。
- **备份**：生产 PG 开启每日 `pg_dump` + WAL 归档（托管服务自带则用托管的）；
  Redis 数据本期均可重建（缓存/队列），无需备份承诺。
