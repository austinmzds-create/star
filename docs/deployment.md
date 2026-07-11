# 部署运维

> **定位**：从零把真实环境跑起来的 runbook；兼说明本地无 Docker 容器时的降级验证方式。
> **读者**：后端工程师、运维。
> **最后更新**：2026-07-11（Phase 4 · 小程序构建与部署、订单支付 provider 与环境变量）。
> **关联文档**：[系统架构](./architecture.md) · [数据模型](./data-model.md) · [API 规范](./api-spec.md)

---

## 1. 环境矩阵

| 环境 | Postgres/Redis | docker | 能做什么 |
| --- | --- | --- | --- |
| 本地开发容器（当前 CI 同款） | ❌ 无 | ❌ 无 | `prisma generate` + typecheck + build + 单测（mock/内存实现）；`celestial`/`health`/`agent`（模板兜底）接口可真跑，登记/证书/纪念册/订单/后台接口返回 503。小程序 `pnpm --filter @star/miniapp typecheck` + `project.config.json` 可导入微信开发者工具 |
| 真实开发机 | `infra/docker-compose.yml` 起 | ✅ | 全功能：migrate + seed + api + web 联调；无 OSS 时证书/纪念册走本地磁盘 `/api/assets`、无 Anthropic key 时来信走模板、无支付凭证时订单走 mock provider（`POST …/pay` 测试支付） |
| 生产 | 托管 PG / Redis + 阿里云 OSS + Anthropic Key + 支付商户凭证 | 视托管形态 | 全功能：BullMQ 异步证书/纪念册 → OSS 签名 URL、宇宙来信真调 Claude、审核后台、真实微信/支付宝支付回调 |

> 小程序（`apps/miniapp`）不是常驻服务：产物经微信开发者工具/公众平台上传，运行时只依赖 `api`。本地无微信运行时，验证止于 typecheck + 结构可导入（见 §10）。

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
| `REDIS_URL` | api | 可选。**未配置时 Redis 能力整体优雅降级**（health 上报 `skipped`），api 照常启动；证书改**同步生成** |
| `OSS_REGION` / `OSS_BUCKET` / `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` | api | 阿里云 OSS 四项，见 §4.2 |
| `OSS_ENDPOINT` | api | 可选，自定义域名/内网 endpoint |
| `STORAGE_DRIVER` | api | `auto`（默认：配齐 OSS 用 OSS，否则本地）\| `local` \| `oss` \| `dataurl`。见 §4.2 |
| `STORAGE_LOCAL_DIR` | api | 本地存储根目录（相对 api 运行目录），默认 `.local-storage` |
| `STORAGE_PUBLIC_BASE_URL` | api | 本地资产对外基址（拼 `GET /api/assets/*`），如 `http://localhost:3001` |
| `ASSET_URL_TTL` | api | OSS 签名 URL 有效期（秒），默认 `900`（15 分钟） |
| `ANTHROPIC_API_KEY` | api | 可选。**缺省 → 宇宙来信降级 `TemplateProvider` 模板生成**（绝不崩） |
| `ANTHROPIC_MODEL` | api | 文档占位（代码内硬编码 `claude-sonnet-5`）；创意文案模型名 |
| `ADMIN_API_TOKEN` | api | 后台共享令牌（`x-admin-token` 比对）。**未配置 → 所有 `/api/admin/*` 返回 503 `ADMIN_NOT_ENABLED`** |
| `REVIEW_ALL_FREETEXT` | api | 置 `1` → 含祝福语/故事文本的登记先进 `PENDING_REVIEW` 人工复审；默认 `0`=干净内容自动 `ACTIVE` |
| `PAYMENT_PROVIDER` | api | `mock`（默认，本地/测试）\| `wechat` \| `alipay`。**真实网关凭证未配齐时自动降级 `mock`**（工厂降级，绝不 crash）。见 §4.4 |
| `WXPAY_APP_ID` / `WXPAY_MCHID` / `WXPAY_API_V3_KEY` / `WXPAY_CERT_SERIAL` / `WXPAY_PRIVATE_KEY` / `WXPAY_NOTIFY_URL` | api | 微信支付商户凭证（`PAYMENT_PROVIDER=wechat` 时需齐全，否则降级 mock）。`WXPAY_NOTIFY_URL` 形如 `https://your-domain/api/payments/notify/wechat` |
| `ALIPAY_APP_ID` / `ALIPAY_PRIVATE_KEY` / `ALIPAY_PUBLIC_KEY` / `ALIPAY_NOTIFY_URL` | api | 支付宝凭证（`PAYMENT_PROVIDER=alipay` 时需齐全，否则降级 mock）。`ALIPAY_NOTIFY_URL` 形如 `https://your-domain/api/payments/notify/alipay` |
| `NEXT_PUBLIC_API_BASE_URL` | web（会内联进客户端 bundle） | api 基址。**留空 = 纯前端演示模式**（命名弹窗本地出编号、`/m/[slug]` 渲染降级页） |
| `API_BASE_URL` | web（仅 SSR） | 可选，服务端组件专用内网基址（容器编排里如 `http://api:3001`），优先于上者 |

> **基址书写规则**：web 客户端（`apps/web/src/lib/api.ts`）请求路径自带 `/api/` 前缀，
> 因此基址**只写到主机端口**（如 `http://localhost:3001`），不要带 `/api` 后缀，否则会拼出 `/api/api/…`。

### 4.2 存储驱动与 OSS（StorageService）

证书/星图资产经 `StorageService` 抽象存取，`STORAGE_DRIVER` 选实现（[architecture.md §4.5](./architecture.md)）：

| 驱动 | 触发 | 行为 | `url()` 返回 |
| --- | --- | --- | --- |
| `auto`（默认） | 四项 `OSS_*` 均为有效值 → OSS，否则本地 | 自适应 | 视命中实现而定 |
| `oss` | 显式 | `ali-oss` 懒加载上传（本期不安装依赖，配置激活前不加载） | **短时签名 URL**（`ASSET_URL_TTL`） |
| `local` | 显式 / auto 未配 OSS | 写 `STORAGE_LOCAL_DIR`，由 `AssetController` 经 `/api/assets/*` 流式服务 | `STORAGE_PUBLIC_BASE_URL` + `/api/assets/<key>` |
| `dataurl` | 显式 / 本地写盘失败兜底 | 不落盘，内联 base64 | `data:` URI |

- 生产建议 OSS bucket **私有读 + 签名 URL 下发**；RAM 子账号最小权限（仅目标 bucket 读写），见 §4.3。
- 本地/真实开发机无 OSS 时用 `local`（或 `auto` 自动落本地），证书功能完整可用，仅 URL 为 `/api/assets` 直链。
- `ali-oss` 为**可选运行时依赖**（`eval('require')` 懒加载，规避 webpack 静态分析）：本期未安装，
  仅当真实启用 OSS 时按需 `pnpm add ali-oss`。

### 4.3 密钥管理红线

- 仓库**永不提交**真实密钥：只提交 `.env.example`（占位值），`.env*` 在 `.gitignore` 内。
- 生产密钥走部署平台的 secret 注入；OSS AK 建议用 RAM 子账号最小权限（仅目标 bucket 读写）。
- 支付商户私钥（`WXPAY_PRIVATE_KEY`/`ALIPAY_PRIVATE_KEY`）同走 secret 注入，绝不入库。

### 4.4 支付 provider 选型（PaymentProvider）

订单支付经 `PaymentProvider` 抽象（DI token `PAYMENT_PROVIDER`），`payment-provider.factory.ts` 按
`PAYMENT_PROVIDER` env 选实现（照抄 `llm/provider.factory` 与 `storageFactory` 的工厂降级模式）：

| `PAYMENT_PROVIDER` | 触发 | 行为 |
| --- | --- | --- |
| `mock`（默认） | 未配 / 显式 | `MockPaymentProvider`：`create` 返回 `payUrl`，`POST /api/orders/:orderNo/pay` 完成测试支付；`providerTxnId=MOCKTXN-<orderNo>` 可复现 |
| `wechat` | 显式且 `WXPAY_*` 齐全（`active`） | 微信支付 provider（骨架）；凭证缺失 → **降级 mock**（warn 不 crash） |
| `alipay` | 显式且 `ALIPAY_*` 齐全（`active`） | 支付宝 provider（骨架）；凭证缺失 → **降级 mock** |

- **本期真实网关未接入**：wechat/alipay 段的 `verifyNotify` 骨架期直接抛（`PAYMENT_VERIFY_FAILED`）；
  接入时补验签实现即可，控制器/状态机不动。
- **真实微信支付需 raw body 验签**：生产须在 `main.ts` 配置 rawBody 中间件（本期 mock JSON 足够）。
- 回调地址：`WXPAY_NOTIFY_URL`/`ALIPAY_NOTIFY_URL` 指向 `POST /api/payments/notify/{wechat|alipay}`，须公网可达且与 provider 段一致。

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

> **Phase 4 迁移**：schema 已加 `couple_group`、`album_record` 两张新表、`memorial_registration` 的
> `coupleGroupId`/`coupleRole` 两列 + `@@unique([coupleGroupId, coupleRole])`、`order` 的
> `provider`/`providerTxnId`/`subject`/`payMeta` 四列 + `[provider,status]` 索引、`enum OrderStatus` 加 `FAILED`、
> 新枚举 `CoupleRole`。本地只 `prisma generate`；真实环境 `prisma migrate dev --name phase4` 生成并应用一条迁移。

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

**与 api 同进程**（有 `REDIS_URL` 时 `CertificateModule` 条件挂载 BullMQ processor）：部署面最小、
共享 Prisma/配置，证书渲染量级（每单一次）远够。当渲染耗时开始影响 API 延迟或需独立伸缩时，
拆为**同一镜像、不同启动命令**（`node dist/main.js --worker`）的独立进程——代码不动，只改编排。
**无 `REDIS_URL` 时无 worker**：证书由 API 请求线程同步生成（见 [architecture.md §4.3](./architecture.md)）。

### 6.4 证书 / 队列 / Agent / 后台运维

- **证书生成**：`POST /api/memorial/registrations/:no/certificate` 触发（幂等），`GET` 同路径查状态。
  有 Redis → 返回 `202 GENERATING`、worker 异步出图；无 Redis → 请求内同步出图、直接 `READY`。
  资产 key 形如 `certificates/YYYY/MM/<regNo>-v1.{svg|png}`、`starmaps/...`。`sharp` 不可用则只出 SVG（`assetFormat=svg`）。
- **依赖安装**：Phase 3 新增 `@nestjs/bullmq` + `bullmq`（队列）、`@anthropic-ai/sdk`（宇宙来信）；
  `sharp` 为**可选**（`optionalDependencies` / `onlyBuiltDependencies`，缺失自动降级 SVG）；
  `ali-oss` 仅启用 OSS 时按需装（§4.2）。这些依赖由后端在 `pnpm install` 时落地，其余环节不新增依赖。
- **Agent 宇宙来信**：`POST /api/agent/skills/cosmic-letter/run`。配 `ANTHROPIC_API_KEY` → 真调 `claude-sonnet-5`；
  缺省或调用失败 → 模板兜底（`mode:'template'`）。DB 可用则落 `agent_task`（含 `modelName`/`durationMs`），
  DB 不可用仍返回来信（`taskNo:'unpersisted'`）。成本以 `maxTokens` + 无 key 零成本兜底约束。
- **审核后台**：所有 `/api/admin/*` 需请求头 `x-admin-token`。**生产必须配 `ADMIN_API_TOKEN`**（否则整段 503），
  用足够长的随机串、走 secret 注入。日常审核：`GET /api/admin/registrations?status=PENDING_REVIEW` → `approve`/`reject`。
  可选 `REVIEW_ALL_FREETEXT=1` 令所有含自由文本的登记先进人工复审队列。
- **纪念册**：`POST /api/memorial/registrations/:no/album` 触发（幂等），`GET` 同路径查状态。与证书同构——有 Redis
  走 BullMQ（队列 `album`）异步、无 Redis 同步出图；资产 key 形如 `albums/YYYY/MM/<regNo>-v1/album.svg`。`letter` 页调
  `cosmic-letter` skill，失败/无 key 降级模板（`letterMode` 可观测），绝不拖垮整册。
- **订单支付**：`POST /api/orders` 建单（金额服务端权威）、`GET /api/orders/:orderNo` 查单、`POST /api/payments/notify/:provider`
  网关回调。本地/测试 `PAYMENT_PROVIDER=mock` 时用 `POST /api/orders/:orderNo/pay` 完成支付（仅 mock 可用）。
  支付成功后按 SKU 履约（`UNLOCK_CERT`/`DUAL_STAR` 触发证书、`PHYSICAL_*` 记录待发货、`MEMORIAL_BOOK` 占位）。
  情侣双星登记：`POST /api/memorial/couple`，公开页 `/couple/[slug]`（两条成员均 `ACTIVE` 才可见）。

## 7. 无 DB 环境的验证策略（本地容器 / CI 同策略）

```bash
pnpm install
pnpm --filter @star/api prisma:generate
pnpm typecheck      # 全 workspace 类型检查
pnpm test           # astro-core / astro-data / api（api 单测全部 mock PrismaService，零外部依赖）
pnpm --filter @star/api build
pnpm --filter @star/web build
pnpm --filter @star/miniapp typecheck   # 小程序：无微信运行时，验证止于 tsc + 结构可导入（§10）
```

以上全绿 = 可合入。运行时行为（登记落库、纪念页、订单支付回调、小程序真机罗盘）在真实开发机/微信开发者工具按 §3–§6、§10 联调验证。

## 8. 常见故障排查

| 症状 | 定位 | 处置 |
| --- | --- | --- |
| api 启动日志「数据库连接失败，纪念登记接口将返回 503」 | `DATABASE_URL` 错 / PG 未就绪 | `docker compose ps` 看 healthy；核对连接串；api 无需重启逻辑修复后重启即可 |
| `prisma migrate deploy` 报 P1001 | 网络/端口/凭据 | 先 `psql "$DATABASE_URL" -c 'select 1'` 验通 |
| migrate 报迁移历史冲突（P3005 等） | 库不是由本仓库迁移创建 | 新库重来；或 `prisma migrate resolve` 显式标记基线，**禁止**手工改 `_prisma_migrations` |
| 登记接口 404 `CELESTIAL_NOT_FOUND`（uid 明明存在） | 忘了 seed | 跑 §5.2 ③ |
| health 里 `redis: "down"` | `REDIS_URL` 通不了 | 本期无业务影响（`skipped`/`down` 均可运行）；Phase 3 前修复 |
| OSS 上传 403 | AK 权限/Bucket 策略 | RAM 子账号需目标 bucket `PutObject`；核对 `OSS_REGION` 与 bucket 所在地域一致 |
| 证书 URL 打不开 / `404 ASSET_NOT_FOUND` | 本地驱动下资产未生成或 key 越界 | 先 `POST …/certificate` 触发；核对 `STORAGE_PUBLIC_BASE_URL`；路径穿越会被拒（预期） |
| 证书一直 `GENERATING` 不转 `READY` | 有 Redis 但 worker 未消费 | 查 api 进程日志（同进程 processor）；确认队列 `certificate` 有消费者；无 Redis 应同步直接 `READY` |
| 证书出图为 SVG 而非 PNG | `sharp` 未安装/加载失败 | 预期降级（`assetFormat=svg`）；需 PNG 则确保 `sharp` 可用（`onlyBuiltDependencies`） |
| 宇宙来信 `mode` 恒为 `template` | 未配 `ANTHROPIC_API_KEY` 或调用失败 | 预期降级；配 key 后即走 `llm`；查日志确认 SDK 调用是否报错 |
| `/api/admin/*` 全部 `503 ADMIN_NOT_ENABLED` | 未配 `ADMIN_API_TOKEN` | 生产必配（见 §4.1）；本地按需配后用 `x-admin-token` 访问 |
| `/api/admin/*` `401 ADMIN_UNAUTHORIZED` | `x-admin-token` 缺失/不匹配 | 核对请求头与 `ADMIN_API_TOKEN` 一致 |
| approve 报 `409 INVALID_STATE_TRANSITION` | 对已 `REJECTED` 的登记执行 approve | 非法流转（预期），见 [api-spec.md §9](./api-spec.md) 状态矩阵 |
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

## 10. 微信小程序（apps/miniapp）构建与部署

小程序不进 CI 常驻服务，产物经**微信开发者工具/微信公众平台**上传发布。运行时只依赖 `api`。

### 10.1 天文核心复用：源码引用，不用「构建 npm」

`@star/astro-core` 是 `type:module` 纯 TS、`main` 直指 `src/index.ts`，**无可分发 JS dist**，微信「构建 npm」会失败。
因此采用**源码引用 + tsconfig paths**（决策记录见 [architecture.md §3.2](./architecture.md)）：

- **typecheck 层（本期交付）**：`apps/miniapp/tsconfig.json` 的 `paths` 把 `@star/astro-core` 解析到
  `../../packages/astro-core/src/index.ts` 并 `include` 该源码；`pnpm --filter @star/miniapp typecheck` 覆盖
  miniprogram 全部 `.ts` + 共享 astro-core 源码。**本 workspace 是本轮唯一允许在仓库根 `pnpm install` 的工程**
  （需 `miniprogram-api-typings`、`typescript`、`@star/astro-core` workspace 依赖）。
- **接真机的 vendor 步骤**（本期不落地产物）：`node apps/miniapp/scripts/vendor-astro.mjs` 把 astro-core 6 个纯 TS
  源码复制进 `miniprogram/lib/astro-core/`（可就地被微信 TS 插件编译），再把 `paths` 改指本地副本。产物已 `.gitignore` 忽略。

### 10.2 用微信开发者工具打开与上传

- `project.config.json`（`miniprogramRoot=miniprogram/`、`useCompilerPlugins:['typescript']`、占位 `appid=touristappid`）
  保证「导入项目」可打开。接真机前把 `appid` 换成真实小程序 appid。
- 上传：微信开发者工具「上传」→ 微信公众平台「版本管理」提交审核发布。

### 10.3 后端基址与扫码进入配置

- **`BASE_URL`**：小程序**不读 `.env`**，后端基址在 `miniprogram/config.ts` 的常量 `BASE_URL` 承载
  （含协议、无尾斜杠，如 `https://api.example.com`）。**空串 = 演示模式**（无后端，全程内置示例星「天狼星」降级，
  与 web 端 `isApiConfigured` 同语义）。可用微信开发者工具「自定义编译」注入。
- **扫码进入**：证书二维码承载公开纪念页链接 `…/m/<slug>`；「扫普通链接二维码打开小程序」需在**微信公众平台**
  配置业务域名/链接规则。代码侧 `lib/scene.ts` 的 `extractId` 已把「扫码 / 小程序码 scene / 普通链接 / 直接 query」
  统一解析成 `{ slug? , no? }`（纯函数、无 `wx.*`、可 typecheck）。
- **合规**：detail/find 页底部与海报画布常驻逐字合规声明 `COMPLIANCE_NOTICE`（与后端 `common/compliance.ts` 一致，不得删改）。

### 10.4 验证口径

本地无微信运行时、不跑真机：验证 = `pnpm --filter @star/miniapp typecheck` 通过 + `project.config.json` 可在
微信开发者工具打开。真机行为（定位授权、罗盘方向引导、海报保存/转发）在开发者工具「真机调试」验证。
