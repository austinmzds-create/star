# generated/bright-stars.json — 生成数据说明

本目录下的 `bright-stars.json` 由 `scripts/build-catalog.mjs` 离线生成，**已提交入库**。
运行时（前端 / 后端 / 小程序）不联网，直接 `import` 此 JSON，切勿在 build 时联网重新生成。

## 数据来源与许可

- **数据源**：HYG Database **v41**（`astronexus/HYG-Database`）
  - URL：`https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv`
  - HYG 融合了 Hipparcos、Yale Bright Star Catalogue、Gliese 近星表等公开星表。
- **许可**：CC BY-SA 4.0 —— 使用需**署名 HYG Database (astronexus) 并以相同方式共享**。
  产品中如展示数据来源，请注明 “星表数据来自 HYG Database (CC BY-SA 4.0)”。

## 生成参数

- 星等阈值：**mag ≤ 6.0**（约肉眼可见极限；本任务定稿阈值，与 docs §8 早期草案的 6.5 不同，以此为准）。
- 剔除：太阳（id=0）、无 HIP/HD/HR 编号的孤儿行、坐标越界行。
- 单位换算：赤经 小时→度（×15）；距离 秒差距→光年（×3.26156），HYG 的 100000pc 未知哨兵置 null。
- 精度：坐标 4 位小数、mag 2 位、dist 1 位，短键存储控制体积。

## 最近一次生成

- 生成时间（UTC）：`2026-07-11T01:11:38.162Z`
- 行数（stars.length）：**5058**
- 文件体积：约 761 KB

## 重新生成

有网络时：

```bash
pnpm --filter @star/astro-data build:catalog
# 等价于：node scripts/build-catalog.mjs
```

下载走系统 `curl`（遵守 `HTTPS_PROXY` / `https_proxy`）。若 TLS 校验失败，
先 `export NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt` 再运行；脚本会把它传给 curl 的 `--cacert`。

无网络但已有 CSV 缓存（`scripts/.cache/hygdata.csv`）时：

```bash
node scripts/build-catalog.mjs --offline
```

## 降级说明

若 HYG 完全不可下载且无缓存，脚本**非零退出且不生成假数据**（绝不编造坐标）。
此时 `catalog.ts` 会在缺失 JSON 时退化为仅手写 60 颗精选星，构建不崩。
当前入库的 JSON 来自 HYG v41 主路径正常生成，**未触发降级**。
