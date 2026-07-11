# 星辰纪念 · Stellar Memorial

沉浸式星空**纪念命名**平台。用户在一片电影感的宇宙里搜索真实星体、飞向属于自己的那颗星，
为重要的人（生日 / 情侣 / 婚礼 / 宝宝出生 / 宠物 / 逝者纪念）登记一颗**私人纪念星**，
并获得星图、纪念证书与可扫码访问的线上纪念页。

> **定位与合规**：本平台销售的是「基于真实星体坐标的私人纪念命名礼物 + 情绪价值」，
> **不是**官方天文命名权。所有文案均明确：私人纪念命名登记，**不代表国际天文学联合会（IAU）
> 或任何官方天文机构的命名**，用户不获得星体所有权或官方命名权。

---

## 为什么是这套技术栈

产品的核心诉求是**「一套天文核心，多端复用」**（PC 网页 + 未来微信小程序共用同一套坐标/
可见性/搜索算法），并且要求**上线级健壮后端**、可接 **Agent Skills**。据此选定：

- **统一 TypeScript Monorepo**（pnpm + Turborepo）——只有核心是 TS，才能让 web 与小程序
  `import` 同一个 `@star/astro-core`，避免算法写两遍、对不齐。
- **前端**：Next.js（App Router）+ React Three Fiber + Three.js + Tailwind + Zustand + Framer Motion。
- **后端**：NestJS 11 + Prisma（PostgreSQL），模块对应服务分层（星体/命名/证书/订单/Agent/后台）。
- **基础设施（仅依赖已提供的三样）**：**PostgreSQL + Redis + 阿里云 OSS**。
  搜索先用 Postgres 全文检索 + pg_trgm；队列用 BullMQ（跑在 Redis 上）。不引入任何额外基建。

## 目录结构

```
star/
├── apps/
│   └── web/                # PC 沉浸式星空前端（Next.js + R3F）+ 公开纪念页 /m/[slug]
├── packages/
│   ├── astro-core/         # 共享天文计算：RA/Dec→天球投影 / →地平坐标 / 可见性 / 最佳观测时间
│   └── astro-data/         # 共享星体类型 + 星表（手写 60 精选 + HYG v41 生成 5058 亮星）+ 中英文搜索索引
├── services/
│   └── api/                # NestJS 11 + Prisma 后端：天体搜索/详情、纪念登记、证书/星图生成、Agent 技能、审核后台、健康检查
├── infra/                  # docker-compose.yml（Postgres + Redis，真实环境用）
├── docs/                   # 架构 / 数据模型 / API 规范 / 部署运维
├── turbo.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | 系统架构：拓扑、共享包编译方案（决策记录）、模块划分、关键时序 |
| [docs/data-model.md](docs/data-model.md) | 数据模型：全部库表（含 certificate_record / agent_task 字段）+ 星表扩容（60 → 5058 亮星 + 命名候选池，已落地） |
| [docs/api-spec.md](docs/api-spec.md) | API 规范：每个端点的请求/响应示例、错误码表、合规字段 |
| [docs/deployment.md](docs/deployment.md) | 部署运维：docker-compose、环境变量、migrate/seed、故障排查 |

## 已完成（Phase 1 · 第一张脸）

- `@star/astro-core`：真实天文算法（儒略日、GMST/LST、赤道→地平、上/下中天、拱极判断、
  16 方位描述）。**16 项单元测试**，含往返物理自洽校验（过中天时高度角=最大高度角、恒星时回到 RA）。
- `@star/astro-data`：60 颗最亮/最著名恒星的**真实 J2000 数据**（坐标/星等/距离/光谱型/HIP 编号/
  中英文名与别名），中英文名 + 别名 + 拜耳命名 + 星表编号 + 星座**可搜索**。**13 项单元测试**。
- `apps/web`：全屏 R3F 宇宙——程序化环境星场 + 银河带 + 星云、渐变天穹、真实精选星表；
  第一人称拖拽环视、滚轮缩放、自动旋转；玻璃拟态搜索（中英文），**搜索/点击后镜头平滑飞向目标星**、
  呼吸高亮 + 名牌；星体详情卡（含所选城市**今晚可见性**：此刻方位/高度、过中天时刻与最高高度）；
  「为这颗星创建纪念命名」入口与命名弹窗（生成纪念预览）；全站合规声明。

## 已完成（Phase 2 · 后端地基）

- `services/api`（`@star/api`）：NestJS 11 + Prisma。天体搜索/详情（本期由 `@star/astro-data`
  内存目录支撑，与前端共享同一份打分代码，零 DB 依赖）；**纪念登记落库**——服务端生成
  纪念编号 `STAR-YYYYMMDD-XXXX`（CSPRNG + DB 唯一约束兜底）与不可枚举的公开页 slug，
  写入时快照星体数据；内容审核占位（关键词表，Phase 3 换云审核）；`/api/health` 健康检查。
- Prisma schema 全量主表：`celestial_object` / `celestial_name_alias`（为 pg_trgm DB 化搜索铺路）/
  `memorial_registration` / `certificate_record` / `app_user` / `order` / `agent_task`；
  seed 脚本灌入 60 颗精选星。
- 共享包以 TS 源码被 Nest 消费：`nest build --webpack` 单文件打包
  （决策记录见 [docs/architecture.md](docs/architecture.md) §3）。
- `apps/web` 接入 API：命名弹窗真实登记 + 「查看在线纪念页」；公开纪念页 `/m/[slug]`
  （纯服务端组件、CSS 星空、ISR 60s）；后端不可达时整体优雅回退演示模式。
- `infra/docker-compose.yml`（Postgres 16 + Redis 7，带 healthcheck）、`.env.example` 全量占位、
  `docs/` 四份文档；无 DB 环境验证策略 = typecheck + build + 单测（mock Prisma）。
- 星表扩容（60 → ~5000 亮星 + 命名候选池）完成**规划**：ETL 管道、render/search 优先级与 isNamable 策略，
  见 [docs/data-model.md](docs/data-model.md) §8（Phase 3 已落地，见下）。

## 已完成（Phase 3 · 商业闭环）

- **证书 + 星图生成**（`services/api/src/certificate/`）：**零无头浏览器**，证书主图与星图纯 SVG 字符串拼装
  （局部天区 gnomonic 投影 + 邻域星高亮），`sharp` 可用时增强栅格 PNG、不可用只出 SVG。
  `POST/GET /api/memorial/registrations/:no/certificate`（幂等触发/查状态），公开纪念页附带已就绪证书。
  **有 Redis 走 BullMQ 异步、无 Redis 同步生成**，绝不阻塞。
- **存储抽象 `StorageService`**：`STORAGE_DRIVER=auto|local|oss|dataurl`——配齐 OSS 用 OSS（签名 URL），
  否则本地磁盘经 `GET /api/assets/*`（防路径穿越）流式服务，写盘失败再降级 data URL。`ali-oss` 懒加载、本期不安装。
- **Agent Skills · 宇宙来信**（`services/api/src/agent/`）：`SkillRegistry` + `LlmProvider` 抽象。
  配 `ANTHROPIC_API_KEY` → 真调 `claude-sonnet-5`，缺省/失败 → 模板兜底（`mode:'template'`），**绝不崩**。
  `POST /api/agent/skills/cosmic-letter/run`，执行落 `agent_task`（新增 `modelName`/`durationMs`）；系统提示词内嵌合规红线。
- **审核后台 API**（`services/api/src/admin/`）：`AdminGuard`（`x-admin-token` + `timingSafeEqual`，
  未配令牌整段 503 拒绝裸奔）；登记分页列表/approve/reject（审计落 `reviewNote`）+ agent 任务观测；
  状态流转校验（非法流转 `409`）；`REVIEW_ALL_FREETEXT` 开关强制自由文本入人工复审。
- **星表扩容 ETL 落地**（`packages/astro-data/scripts/build-catalog.mjs`）：HYG Database **v41**（CC BY-SA 4.0）
  → `src/generated/bright-stars.json`（**5058 颗** mag ≤ 6.0，提交入库、前后端直接 import、构建不联网）。
  与手写 60 颗按 objectUid 合并去重；**合规红线**：所有著名星 `isNamable=false`，命名池取非著名 + 有 HIP + 4.0 ≤ mag ≤ 6.0（≈ 4400 颗）。
- 新增业务错误码 6 个（`ASSET_NOT_FOUND` / `SKILL_NOT_FOUND` / `SKILL_FAILED` / `ADMIN_NOT_ENABLED` /
  `ADMIN_UNAUTHORIZED` / `INVALID_STATE_TRANSITION`）；`.env.example` 补齐存储/LLM/后台占位变量。
  验证仍为 typecheck + build + 单测（mock Prisma / mock provider，无 Redis/OSS/Key 均降级可跑）。

## 路线图

- **Phase 4**：微信小程序扫码找星、情侣双星、纪念册、实体礼盒供应链；订单支付、内容安全云审核、
  搜索 DB 化（pg_trgm）、证书渲染独立 worker 伸缩。

## 本地开发

```bash
pnpm install          # 安装全部工作区依赖
pnpm --filter @star/api prisma:generate   # 生成 Prisma Client（typecheck/test 前置）
pnpm test             # 运行所有单元测试（astro-core / astro-data / api，api 侧 mock Prisma）
pnpm typecheck        # 全量类型检查
pnpm --filter @star/web dev     # 启动前端 http://localhost:3000
pnpm --filter @star/web build   # 生产构建
```

启动后端 API（需要真实 Postgres/Redis，本地无 docker 的容器只做上面的验证三件套）：

```bash
docker compose -f infra/docker-compose.yml up -d   # 起 Postgres 16 + Redis 7
cp services/api/.env.example services/api/.env      # 按需修改（默认值即指向 compose）
pnpm --filter @star/api db:migrate                  # prisma migrate deploy（首次先 migrate dev --name init）
pnpm --filter @star/api db:seed                     # 灌入 60 颗精选星（登记接口的前置）
pnpm --filter @star/api dev                         # http://localhost:3001/api/health
# 前端连上后端：设置 NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 再启动 web
```

完整 runbook 与故障排查见 [docs/deployment.md](docs/deployment.md)。

## 星表数据来源

手写精选 60 颗采用公开星表（Hipparcos / Bright Star Catalogue）中最亮/最著名恒星的常用取值，
坐标为 J2000 历元。Phase 3 已通过 ETL（`packages/astro-data/scripts/build-catalog.mjs`）扩容：
数据源 **HYG Database v41**（astronexus/HYG-Database，**CC BY-SA 4.0**，署名见
`packages/astro-data/src/generated/README.md`），产出 5058 颗 mag ≤ 6.0 亮星 + 命名候选池，产物提交入库、离线可用。
