/**
 * 数据来源主数据（Phase 9C 溯源体系）——单一事实源：
 * prisma/seed.ts 据此灌 data_source 表；DB 不可用时 /api/v1/data-sources 直接回退本表。
 *
 * 【数据纪律】license / citation 逐字来自各源官方口径（调研报告 r-data.md §2 与
 * packages/astro-data/src/generated/README.md、docs/credits.md 已核对原文），绝不编造；
 * retrievedAt 为 null 表示「预留登记（尚未入库）或运行时实时计算」，seed 落库时以登记时间代填并在 notes 注明。
 *
 * 【合规红线】任何 citation 文案不得含「买星星 / 产权 / 官方命名 / IAU 认证」表述；
 * 唯一例外：iau-csn 行的「非官方命名」免责声明按红线要求反向引用 IAU-CSN 作为权威锚点。
 */

/** 数据源主数据行（与 prisma DataSource 模型同构，id/createdAt/updatedAt 由 DB 生成）。 */
export interface DataSourceSeed {
  key: string;
  name: string;
  publisher: string;
  url: string;
  downloadUrl?: string;
  version: string;
  license: string;
  licenseUrl?: string;
  citationZh: string;
  citationEn: string;
  magComplete?: number;
  recordCount?: number;
  /** 'static-build' | 'runtime-daily' | 'runtime-6h' | 'runtime-live' */
  refreshPolicy: string;
  /** ISO 时间；null = 预留/实时（seed 用登记时间代填）。 */
  retrievedAt: string | null;
  notes?: string;
}

/**
 * 全部数据源登记（含 IAU-CSN / Stellarium-chinese 预留行）。
 * generatedAt / 记录数取自 packages/astro-data/src/generated/*.json 的 meta 块（ETL 实测值）。
 */
export const DATA_SOURCES: readonly DataSourceSeed[] = [
  {
    key: 'hyg-v41',
    name: 'HYG Database v4.1',
    publisher: 'astronexus (David Nash)',
    url: 'https://www.astronexus.com/projects/hyg',
    downloadUrl:
      'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv',
    version: 'v41',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    citationZh: '星表数据来自 HYG Database (CC BY-SA 4.0)',
    citationEn: 'Star catalog data from the HYG Database (astronexus), CC BY-SA 4.0.',
    magComplete: 6.5,
    recordCount: 8896,
    refreshPolicy: 'static-build',
    retrievedAt: '2026-07-15T08:00:43.464Z', // bright-stars.json meta.generatedAt（9C 批次）
    notes:
      '核心层 mag≤6.5 全天完备（8896 颗，Hipparcos 完备极限 V≈7.3 之内）；6.5<mag≤7.5 为纯渲染扩展层（16852 颗，stars-extended.json）。HYG 融合 Hipparcos / Yale BSC5 / Gliese 3；自行/B−V 色指数/变星幅度/聚星标记同批取自本表（star-extras.json）。',
  },
  {
    key: 'openngc',
    name: 'OpenNGC',
    publisher: 'Mattia Verga (OpenNGC)',
    url: 'https://github.com/mattiaverga/OpenNGC',
    downloadUrl: 'https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv',
    version: 'master snapshot 2026-07-11',
    license: 'CC-BY-SA-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    citationZh: '深空天体数据来自 OpenNGC (CC-BY-SA-4.0)',
    citationEn: 'Deep-sky object data from OpenNGC, CC-BY-SA-4.0.',
    magComplete: 10,
    recordCount: 574,
    refreshPolicy: 'static-build',
    retrievedAt: '2026-07-15T08:00:44.008Z', // deep-sky.json meta.generatedAt（9C 批次）
    notes: 'Messier 110 全量 + 非 Messier V≤10（464 条）；中文简介为编辑人工撰写。',
  },
  {
    key: 'd3-celestial',
    name: 'd3-celestial 星座连线',
    publisher: 'Olaf Frohn (d3-celestial)',
    url: 'https://github.com/ofrohn/d3-celestial',
    downloadUrl:
      'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.lines.json',
    version: 'master snapshot 2026-07-11',
    license: 'BSD-3-Clause',
    licenseUrl: 'https://github.com/ofrohn/d3-celestial/blob/master/LICENSE',
    citationZh: '星座连线数据来自 d3-celestial (BSD-3-Clause)',
    citationEn: 'Constellation line data from d3-celestial by Olaf Frohn, BSD-3-Clause.',
    recordCount: 88,
    refreshPolicy: 'static-build',
    retrievedAt: '2026-07-15T08:00:43.747Z', // constellation-lines.json meta.generatedAt（9C 批次）
    notes: '88 座 / 743 线段，与 HYG 星表 100% 匹配。',
  },
  {
    key: 'astronomy-engine',
    name: 'astronomy-engine 天文历表',
    publisher: 'Don Cross (cosinekitty/astronomy)',
    url: 'https://github.com/cosinekitty/astronomy',
    version: '^2.1.19',
    license: 'MIT',
    licenseUrl: 'https://github.com/cosinekitty/astronomy/blob/master/LICENSE',
    citationZh: '行星与日月位置由 astronomy-engine (MIT) 实时计算',
    citationEn: 'Solar system ephemerides computed at runtime with astronomy-engine (MIT).',
    refreshPolicy: 'runtime-live',
    retrievedAt: null, // 运行时实时计算，无抓取批次
    notes: '运行时实时计算，无抓取批次；retrievedAt 为登记时间。',
  },
  {
    key: 'jpl-sbdb',
    name: 'JPL Small-Body Database',
    publisher: 'NASA/JPL Solar System Dynamics',
    url: 'https://ssd.jpl.nasa.gov',
    downloadUrl: 'https://ssd-api.jpl.nasa.gov/sbdb_query.api',
    version: 'SBDB Query API v1.0',
    license: 'Public Domain (US Government work)',
    citationZh: '小天体轨道根数来自 NASA/JPL Small-Body Database（美国政府作品·公有领域）',
    citationEn: 'Small-body orbital elements courtesy of NASA/JPL Solar System Dynamics.',
    refreshPolicy: 'runtime-daily',
    retrievedAt: null, // 运行时每日刷新，实际批次时间见 minor_body_elements.fetchedAt
    notes:
      '每日 04:00 拉全量彗星根数，过滤 |tp−now|≤2 年且 M1≤12 的现役亮彗星 + 白名单（1P/2P/12P）+ Ceres/Pallas/Vesta 单体；位置经开普勒/近抛物线方程计算，站内标注「演示级 ±0.5°」。',
  },
  {
    key: 'celestrak',
    name: 'CelesTrak GP/TLE',
    publisher: 'CelesTrak (Dr. T.S. Kelso)',
    url: 'https://celestrak.org',
    downloadUrl: 'https://celestrak.org/NORAD/elements/gp.php',
    version: 'GP API (gp.php)',
    license: '公开数据（无正式许可证；遵守 CelesTrak 官方使用政策）',
    licenseUrl: 'https://celestrak.org/usage-policy.php',
    citationZh: '卫星轨道数据由 CelesTrak 提供',
    citationEn: 'Orbital data courtesy of CelesTrak.',
    refreshPolicy: 'runtime-6h',
    retrievedAt: null, // 运行时每 6h 刷新，实际批次时间见 tle_snapshot.fetchedAt
    notes:
      '服务端集中代理，每 6h 拉取一次（≥ 上游 2h 更新节奏），带 If-Modified-Since；TLE 会过期，站内标注「人造卫星 · 演示精度」。',
  },
  {
    key: 'iau-csn',
    name: 'IAU Catalog of Star Names (IAU-CSN)',
    publisher: 'IAU Working Group on Star Names (WGSN)',
    url: 'https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt',
    downloadUrl: 'https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt',
    version: 'Last updated 2022-04-04（文件实际 451 条；339 条与核心星表 HIP/HD 匹配入库）',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    citationZh:
      '恒星唯一官方专名体系为 IAU 星名工作组（WGSN）的 IAU-CSN 目录（CC BY 4.0，署名 IAU）。本服务的纪念命名为私人象征性纪念，与 IAU 无关，非 IAU 官方命名。',
    citationEn:
      'Official proper names of stars are maintained by the IAU Working Group on Star Names (WGSN) in the IAU Catalog of Star Names (CC BY 4.0, credit: IAU). Memorial dedications on this site are private and symbolic, not IAU designations.',
    recordCount: 451,
    refreshPolicy: 'static-build',
    retrievedAt: '2026-07-15T08:00:43.646Z', // iau-csn-meta.json retrievedAt（build-star-names.mjs 实测）
    notes:
      '已入库（Phase 9C build-star-names.mjs）：文件 451 条全量解析，339 条经 HIP/HD 精确匹配写入 star-extras.json（iauName 列）；未匹配条目多为核心层（mag≤6.5）之外的暗星，绝不猜测匹配。',
  },
  {
    key: 'stellarium-chinese',
    name: 'Stellarium Chinese Sky Culture（中国传统星官）',
    publisher: 'Stellarium（Sun Shuwei 扩充；主要参考伊世同《中西对照恒星图表·星表 1950.0》）',
    url: 'https://github.com/Stellarium/stellarium/tree/master/skycultures/chinese',
    version: '预留（约 300 星官 / 3000+ 中文星名）',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    citationZh: '中国传统星官名来自 Stellarium Chinese Sky Culture（CC BY-SA 4.0，伊世同星表体系）',
    citationEn: 'Chinese traditional star names from the Stellarium Chinese Sky Culture (CC BY-SA 4.0).',
    refreshPolicy: 'static-build',
    retrievedAt: null, // 预留登记：Tier 2 接入后回填
    notes: '预留登记，尚未入库；以 HIP 号为键与 objectUid 天然对齐。',
  },
  {
    key: 'curated',
    name: '星辰纪念编辑数据（精选星档案）',
    publisher: '星辰纪念编辑团队',
    url: 'https://github.com/astronexus/HYG-Database',
    version: 'astro-data 精选星表',
    license: 'CC BY-SA 4.0（衍生自 HYG，随仓库同许可共享）',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    citationZh: '精选星中文档案由星辰纪念编辑团队人工撰写，基础天测数据来自 HYG Database (CC BY-SA 4.0)',
    citationEn:
      'Curated star profiles are hand-written by the site editors; underlying astrometry from the HYG Database (CC BY-SA 4.0).',
    refreshPolicy: 'static-build',
    retrievedAt: '2026-07-15T08:00:43.464Z', // 与 HYG 批次同步（bright-stars.json meta.generatedAt）
    notes: '手写精选条目（sourceCatalog=handwritten）与默认批次（astro-data-seed-v1）都归属本源。',
  },
];

/**
 * 天体批次号（celestial_object.sourceCatalog / CelestialObject.sourceCatalog）
 * → data_source.key 的映射。批次号带版本/形态后缀（'hyg-v41'、'celestrak-tle-snapshot'），
 * 用前缀匹配收敛到主数据 key；未知批次返回 null（前端不显示来源徽章，绝不猜测）。
 */
export function sourceKeyOf(sourceCatalog: string | null | undefined): string | null {
  if (!sourceCatalog) return null;
  if (sourceCatalog === 'handwritten' || sourceCatalog === 'astro-data-seed-v1') return 'curated';
  if (sourceCatalog.startsWith('hyg')) return 'hyg-v41';
  if (sourceCatalog.startsWith('openngc')) return 'openngc';
  if (sourceCatalog.startsWith('d3-celestial')) return 'd3-celestial';
  if (sourceCatalog === 'astronomy-engine') return 'astronomy-engine';
  if (sourceCatalog.startsWith('jpl') || sourceCatalog.includes('sbdb')) return 'jpl-sbdb';
  if (sourceCatalog.startsWith('celestrak')) return 'celestrak';
  if (sourceCatalog.startsWith('iau-csn')) return 'iau-csn';
  if (sourceCatalog.startsWith('stellarium')) return 'stellarium-chinese';
  return null;
}
