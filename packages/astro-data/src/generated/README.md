# generated/ — 生成数据说明

本目录下的 JSON 均由 `scripts/` 下的 ETL 脚本离线生成，**已提交入库**。
运行时（前端 / 后端 / 小程序）不联网，直接 `import`；**构建绝不联网重新生成**。

| 产物 | 脚本 | 数据源 | 许可 |
|---|---|---|---|
| `bright-stars.json`（核心恒星层，lean） | `build-catalog.mjs` | HYG v41 | CC BY-SA 4.0 |
| `../../../../apps/web/public/data/stars-extended.json`（扩展恒星层） | `build-catalog.mjs` | HYG v41 | CC BY-SA 4.0 |
| `star-extras.json`（恒星增强层：pm/ci/变星/聚星/IAU 名） | `build-catalog.mjs` + `build-star-names.mjs` | HYG v41 + IAU-CSN | CC BY-SA 4.0（HYG 字段）+ CC BY 4.0（IAU 星名，署名 IAU） |
| `iau-csn-meta.json`（IAU-CSN 溯源元数据） | `build-star-names.mjs` | IAU-CSN | CC BY 4.0（署名 IAU） |
| `deep-sky.json`（深空天体） | `build-dso.mjs` | OpenNGC | CC-BY-SA-4.0 |
| `constellation-lines.json`（星座连线） | `build-constellation-lines.mjs` | d3-celestial | BSD-3-Clause |

## 1. 恒星（HYG Database v41）

- **数据源**：HYG Database **v41**（`astronexus/HYG-Database`）
  - URL：`https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv`
  - HYG 融合了 Hipparcos、Yale Bright Star Catalogue、Gliese 近星表等公开星表。
- **许可**：CC BY-SA 4.0 —— 使用需**署名 HYG Database (astronexus) 并以相同方式共享**。
  产品中如展示数据来源，请注明 “星表数据来自 HYG Database (CC BY-SA 4.0)”。

### 核心层 `bright-stars.json`（随包加载，**lean**）

- 星等阈值：**mag ≤ 6.5**（宇宙 V2 扩容定稿；旧版为 6.0/5058 颗）。
- 剔除：太阳（id=0）、无 HIP/HD/HR 编号的孤儿行、坐标越界行。
- 单位换算：赤经 小时→度（×15）；距离 秒差距→光年（×3.26156），HYG 的 100000pc 未知哨兵置 null。
- 精度：坐标 4 位小数、mag 2 位、dist 1 位，短键存储控制体积。
- **lean 纪律（Phase 9C First Load 回收）**：9B 曾把 `pmra`/`pmdec` 两键放进本层
 （主页 First Load 593→748KB），9C 撤回——本层只留坐标/星等/距离/光谱/编号/名称，
  pm/ci/变星/聚星/IAU 名全部走 `star-extras.json` 异步 chunk（ETL 有「无 pm 键」防回归断言）。
- **列式格式（columnar-v1，9C）**：`{ meta, n, cols: { ra[], dec[], mag[], dist[],
  spect[], con[], bayer[], flam[], proper[], bf[], hip[], hd[], hr[] } }`——
  对象数组的重复键名在 8896 行上约 600KB，列式化后 gzip 325→211KB。
  空值哨兵：`dist` 0=未知、字符串列 ''=无；`u` 不落盘，消费端由 hip/hd/hr
  按 HIP>HD>HR 派生（`catalog.ts decodeGenerated` / `etl-utils decodeBrightStars`）。
- 最近一次生成：`2026-07-15`（UTC），**8896 颗**，约 701 KB（gzip ~211KB）。

### 扩展层 `apps/web/public/data/stars-extended.json`（web 懒加载，不进主 bundle）

- 星等区间：**6.5 < mag ≤ 7.5**；同样剔太阳/孤儿/坐标越界。
- **纯渲染层**：不进搜索索引、不可拾取、不含编号——列式数组
  `ra[]`（3 位小数）/ `dec[]`（3 位小数）/ `mag[]`（2 位小数）+ `spec`
  （长度 n 的字符串，每颗 1 字符光谱主类 OBAFGKM，未知 `?`）
  + 自行两列 `pmra[]`/`pmdec[]`（**int16 语义整数，单位 0.5 mas/yr**，
  解码 mas/yr = 值 × 0.5；缺测记 0，深时模式下该星不动）。
- web 端消费契约：页面空闲后 `fetch('/data/stars-extended.json')`，复用
  `spectralColor`/`magnitudeToSize` 构建第二个静态 Points；失败静默降级（核心层已完整可用）。
- 最近一次生成：`2026-07-15`（UTC），**16852 颗**，约 457 KB（gzip 传输约 190 KB）。

### 增强层 `star-extras.json`（异步 chunk，`loadStarExtras()` 消费）

- 覆盖：核心层全部 uid + 允许名单（比邻星 HIP70890）——**8897 条**。
- 结构：`byUid[uid] = { p?, c?, v?, m?, n? }` 短键记录：
  - `p: [pmRa, pmDec]`（**mas/yr**，round 0.1；pmRa **已含 cosδ**。HYG v41 分量截断
    9999.99 的已知源缺陷仅涉 Barnard 星，不在覆盖内）；
  - `c: ci`（B−V 色指数，round 0.01）——Ballesteros 反解色温（physics.ts / 星色连续化）；
  - `v: [varMin, varMax]`（变星幅度两端视星等，HYG 语义 varMin=最暗；仅 `var`
    命名列非空才写，HYG 对非变星也填 min/max 属噪声，已过滤）；
  - `m: 1`（双星/聚星：base 非空 / comp≠1 / comp_primary 组成员 >1，组统计跑全表 12 万行）；
  - `n: IAU 官方星名`（build-star-names.mjs 写入；build-catalog 重跑时原样保留，两脚本可任意顺序）。
- 消费契约（冻结）：`loadStarExtras(): Promise<ReadonlyMap<string, StarExtra>>`
 （动态 import、单例缓存，Node 与浏览器都可用）；web 侧 hook `useStarExtra(uid)`。
- 最近一次生成：`2026-07-15`（UTC），**8897 条**（含 IAU 名 339 条），约 359 KB（异步 chunk，不占主包；
  主页 First Load 实测回落 748→593KB，见 web 构建输出）。

## 1b. IAU 官方星名（IAU-CSN）

- **数据源**：《IAU Catalog of Star Names》（IAU Division C WGSN）
  - 主源：`https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt`
  - 备源：`mirandadam/iau-starnames` 镜像（GitHub raw）；全部失败则**非零退出**。
- **许可（逐字）**：IAU 产品统一 **CC BY 4.0** ——
  “All IAU-produced products (Images, Videos, Texts) are released under Creative Commons
  Attribution (i.e. free to use in all perpetuity, world-wide, as long as the source is mentioned).”
  展示侧署名：「官方星名来自 IAU Catalog of Star Names（IAU WGSN，CC BY 4.0）」。
- **合规双杀**：免责声明反向引用——「本服务的纪念命名为私人象征性纪念，非 IAU 官方命名；
  恒星唯一官方专名体系见 IAU-CSN」（citationText 已入 `iau-csn-meta.json`）。
- 解析：定宽（Name/ASCII 0-17 列、Name/Diacritics 18-35 列，支持多词名）+ 行尾正则
  （mag/bnd/HIP/HD/RA/Dec/Date；脉冲星条目 mag='_' 已兼容）；抽样断言
  Vega=HIP91262 / Sirius=HIP32349 / Polaris=HIP11767 名字逐字符精确匹配。
- 最近一次抓取：`2026-07-15`，版本 *Last updated 2022-04-04*，**451 条**（HIP join 命中 339 条，
  批准日期 2015-12-15 ~ 2022-04-04）；溯源全量见 `iau-csn-meta.json`。

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
pnpm --filter @star/astro-data build:catalog              # 恒星三层（核心/扩展/extras）
pnpm --filter @star/astro-data build:star-names           # IAU-CSN 官方星名（写入 star-extras + meta）
pnpm --filter @star/astro-data build:dso                  # 深空天体
pnpm --filter @star/astro-data build:constellation-lines  # 星座连线（依赖核心层产物，最后跑）
```

（build-catalog 与 build-star-names 可任意顺序重跑：前者保留旧产物中的 iauName，
后者就地更新 star-extras.json 的 `n` 键。）

若 TLS 校验失败，先 `export NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt` 再运行；
脚本会把它传给 curl 的 `--cacert`。

无网络但已有缓存（`scripts/.cache/{hygdata.csv,IAU-CSN.txt,NGC.csv,addendum.csv,constellations.lines.json}`）时，
各脚本加 `--offline` 即可离线重跑。

## 降级说明

任一数据源完全不可下载且无缓存时，对应脚本**非零退出且不生成假数据**（绝不编造坐标）。
`catalog.ts` / `constellation-lines.ts` 对缺失 JSON 均做防御载入（退化为手写 60 颗 / 空数组），构建不崩。
当前入库的全部 JSON 均由真实数据正常生成，**未触发降级**。
