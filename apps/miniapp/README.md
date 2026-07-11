# @star/miniapp · 星辰纪念·扫码找星（微信小程序）

证书上的二维码 → 微信扫码 → 进入小程序 → 展示纪念星信息/祝福/宇宙来信 → 用手机在真实天空里用罗盘方向引导找到那颗星 → 生成海报分享。

## 页面

- `pages/index`：扫码 / 输入登记编号进入。冷启动带标识时直达详情。
- `pages/detail`：纪念星信息 + 祝福 + 宇宙来信 + 证书图。
- `pages/find`：核心。定位 + 罗盘方向引导（左右转 / 抬降手机）+「已对准」判定。
- `pages/share`：程序化绘制星空海报（Canvas 2D），保存 / 转发。

## 天文核心复用（@star/astro-core）

采用「源码引用 + tsconfig paths」而非微信「构建 npm」：astro-core 是 `type:module` 纯 TS、
`main` 直指 `src/index.ts`，没有可分发的 JS dist，微信「构建 npm」会失败。

- **typecheck 层（本期交付）**：`tsconfig.json` 的 `paths` 把 `@star/astro-core` 解析到
  `../../packages/astro-core/src/index.ts`，并 `include` 共享源码进 typecheck 范围，
  保证「一套算法多端一致」。业务代码统一 `import { computeVisibility, ... } from '@star/astro-core'`。
- **运行接入层（接真机前执行）**：`node scripts/vendor-astro.mjs` 把 astro-core 的 6 个纯 TS 源码
  复制进 `miniprogram/lib/astro-core/`（零依赖可就地被微信 TS 插件编译），随后把 `tsconfig.json`
  的 `paths` 目标改指本地副本。本期不落地 vendor 产物（避免重复源码入库），已在 `.gitignore` 忽略。

## 验证

```bash
# 仓库根安装一次（本工程是本轮唯一允许 install 的 agent）
pnpm install

# typecheck（覆盖 miniprogram 全部 .ts + 共享 astro-core 源码）
pnpm --filter @star/miniapp typecheck
```

无微信运行时、不跑真机。`project.config.json`（`miniprogramRoot=miniprogram/`、
`useCompilerPlugins:['typescript']`、占位 `appid=touristappid`）保证微信开发者工具能「导入项目」打开。

## 接真机前的待办（本期不阻塞验证）

1. `node scripts/vendor-astro.mjs` 同步天文核心到 `miniprogram/lib/astro-core/`，并改 `paths` 指向本地副本。
2. 把 `project.config.json` 的 `appid` 换成真实小程序 appid。
3. 「扫普通链接二维码打开小程序」需在微信公众平台后台配置业务域名/链接规则（代码侧 `lib/scene.ts` 已做解析）。
4. `config.ts` 的 `BASE_URL` 填后端地址（空串 = 演示模式，全程内置示例星「天狼星」降级）。
5. 海报底部小程序码为占位方框，可替换为后端生成的小程序码。

## 合规

所有面向用户文案中文，且合规脚注 `COMPLIANCE_NOTICE`（逐字与后端 `common/compliance.ts` 一致）
常驻于 detail / find 页底部与海报画布内，不得删改。
