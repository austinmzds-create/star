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
│   ├── web/                # PC 沉浸式星空前端（Next.js + R3F）+ 公开纪念页 /m/[slug] + 情侣页 /couple/[slug] + 天象日历 /almanac
│   └── miniapp/            # 微信小程序「扫码找星」：扫证书二维码 → 纪念星/祝福/宇宙来信 → 手机罗盘方向引导找星 → 海报分享（源码引用 @star/astro-core）
├── packages/
│   ├── astro-core/         # 共享天文计算：RA/Dec→天球投影 / →地平坐标（含逆变换）/ 可见性 / 最佳观测时间（web + 小程序 + api 三端复用）
│   ├── astro-data/         # 共享星体类型 + 星表（手写 60 精选 + HYG v41 生成 5058 亮星）+ 中英文搜索索引
│   └── astro-ephem/        # astronomy-engine 包装：行星日月星历 / 月相 / 天象事件搜索（events）/ 小天体开普勒（minorBodies）
├── services/
│   └── api/                # NestJS 11 + Prisma 后端：天体搜索/详情、纪念登记（含情侣双星）、证书/星图/纪念册生成、订单支付、Agent 技能、审核后台、健康检查
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

## 已完成（Phase 4 · 多端与升级）

- **微信小程序「扫码找星」**（`apps/miniapp`）：扫证书二维码 → detail 展示纪念星/祝福/宇宙来信/证书 →
  find 页用**手机罗盘 + 定位**在真实天空做方向引导（左右转 / 抬降手机 +「已对准」判定）→ share 页 Canvas 程序化绘制星空海报保存/转发。
  **源码引用 `@star/astro-core`**（不用微信「构建 npm」，纯 TS 零依赖可就地编译），可见性算法与 web 端零漂移；
  `lib/scene.ts` 纯函数解析扫码/小程序码/普通链接入口；无后端/未配 `BASE_URL` 时整体降级演示（内置示例星）。
  验证 = `pnpm --filter @star/miniapp typecheck` + `project.config.json` 可在微信开发者工具打开（无真机、无微信运行时）。
- **情侣双星**（`services/api` + `apps/web`）：`POST /api/memorial/couple` 一次登记两颗星并绑定为一对，
  轻量 `CoupleGroup`（`coupleSlug`）承接，两颗星各自是普通登记（证书/纪念册零改动）；公开页 `/couple/[slug]`
  两条成员均 `ACTIVE` 才可见（复用现有 admin 审核，无需改后台）。合并一次内容审核、单事务创建、冲突重试。
- **纪念册**（`services/api/src/album`）：一本 6 页暗黑高级风 SVG（`cover→star-map→story→letter→astro→dedication`）+ 合并长图，
  **复用证书 SVG 基建**与 `enqueueOrRun` 幂等/降级；`letter` 页调 `cosmic-letter` skill（失败/无 key 降级模板，`letterMode` 可观测）。
  有 Redis 走 BullMQ（队列 `album`）、无 Redis 同步生成。纯 SVG 零新依赖。
- **订单与支付骨架**（`services/api/src/orders`）：`SKU_CATALOG` 服务端权威金额（前端只传 `skuCode`，永不信任前端金额）、
  `PaymentProvider` 抽象（mock / wechat / alipay，工厂按 `PAYMENT_PROVIDER` env 选型，凭证缺失降级 mock 绝不 crash）、
  回调验签 + 金额对账 + CAS 幂等履约一次（`providerTxnId @unique` 防重复认领）。真实网关待接，本地/测试用 mock（`POST …/pay`）。
- schema Phase 4 扩展：新增 `couple_group` / `album_record` 表、`memorial_registration` 加 `coupleGroupId`/`coupleRole`、
  `order` 加 `provider`/`providerTxnId`/`subject`/`payMeta` + `OrderStatus.FAILED` + `CoupleRole` 枚举；新增 8 个业务错误码
  （couple/order/payment）。验证仍为 typecheck + build + 单测（mock Prisma / mock provider）；小程序 typecheck 独立通过。

## 已完成（Phase 5 · 宇宙 V2）

- **星表扩容**：核心层 mag≤6.5（≈9000 颗真实亮星，随包单 draw call）+ 扩展层 mag 6.5–7.5
  （`apps/web/public/data/stars-extended.json` 空闲懒加载，纯渲染层）；深空天体 Messier 110 全量 +
  亮 NGC/IC（OpenNGC，CC-BY-SA-4.0），可搜可点，全部 `isNamable=false`（合规红线不动）。
- **星座动画与艺术（Star Walk 式）**：88 星座真实连线（d3-celestial，BSD-3，端点吸附为 objectUid）
  合并为**单 LineSegments 单 draw call**，注视/点选/搜索激活时线条依次发光亮起（时序折进顶点属性，
  shader 一个 smoothstep 完成）+ 星座中文名 CanvasTexture Sprite 淡入；注视判定 88 点积 + 滞回 +
  驻留确认，帧内全 ref 零 React 抖动。**20 幅原创 SVG 发光线稿**（12 黄道 + 猎户/大熊/仙后/天鹅/
  天琴/天鹰/飞马/南十字，`public/constellation-art/`，CC0 自绘、零第三方版权图像）以切平面 Mesh
  锚定天球，关键星严格对位（猎户七星/北斗/仙后 W/秋季四边形），聚焦时淡入；其余 68 座连线 + 名称兜底。
  ControlBar 新增「星座」开关（关闭整层卸载）；左下角星座信息卡内置 88 条原创中文神话/看点简介，
  最亮星可点击飞往；星座不可命名、无购买入口。搜索框支持星座直达（顶部条目 → 镜头飞向星座质心）。
- **行星日月**：`@star/astro-ephem`（astronomy-engine，MIT）按 observeTime 实时计算太阳/月亮/八大行星
  RA/Dec，独特视觉 + 信息卡 + 可搜索；DB 中作为 `isEphemeris` 元数据行，坐标运行时计算。
- 性能红线：恒星仍单 draw call；星座层 = 连线 1 draw + 名称 ≤2 sprite + 艺术图桌面 ≤2/移动 ≤1；
  `prefers-reduced-motion`/coarse-pointer 自动降级。详见 [docs/architecture.md §5.3](./docs/architecture.md)。

## 已完成（Phase 6A · 宇宙 V3 交互与天象）

- **悬停识别 tooltip**：鼠标移动 70ms 节流查统一拾取表（与点击共用遍历、命中半径 ×0.75），
  跟随光标的小名牌（中文名+类型+星等）。状态走 `lib/hoverBus.ts` 模块单例、坐标直改 DOM
  transform——高频更新零 React 重渲染；拖拽/滚轮/飞行即清空，触屏自动禁用，点击行为不变。
- **时间机器**：ControlBar 时钟按钮展开时间条（播放/暂停、×1~1周/秒 倍速、±1时/±1天步进、
  日期时间选择、±24h 弹簧滑条、「回到现在」）。rAF 累加权威时间、**4Hz 节流**写
  `store.observeTime`，经 EphemDriver 驱动行星/月相/信息卡可见性/地平线/晨昏全联动；
  未播放时 60s 心跳对齐现在（LST 缓慢推进）；偏离实时时按钮琥珀高亮。
- **坐标线开关组**（GridLayer，默认全关、开启才懒构建）：黄道金色大圆+十二宫刻度与宫名；
  天赤道青色大圆+RA/Dec 网格（合并单 LineSegments，极淡）。细线低透明，样式克制。
- **晨昏与地平线**（HorizonLayer，随城市+observeTime 联动）：`astro-core` 新增
  `horizontalToEquatorial` 逆变换（往返自洽单测）反投影出观测者此刻的地平线大圆+东南西北
  方位标；全天球 shader 暗罩把地平线下天区渐变压暗、按太阳高度角插值民用晨昏/白天色调
  （1 draw，行星落下同样变暗）。
- **显示设置面板**：ControlBar 重组只留高频项（时间/情侣双星/回到全景/显示 ⚙），
  低频开关（银河/名称标签/星座/自动旋转/坐标线/地平线/观测城市）收进弹出面板，
  底部保留「影像与数据来源」致谢入口。
- 性能红线不变：新层全部 effect 驱动（useFrame 零计算）、默认关闭零 draw 增量；
  详见 [docs/architecture.md §5.4](./docs/architecture.md)。

## 已完成（Phase 6B · 天象日历与体验层）

- **天象日历 `/almanac`**：`@star/astro-ephem` 新增 `events` 模块（包装 astronomy-engine 事件搜索），
  计算未来 12 个月：月相四相、日月食（全球日食标注「全球事件，本地可见性另查」）、
  行星合月/行星合（角距 <2°）、水金大距、外行星冲、二分二至、超级月亮（满月±邻近近地点判定）；
  流星雨为内置公域常识表（约 10 大流星雨极大期/ZHR/辐射点）。事件卡「提醒」= **零依赖手写 VEVENT**
  生成 `.ics` 下载 + 可选浏览器 Notification（页面开着时的本地提醒，权限请求克制）；
  「在星图中查看」深链回主页 `travelTo` 事件时刻并聚焦相关天体（store 零修改）。
  **独立路由独立 chunk，不进主页 First Load**；事件搜索单测用已知天文事实宽容差锚点
  （如 2026 年满月日期 ±1 天、2026-08-12 英仙座极大 ±1 天）。
- **月相日历**：月历视图每日 SVG 月相小图标（按 illumination+盈亏程序绘制）+
  当日月出月落时刻（SearchRiseSet 按所选城市）+ 今日月相详情。
- **深空科普长文**：16 个有真实照片的 Messier 天体各 150–300 字原创中文科普；
  StarInfoCard「了解更多」展开长文 + 照片放大 lightbox（常驻署名）。
- **夜间红光模式**：顶层 `mix-blend-mode: multiply` 红色覆盖层——天然覆盖 WebGL canvas，
  3D 场景同步变红、零后处理成本；DisplaySettings 开关，localStorage 持久化（SSR 安全封装 + 客户端回灌防水合不一致）。
- **分享海报**：信息卡「分享」→ 独立 2D canvas 离屏程序化绘制 1080×1440 海报
  （暗黑星空底 + 天体照片/程序视觉 + 名称/坐标/日期/品牌 + 合规脚注）下载 PNG，
  不截 3D、不开 `preserveDrawingBuffer`。
- **行星轨迹 + 黄道带**：仅对被选中行星采样 `getEquatorial` 画视轨迹折线（内行星 ±60 天/外行星 ±365 天，
  未选中零常驻成本）；黄道两侧 ±8° 半透明带并入现有黄道开关增强。
- **人造卫星**：`satellite.js`（MIT，**本阶段唯一新增 npm 依赖**）SGP4——内置 ISS/天宫/哈勃
  TLE 快照常量（注明 epoch，「TLE 会过期，位置为近似演示」）+ 运行时可选 Celestrak 刷新（失败回退快照）；
  小亮点 + 短尾迹（≤2 draw）、可中文搜索，信息卡标注「人造卫星 · 演示精度」。
  懒加载 chunk、开关默认关。`isNamable=false`。
- **彗星/小行星**：谷神星/灶神星/智神星 + 哈雷彗星（远日点附近，卡内标注）——
  JPL 轨道根数内置常量（注明历元）+ 手写开普勒方程牛顿迭代 → 日心 → 地心 RA/Dec
  （`@star/astro-ephem` 新增 `minorBodies` 模块，含对照 JPL Horizons 的宽容差单测）；
  信息卡展示轨道要素/当前距离与精度声明「演示级，±0.5°」。`isNamable=false`。
- **陀螺仪指星**（仅移动端）：`DeviceOrientationEvent`（iOS 需 `requestPermission`）驱动相机指向，
  复用 astro-core `horizontalToEquatorial` 把地平方向转天球方向，举起手机对准天空即见该方向星空；
  权限拒绝/无传感器优雅退出，桌面隐藏。
- **环境音效**：WebAudio 程序化生成（柔和棕噪声 + 缓慢正弦泛音垫，零音频资产零版权），
  默认关、用户手势后才创建 AudioContext，音量可调、状态持久化。
- **PWA**：Next 15 原生 `app/manifest.ts` + 基础 service worker（仅缓存静态壳、网络优先、
  不缓存 API）+ `beforeinstallprompt` 安装提示按钮。
- 详见 [docs/architecture.md §5.5](./docs/architecture.md)；TLE/轨道根数/流星雨表等数据来源登记见
  [docs/credits.md](./docs/credits.md)。

## 路线图

- **Phase 7+**：真实微信/支付宝支付网关联调、搜索 DB 化（pg_trgm）、内容安全云审核、实体礼盒供应链与物流；
  证书/纪念册渲染独立 worker 伸缩。

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
pnpm --filter @star/api db:migrate                  # prisma migrate deploy（应用已提交的 0_init 基线迁移，全新库直接建全部表）
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
