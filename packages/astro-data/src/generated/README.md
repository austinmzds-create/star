# generated/ — 生成数据说明

本目录下的 JSON 均由 `scripts/` 下的 ETL 脚本离线生成，**已提交入库**。
运行时（前端 / 后端 / 小程序）不联网，直接 `import`；**构建绝不联网重新生成**。

| 产物 | 脚本 | 数据源 | 许可 |
|---|---|---|---|
| `bright-stars.json`（核心恒星层） | `build-catalog.mjs` | HYG v41 | CC BY-SA 4.0 |
| `../../../../apps/web/public/data/stars-extended.json`（扩展恒星层） | `build-catalog.mjs` | HYG v41 | CC BY-SA 4.0 |
| `deep-sky.json`（深空天体） | `build-dso.mjs` | OpenNGC | CC-BY-SA-4.0 |
| `constellation-lines.json`（星座连线） | `build-constellation-lines.mjs` | d3-celestial | BSD-3-Clause |

## 1. 恒星（HYG Database v41）

- **数据源**：HYG Database **v41**（`astronexus/HYG-Database`）
  - URL：`https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv`
  - HYG 融合了 Hipparcos、Yale Bright Star Catalogue、Gliese 近星表等公开星表。
- **许可**：CC BY-SA 4.0 —— 使用需**署名 HYG Database (astronexus) 并以相同方式共享**。
  产品中如展示数据来源，请注明 “星表数据来自 HYG Database (CC BY-SA 4.0)”。

### 核心层 `bright-stars.json`（随包加载）

- 星等阈值：**mag ≤ 6.5**（宇宙 V2 扩容定稿；旧版为 6.0/5058 颗）。
- 剔除：太阳（id=0）、无 HIP/HD/HR 编号的孤儿行、坐标越界行。
- 单位换算：赤经 小时→度（×15）；距离 秒差距→光年（×3.26156），HYG 的 100000pc 未知哨兵置 null。
- 精度：坐标 4 位小数、mag 2 位、dist 1 位，短键存储控制体积。
- 最近一次生成：`2026-07-11`（UTC），**8896 颗**，约 1272 KB。

### 扩展层 `apps/web/public/data/stars-extended.json`（web 懒加载，不进主 bundle）

- 星等区间：**6.5 < mag ≤ 7.5**；同样剔太阳/孤儿/坐标越界。
- **纯渲染层**：不进搜索索引、不可拾取、不含编号——只有列式四数组
  `ra[]`（3 位小数）/ `dec[]`（3 位小数）/ `mag[]`（2 位小数）+ `spec`
  （长度 n 的字符串，每颗 1 字符光谱主类 OBAFGKM，未知 `?`）。
- web 端消费契约：页面空闲后 `fetch('/data/stars-extended.json')`，复用
  `spectralColor`/`magnitudeToSize` 构建第二个静态 Points；失败静默降级（核心层已完整可用）。
- 最近一次生成：`2026-07-11`（UTC），**16852 颗**，约 341 KB（gzip 传输约 150 KB）。

## 2. 深空天体 `deep-sky.json`（OpenNGC）

- **数据源**：OpenNGC（`mattiaverga/OpenNGC`）
  - `https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv`
  - `https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/addendum.csv`
    （addendum **必须**：M40=`M040`、M45=`Mel022` 只在这里）
- **许可**：**CC-BY-SA-4.0** —— 展示侧署名文案「深空天体数据来自 OpenNGC (CC-BY-SA-4.0)」。
- 筛选参数：**Messier 110 全量**（无条件入选）+ 非 Messier 非恒星类且 V-Mag（缺则 B-Mag）**≤ 10**。
- 类型映射：G/GPair/GTrpl/GGroup→galaxy；OCl/GCl/Cl+N/\*Ass→cluster；
  PN/HII/Neb/EmN/RfN/SNR/Nova/DrkN→nebula；\*/\*\*→star（仅 M40 兜底）；
  Other 仅 Messier 兜底（M73）；Dup/NonEx 跳过。巨蛇座 Se1/Se2 归一为 Ser。
- **M102 覆写**：OpenNGC 把 `Name=M102` 标为 M101 的 Dup（历史争议的一种解释）；
  产品采用主流解释 **M102 = NGC 5866（纺锤星系）**，简介注明争议。
- 中文名/俗名/简介：脚本内置 `MESSIER_ZH` 全 110 条人工映射（键完整性由脚本断言）。
- 合规红线：深空天体一律 `isNamable=false`（catalog.ts 落实）；Messier 全 `isFeatured=true`。
- 最近一次生成：`2026-07-11`（UTC），**574 个**（Messier 110 + 亮 NGC/IC 464），约 71 KB。

## 3. 星座连线 `constellation-lines.json`（d3-celestial）

- **数据源**：d3-celestial（`ofrohn/d3-celestial`）
  - `https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.lines.json`
- **许可**：**BSD-3-Clause**（署名 Olaf Frohn / d3-celestial）。
- 匹配算法：GeoJSON 顶点（RA 负值 +360 归一）对核心层 `bright-stars.json` 做
  球面角距最近邻（1°×1° 网格索引 + 5×5 邻域扫描），容差 **0.5°**；
  端点统一为 **objectUid**（HIP>HD>HR，与 CELESTIAL_CATALOG 同规则）——
  比裸 HIP 严格更优：HYG 个别无 HIP 的亮星（如 ξ UMa → `HD98231`）也能命中。
- 匹配率统计（最近一次生成）：**743/743 = 100%**，`droppedSegments=0`；
  匹配率 < 97% 时脚本非零退出（防上游格式漂移静默劣化）。
- 88 星座全覆盖（Ser 蛇头/蛇尾两条 Feature 按 id 合并）。
- 最近一次生成：`2026-07-11`（UTC），**88 星座 / 743 线段**，约 20 KB。

## 重新生成

有网络时（下载走系统 `curl`，遵守 `HTTPS_PROXY` / `https_proxy`）：

```bash
pnpm --filter @star/astro-data build:catalog              # 恒星双层
pnpm --filter @star/astro-data build:dso                  # 深空天体
pnpm --filter @star/astro-data build:constellation-lines  # 星座连线（依赖核心层产物，最后跑）
```

若 TLS 校验失败，先 `export NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt` 再运行；
脚本会把它传给 curl 的 `--cacert`。

无网络但已有缓存（`scripts/.cache/{hygdata.csv,NGC.csv,addendum.csv,constellations.lines.json}`）时，
各脚本加 `--offline` 即可离线重跑。

## 降级说明

任一数据源完全不可下载且无缓存时，对应脚本**非零退出且不生成假数据**（绝不编造坐标）。
`catalog.ts` / `constellation-lines.ts` 对缺失 JSON 均做防御载入（退化为手写 60 颗 / 空数组），构建不崩。
当前入库的全部 JSON 均由真实数据正常生成，**未触发降级**。
