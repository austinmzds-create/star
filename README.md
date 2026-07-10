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
- **后端（规划中）**：NestJS + Prisma，模块对应服务分层（用户/星体/搜索/命名/证书/订单/Agent/后台）。
- **基础设施（仅依赖已提供的三样）**：**PostgreSQL + Redis + 阿里云 OSS**。
  搜索先用 Postgres 全文检索 + pg_trgm；队列用 BullMQ（跑在 Redis 上）。不引入任何额外基建。

## 目录结构

```
star/
├── apps/
│   └── web/                # PC 沉浸式星空前端（Next.js + R3F）
├── packages/
│   ├── astro-core/         # 共享天文计算：RA/Dec→天球投影 / →地平坐标 / 可见性 / 最佳观测时间
│   └── astro-data/         # 共享星体类型 + 精选真实星表 + 中英文搜索索引
├── services/               # （Phase 2）NestJS API 等后端服务
├── turbo.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## 已完成（Phase 1 · 第一张脸）

- `@star/astro-core`：真实天文算法（儒略日、GMST/LST、赤道→地平、上/下中天、拱极判断、
  16 方位描述）。**16 项单元测试**，含往返物理自洽校验（过中天时高度角=最大高度角、恒星时回到 RA）。
- `@star/astro-data`：60 颗最亮/最著名恒星的**真实 J2000 数据**（坐标/星等/距离/光谱型/HIP 编号/
  中英文名与别名），中英文名 + 别名 + 拜耳命名 + 星表编号 + 星座**可搜索**。**13 项单元测试**。
- `apps/web`：全屏 R3F 宇宙——程序化环境星场 + 银河带 + 星云、渐变天穹、真实精选星表；
  第一人称拖拽环视、滚轮缩放、自动旋转；玻璃拟态搜索（中英文），**搜索/点击后镜头平滑飞向目标星**、
  呼吸高亮 + 名牌；星体详情卡（含所选城市**今晚可见性**：此刻方位/高度、过中天时刻与最高高度）；
  「为这颗星创建纪念命名」入口与命名弹窗（生成纪念预览）；全站合规声明。

## 路线图

- **Phase 2 · 后端地基**：NestJS + Prisma（`celestial_object` 等主表）、星体搜索/命名登记/证书/
  用户/订单 API、Redis 缓存、OSS 文件、BullMQ 异步。
- **Phase 3 · 商业闭环**：纪念页 + 证书生成 + 管理后台 + Agent Skills（宇宙来信 / 证书模板推荐 /
  内容审核 / 星体推荐）。
- **Phase 4**：微信小程序扫码找星、情侣双星、纪念册、实体礼盒供应链。

## 本地开发

```bash
pnpm install          # 安装全部工作区依赖
pnpm test             # 运行所有包的单元测试（astro-core / astro-data）
pnpm typecheck        # 全量类型检查
pnpm --filter @star/web dev     # 启动前端 http://localhost:3000
pnpm --filter @star/web build   # 生产构建
```

## 星表数据来源

第一版采用公开星表（Hipparcos / Bright Star Catalogue）中最亮/最著名恒星的常用取值，
坐标为 J2000 历元。后续 Phase 2 将通过 ETL 扩容到亮星库 + 命名候选池（HYG / Gaia 子集）。
