# API 规范

> **定位**：前后端契约。`apps/web` 与未来微信小程序按本文档对接 `services/api`。
> 本文档与实现同源：控制器在 `services/api/src/{celestial,memorial,certificate,agent,admin,health}/`，
> 错误码在 `services/api/src/common/errors/app-error.ts`，改实现必须同步改本文档。
> **读者**：前端 / 后端 / 小程序工程师。
> **最后更新**：2026-07-11（Phase 3 · 商业闭环：证书生成 / Agent Skills / 审核后台落地）。
> **关联文档**：[系统架构](./architecture.md) · [数据模型](./data-model.md) · [部署运维](./deployment.md)

---

## 1. 通用约定

### 1.1 基础路径与格式

- 全局前缀 **`/api`**（`main.ts` 的 `setGlobalPrefix('api')`），JSON、UTF-8。
- 默认端口 3001（`PORT` 可调，web 占 3000）。CORS 白名单由 `WEB_ORIGIN` 控制（逗号分隔）。
- 鉴权：**本期全部匿名**。`app_user` 表与 `ownerUserId` 字段已预留，登录态接入在 Phase 3+。
- 限流：本期未启用；Phase 3 基于 Redis 加令牌桶，配额将标注在附录 A。

### 1.2 响应形态与错误码

- **成功**：HTTP 2xx，body 即该接口的资源对象（见各接口示例），**无统一信封包裹**。
- **失败**：HTTP 4xx/5xx，body 统一为：

```jsonc
{
  "code": "CELESTIAL_NOT_FOUND",   // 稳定业务错误码，见下表
  "message": "星体不存在: HIP99999", // 人类可读，中文
  "details": null                   // 可选：校验失败时为 class-validator 消息数组等
}
```

由全局异常过滤器（`common/filters/app-exception.filter.ts`）归一化，未知异常不透出堆栈。

**错误码表**（`ErrorCodes` → HTTP 状态）：

| code | HTTP | 语义 |
| --- | --- | --- |
| `VALIDATION_FAILED` | 400 | 请求体/参数校验失败（`details` 含逐条消息） |
| `INVALID_QUERY` | 400 | 其余框架级 4xx（如路由不存在时保留原状态码） |
| `CELESTIAL_NOT_FOUND` | 404 | objectUid 无对应星体 |
| `REGISTRATION_NOT_FOUND` | 404 | 纪念编号无对应登记 |
| `MEMORIAL_PAGE_NOT_FOUND` | 404 | slug 无对应纪念页 / 未过审（不区分，防枚举探测） |
| `CELESTIAL_NOT_NAMABLE` | 422 | 星体存在但 `isNamable=false`，不可用于纪念命名（著名星/知名星恒为不可命名，见 [data-model.md §8.4](./data-model.md)） |
| `CONTENT_REJECTED` | 422 | 文本命中违禁词，`details.reason` 说明 |
| `ASSET_NOT_FOUND` | 404 | 本地资产静态服务 `/api/assets/*` 路径不存在或越界（防穿越，见 §7） |
| `SKILL_NOT_FOUND` | 404 | Agent 技能码未注册（`SkillRegistry` 无此 `skillCode`） |
| `SKILL_FAILED` | 500 | 技能执行失败（LLM 与模板兜底均异常；对外不透出内部堆栈） |
| `ADMIN_NOT_ENABLED` | 503 | 后台未配置 `ADMIN_API_TOKEN`，所有 `/api/admin/*` 拒绝服务（避免裸奔） |
| `ADMIN_UNAUTHORIZED` | 401 | 后台已启用但 `x-admin-token` 缺失/不匹配 |
| `INVALID_STATE_TRANSITION` | 409 | 非法状态流转（如对已 `REJECTED` 的登记执行 approve） |
| `DB_UNAVAILABLE` | 503 | 数据库不可用（需 DB 的接口专属；无 DB 环境的预期行为） |
| `INTERNAL_ERROR` | 500 | 未知异常 / 编号生成重试耗尽 |

### 1.3 分页

本期无列表型接口。预留约定：未来列表接口用 cursor 分页
（`?cursor=&limit=`，响应含 `nextCursor: string | null`），不用 page/pageSize——
目录与登记都是追加型数据，cursor 在深分页与并发写入下更稳。

### 1.4 幂等性

- web 客户端创建登记时已发送 `X-Idempotency-Key` 请求头（UUID）。
- **本期服务端尚未消费该头**：快速重复提交会产生多条登记（前端以 `submitting` 态防抖）。
- Phase 3 落地：Redis `SET key NX EX`，同 key 直接返回首次结果。字段与头名不会变。

### 1.5 合规字段（红线）

凡返回纪念/命名数据的接口，响应携带 `compliance` 字段（固定文案，源自
`common/compliance.ts` 的 `COMPLIANCE_NOTICE`，**不得删改**），前端必须展示：

> 本服务为基于真实星体坐标的私人纪念命名登记，仅具纪念意义，不代表国际天文学联合会（IAU）或任何官方机构的命名，不构成对该星体的任何权属。

## 2. Celestial 天体目录

数据源：本期为 `@star/astro-data` 内存目录（60 颗精选星），**零 DB 依赖**，
无 Postgres 也可正常服务。Phase 3 DB 化后接口签名不变（见 [data-model.md §6](./data-model.md)）。

### 2.1 GET /api/celestial/search — 搜索

| 参数 | 位置 | 约束 |
| --- | --- | --- |
| `q` | query，必填 | 非空，≤64 字符；支持中文名/英文名/别名/拜耳命名/星表编号/星座 |
| `limit` | query，可选 | 整数 1–50，默认 8 |

```bash
curl 'http://localhost:3001/api/celestial/search?q=天狼&limit=3'
```

响应 `200`：

```jsonc
{
  "query": "天狼",
  "items": [
    {
      "object": {                    // 完整 CelestialObject，字段见 data-model.md §3.1
        "objectUid": "HIP32349",
        "type": "star",
        "nameEn": "Sirius",
        "nameZh": "天狼星",
        "aliases": ["Dog Star", "天狼"],
        "bayer": "α CMa",
        "constellation": "Canis Major",
        "constellationZh": "大犬座",
        "raDeg": 101.2872,
        "decDeg": -16.7161,
        "magnitude": -1.46,
        "distanceLy": 8.6,
        "spectralType": "A1V",
        "catalogIds": { "hip": "32349", "hd": "48915" },
        "isNamable": false,             // 著名星（isFeatured=true）一律不可命名，见 data-model.md §8.4
        "isFeatured": true,
        "descriptionZh": "全天最亮恒星……"
      },
      "score": 12.4,                 // 相关性得分，越大越相关
      "matchedOn": "name"            // 'name'|'alias'|'bayer'|'catalog'|'constellation'
    }
  ],
  "count": 1
}
```

错误：`400 VALIDATION_FAILED`（q 为空/超长、limit 越界）。无命中返回 `items: []`（200，非 404）。

### 2.2 GET /api/celestial/:objectUid — 详情

```bash
curl 'http://localhost:3001/api/celestial/HIP32349'
```

响应 `200`：`{ "object": { ...CelestialObject（同上） } }`
错误：`404 CELESTIAL_NOT_FOUND`。

> 路由注意：`search` 必须先于 `:objectUid` 声明（已在控制器中保证），`/celestial/search` 不会被当作 uid。

### 2.3 规划中（本期未实现）

- `GET /api/celestial/namable-pool` — 命名候选池抽样（场景/星座/亮度偏好，服务「帮我挑一颗」），
  随星表扩容（[data-model.md §8.4](./data-model.md)）一起落地。
- 列表/分层加载接口（按 `renderPriority` 分包）——扩容后前端渐进加载用。

## 3. Memorial 纪念登记

`MemorialService` 强依赖 Prisma：**无 DB 时本组接口一律 `503 DB_UNAVAILABLE`**（预期行为，
web 客户端据此回退演示模式）。真实环境要求先 migrate + seed（外键 `starObjectUid` 依赖目录表）。

### 3.1 POST /api/memorial/registrations — 创建登记

请求体（`CreateRegistrationDto`，`whitelist: true` 会剥掉未声明字段）：

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `starObjectUid` | string，必填 | 必须存在且 `isNamable=true`。**著名星（`isFeatured=true`）恒不可命名** → `422 CELESTIAL_NOT_NAMABLE`；命名池为非著名、有 HIP、`4.0 ≤ mag ≤ 6.0` 的星（[data-model.md §8.4](./data-model.md)） |
| `memorialName` | string，必填 | 1–40 个字符（**按 Unicode 码点计**，emoji/生僻字算 1 字），自动 trim |
| `occasionType` | enum，必填 | 见下方场景码表 |
| `memorialDate` | string，可选 | `YYYY-MM-DD` |
| `blessingText` | string，可选 | ≤140 字 |
| `storyText` | string，可选 | ≤2000 字（纪念页长文，预留） |
| `contactEmail` | string，可选 | 邮箱格式；**隐私字段，只写不读** |

**场景码表**（`OccasionType`，DB 存码，中文仅为展示层映射）：

| 码 | 中文标签 |
| --- | --- |
| `LOVE` | 情侣纪念 |
| `BIRTHDAY` | 生日 |
| `WEDDING` | 婚礼 |
| `GRADUATION` | 毕业 |
| `NEWBORN` | 宝宝出生 |
| `PET_MEMORIAL` | 宠物纪念 |
| `IN_MEMORIAM` | 逝者纪念 |
| `OTHER` | 其他 |

```bash
# X-Idempotency-Key 为预留头（见 §1.4）
curl -X POST 'http://localhost:3001/api/memorial/registrations' \
  -H 'Content-Type: application/json' \
  -H 'X-Idempotency-Key: 4f1c2a7e-9d3b-4c8e-a1f0-6b5d2e8c9a01' \
  -d '{
    "starObjectUid": "HIP55642",
    "memorialName": "小满的星",
    "occasionType": "NEWBORN",
    "memorialDate": "2026-05-21",
    "blessingText": "愿你被这个世界温柔以待。"
  }'
# 注：HIP55642（狮子座 ι，mag 4.0，非著名有 HIP）属命名池；
#     若填 HIP91262（织女星）等著名星 → 422 CELESTIAL_NOT_NAMABLE。
```

响应 `201`：

```jsonc
{
  "registration": {
    "registrationNo": "STAR-20260710-K7PX",  // 服务端 CSPRNG 生成 + DB 唯一约束兜底
    "publicSlug": "m7k2xq9f4t3w",            // 公开纪念页 /m/[slug]
    "status": "ACTIVE",                      // 'ACTIVE' | 'PENDING_REVIEW'（命中复审词）
    "memorialName": "小满的星",
    "occasionType": "NEWBORN",
    "memorialDate": "2026-05-21",
    "blessingText": "愿你被这个世界温柔以待。",
    "createdAt": "2026-07-10T08:30:00.000Z",
    "star": {                                // 登记时刻快照（StarSnapshot），后续星表修订不影响
      "objectUid": "HIP55642",
      "nameZh": "狮子座 ι",                    // 非著名星无人工中文名 → 「星座中文 + 拜耳」占位（见 data-model.md §8.2）
      "nameEn": "Iota Leonis",
      "constellationZh": "狮子座",
      "raDeg": 170.9816,
      "decDeg": 10.5297,
      "magnitude": 4.0
    }
  },
  "compliance": "本服务为基于真实星体坐标的私人纪念命名登记，仅具纪念意义，不代表国际天文学联合会（IAU）或任何官方机构的命名，不构成对该星体的任何权属。"
}
```

审核语义：违禁词 → `422 CONTENT_REJECTED`（不创建）；复审词 → 正常创建但
`status: "PENDING_REVIEW"`（纪念页暂不可访问，编号已生效）；其余 → `ACTIVE`。
运营可置 `REVIEW_ALL_FREETEXT=1`（[deployment.md §4.1](./deployment.md)）令**任何含祝福语/故事文本**的
登记先进 `PENDING_REVIEW` 走人工复审（后台 approve 后转 `ACTIVE`，见 §7 AdminModule）；默认关闭=干净内容自动 `ACTIVE`。

错误：`400 VALIDATION_FAILED` / `404 CELESTIAL_NOT_FOUND` / `422 CELESTIAL_NOT_NAMABLE` /
`422 CONTENT_REJECTED` / `503 DB_UNAVAILABLE`。

### 3.2 GET /api/memorial/registrations/:registrationNo — 凭编号查询（登记人自查）

任何 `status` 均可见（登记人需要看到自己被置为待复审的记录）。响应 `200` 与 §3.1 的
`registration` 同构，**另含 `storyText`**；同样带 `compliance`。

**脱敏规则**：任何对外响应绝不含 `contactEmail` / `reviewNote` / 内部 `id` / `ownerUserId`。

错误：`404 REGISTRATION_NOT_FOUND` / `503 DB_UNAVAILABLE`。

### 3.3 GET /api/memorial/public/:publicSlug — 公开纪念页数据

`apps/web` 的 `/m/[slug]` 服务端组件消费（ISR 60s）。**仅 `ACTIVE` 可见**；
slug 不存在与未过审统一返回 404（防枚举探测，对访客无区分意义）。

```bash
curl 'http://localhost:3001/api/memorial/public/m7k2xq9f4t3w'
```

响应 `200`：

```jsonc
{
  "memorial": {
    "registrationNo": "STAR-20260710-K7PX",  // 印在证书上，本就公开
    "memorialName": "小满的星",
    "occasionType": "NEWBORN",
    "memorialDate": "2026-05-21",
    "blessingText": "愿你被这个世界温柔以待。",
    "storyText": null,
    "createdAt": "2026-07-10T08:30:00.000Z",
    "star": { /* StarSnapshot，同 §3.1 */ }
  },
  "compliance": "……（同 §1.5 固定文案）"
}
```

错误：`404 MEMORIAL_PAGE_NOT_FOUND` / `503 DB_UNAVAILABLE`。

### 3.4 证书资产（已实现，Phase 3 → 见 §5）

证书触发/查询、公开页附带证书、本地资产流已落地，完整契约见 [§5 Certificate 证书与星图](#5-certificate-证书与星图)。
存储驱动为 OSS 时 `certUrl`/`starMapUrl` 为**短时签名 URL**；本地驱动时为 `/api/assets/*` 直链。

## 4. Visibility 可见性（刻意不做接口）

「今晚可见性」（此刻方位/高度、过中天时刻与最高高度）由前端直接调
`@star/astro-core`（`computeObservationSummary` 等纯函数）计算：无密态数据、
省一次网络往返、离线可用。后端已依赖同一包，未来服务端渲染星图/证书时在 worker 内复用，
**不会**为此开 HTTP 接口。

## 5. Certificate 证书与星图

证书主图 + 星图（纯 SVG 字符串拼装，可选 sharp 栅格 PNG）→ 存储（OSS 或本地磁盘）→ 落库。
有 `REDIS_URL` 走 BullMQ 队列异步生成；无 Redis 同步生成（POST 直接返回 READY）。
所有对外证书响应带 `compliance`。资产存 object key，读时经 `storage.url()` 解析（兼容 OSS 短时签名）。

### POST /api/memorial/registrations/:registrationNo/certificate（触发，幂等）

无 body。`202`。幂等：READY/GENERATING 直接返回既有记录，不重复生成。

```jsonc
// 异步入队（有 Redis）
{ "registrationNo":"STAR-20260710-K7PX","status":"GENERATING","templateVersion":"v1",
  "assetFormat":"svg","certUrl":null,"starMapUrl":null,"updatedAt":"…","compliance":"…" }
// 同步降级/已就绪（status READY）
{ "registrationNo":"STAR-20260710-K7PX","status":"READY","templateVersion":"v1","assetFormat":"svg",
  "certUrl":"http://localhost:3001/api/assets/certificates/2026/07/STAR-20260710-K7PX-v1.svg",
  "starMapUrl":"http://localhost:3001/api/assets/starmaps/2026/07/STAR-20260710-K7PX-v1.svg",
  "updatedAt":"…","compliance":"…" }
```

错误：登记不存在 → `404 REGISTRATION_NOT_FOUND`；DB 不可用 → `503 DB_UNAVAILABLE`。

### GET /api/memorial/registrations/:registrationNo/certificate（取状态与 URL）

响应形状同上；未触发时 `status:"PENDING"`、url 为 null；`FAILED` 时可带脱敏 `error`。

### GET /api/memorial/public/:publicSlug（附带已就绪证书）

`memorial.certificate` 就绪时为 `{ status:"READY", certUrl, starMapUrl }`，否则 `null`。
不改公开视图既有隐私约束（仍不含 contactEmail/publicSlug/id）。

### GET /api/assets/*path（本地资产流）

仅本地存储生效（`STORAGE_DRIVER=local`/未配置 OSS）；OSS 模式 url 指向签名直链，本端点不参与。
含路径穿越防护（越界 → `404 ASSET_NOT_FOUND`），`Cache-Control: immutable`。

## 6. 健康检查

### GET /api/health

自身可用即 `200`，依赖状态放 body（供负载均衡探活 + 运维一眼定位）：

```jsonc
{
  "status": "ok",
  "service": "star-memorial-api",
  "version": "0.1.0",
  "uptimeSec": 86400,
  "timestamp": "2026-07-10T08:30:00.000Z",
  "deps": {
    "db": "up",        // 'up' | 'down'（启动探测失败不 crash，仅登记接口 503）
    "redis": "up"      // 'up' | 'down' | 'skipped'（未配置 REDIS_URL 时 skipped）
  }
}
```

## 7. 版本化与弃用策略

- 本期全局前缀 `/api`，未带版本号。破坏性变更时引入 `/api/v2` 并保留旧版 ≥1 个 Phase；
  非破坏性演进（加字段、加可选参数）直接进行。
- 字段弃用：先在本文档标注 `@deprecated` 与替代字段，保留两个 Phase 后移除。
- 已废弃：前端本地生成正式编号（`MemorialModal` 旧 `makeRegistrationNo`）——
  正式编号一律后端生成；前端仅保留同格式 `makeDemoRegistrationNo` 作离线演示回退。

## 8. Agent 技能 · 宇宙来信

### POST /api/agent/skills/cosmic-letter/run

根据星体/星座/场景/纪念对象生成一封中文「宇宙来信」。有 `ANTHROPIC_API_KEY` → 真调
`claude-sonnet-5`；无 key 或调用失败 → 分场景模板兜底（绝不崩）。执行过程落 `agent_task`
（DB 不可用则跳过落库、`taskNo:"unpersisted"`，仍返回来信）。

请求体（`CosmicLetterDto`）：
```jsonc
{ "starNameZh":"天狼星","constellationZh":"大犬座","occasion":"LOVE",
  "memorialName":"给挚爱 Alice","relationTo":"妻子","tone":"gentle" }
```
响应：`{ "letter":"致…","mode":"llm"|"template","taskNo":"clxxx…"|"unpersisted" }`。
`mode` 供前端标注「AI 生成 / 精选模板」。系统提示词内嵌合规红线（禁官方命名/IAU/购买/产权）。

> 速率/成本防护为 Phase 3 占位（Redis 令牌桶，`skipped`/`down` 时 fail-open 放行）；
> 本期靠 `maxTokens=512` + 无 key 零成本模板兜底约束。

## 9. Admin 后台审核（内部）

全部经 `AdminGuard` 鉴权：请求头 `x-admin-token` 比对 `ADMIN_API_TOKEN`。
未配置令牌 → `503 ADMIN_NOT_ENABLED`（拒绝裸奔）；缺失/不匹配 → `401 ADMIN_UNAUTHORIZED`。
后台端点**不返回** `COMPLIANCE_NOTICE`，返回**管理员全量视图**（含 `contactEmail`/`reviewNote`/
`ownerUserId` 等对外接口不返回的字段），仅内部研判使用。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/registrations?status=&page=&pageSize=` | 分页列出登记（可按 status 过滤） |
| POST | `/api/admin/registrations/:registrationNo/approve` | 通过复审 |
| POST | `/api/admin/registrations/:registrationNo/reject` | 拒绝/下架（body `{ reason }`） |
| GET | `/api/admin/agent-tasks?status=&page=&pageSize=` | 分页观测 Agent 任务 |

分页响应：`{ items, page, pageSize, total, totalPages }`。审计落 `memorial_registration.reviewNote`
（`[APPROVED <iso>] …` / `[REJECTED <iso>] <reason>`）。

**状态流转矩阵**：

| 动作 | 目标 | 允许来源 | 目标态幂等 | 其它来源 |
| --- | --- | --- | --- | --- |
| approve | ACTIVE | `PENDING_REVIEW` | ACTIVE 直接返回 | `REJECTED` → `409 INVALID_STATE_TRANSITION` |
| reject | REJECTED | `PENDING_REVIEW` / `ACTIVE`（下架） | REJECTED 直接返回 | — |

错误码：`ADMIN_NOT_ENABLED`(503) / `ADMIN_UNAUTHORIZED`(401) / `REGISTRATION_NOT_FOUND`(404) /
`INVALID_STATE_TRANSITION`(409) / `VALIDATION_FAILED`(400) / `DB_UNAVAILABLE`(503)。

> 登记初始状态：命中违禁词 → 422 不落库；命中复审词 → `PENDING_REVIEW`；干净内容默认 `ACTIVE`。
> 置 `REVIEW_ALL_FREETEXT=1` 则任何含祝福语/故事文本的登记先进 `PENDING_REVIEW`（默认关闭）。

## 附录 A：全接口一览

| 方法 | 路径 | 鉴权 | 依赖 DB | 幂等 | 状态 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/health` | 匿名 | 否（仅上报状态） | 是 | ✅ 已实现 |
| GET | `/api/celestial/search` | 匿名 | 否（内存目录） | 是 | ✅ 已实现 |
| GET | `/api/celestial/:objectUid` | 匿名 | 否（内存目录） | 是 | ✅ 已实现 |
| POST | `/api/memorial/registrations` | 匿名 | **是** | 头已预留，本期未消费 | ✅ 已实现 |
| GET | `/api/memorial/registrations/:registrationNo` | 匿名 | **是** | 是 | ✅ 已实现 |
| GET | `/api/memorial/public/:publicSlug` | 匿名 | **是** | 是 | ✅ 已实现 |
| POST | `/api/memorial/registrations/:no/certificate` | 匿名 | **是** | 是（READY/GENERATING 复用） | ✅ 已实现 |
| GET | `/api/memorial/registrations/:no/certificate` | 匿名 | **是** | 是 | ✅ 已实现 |
| GET | `/api/assets/*path` | 匿名 | 否（本地磁盘） | 是 | ✅ 已实现（仅本地存储） |
| POST | `/api/agent/skills/cosmic-letter/run` | 匿名 | 否（DB 可用则落 agent_task） | 否 | ✅ 已实现 |
| GET | `/api/admin/registrations` | `x-admin-token` | **是** | 是 | ✅ 已实现 |
| POST | `/api/admin/registrations/:no/approve` | `x-admin-token` | **是** | 是 | ✅ 已实现 |
| POST | `/api/admin/registrations/:no/reject` | `x-admin-token` | **是** | 是 | ✅ 已实现 |
| GET | `/api/admin/agent-tasks` | `x-admin-token` | **是** | 是 | ✅ 已实现 |
| GET | `/api/celestial/namable-pool` | 匿名 | 是 | 是 | 🗓 Phase 3 |

## 附录 B：DTO 与共享类型对应

| API 侧 | 共享包 / DB 侧 | 关系 |
| --- | --- | --- |
| `search.items[].object` | `@star/astro-data` `CelestialObject` | 同一对象直接透出 |
| `search.items[]`（score/matchedOn） | `@star/astro-data` `StarSearchResult` | 同构 |
| `CreateRegistrationDto` | `memorial_registration` 列 | 字段同名（starObjectUid/memorialName/occasionType/…） |
| `registration.status` | Prisma `RegistrationStatus` | 枚举原样透出（`ACTIVE`/`PENDING_REVIEW`/`REJECTED`） |
| `registration.star` / `memorial.star` | `MemorialService` 的 `StarSnapshot` | `starSnapshotJson` 反序列化；字段名与 `CelestialObject` 同名同型的子集 |
| web 客户端 | `apps/web/src/lib/api.ts` | 前端唯一通信层；其请求/响应类型必须与本契约保持镜像 |
