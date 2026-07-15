/**
 * 数据源登记表（Phase 9C 公信力体系，Web 端静态镜像）。
 *
 * 与 services/api/src/data-source/data-source.constants.ts 同口径：那边是
 * DB seed / API 回退的单一事实源，这边是纯前端（/credits 页 + 天体卡来源
 * 徽章）的静态副本——Web 端不依赖后端可用性也必须能履行署名义务。
 *
 * 【数据纪律】license / citation 逐字来自各源官方口径（调研报告 r-data.md §2、
 * packages/astro-data/src/generated/*.json 的 meta 块与 docs/credits.md 已核对），
 * 绝不编造；retrievedAt 为 null 表示「运行时实时计算/刷新，无静态抓取批次」。
 *
 * 【合规红线】任何文案不得含「买星星 / 产权 / 官方命名 / IAU 认证」表述；
 * 唯一例外：IAU-CSN 行的免责声明按红线要求反向引用 IAU-CSN 作为权威锚点。
 */

/** 单个数据源的登记信息（/credits 页整节渲染；badge 供天体卡小徽章）。 */
export interface DataSourceInfo {
  /** 稳定 key（与 api 侧 data_source.key 对齐）。 */
  key: string;
  /** 徽章短名（天体卡「数据 · {badge}」）。 */
  badge: string;
  name: string;
  publisher: string;
  version: string;
  license: string;
  licenseUrl?: string;
  /** 标准致谢句（中文，逐字口径）。 */
  citationZh: string;
  /** 标准致谢句（英文原文，有官方句式的源逐字收录）。 */
  citationEn?: string;
  homepageUrl: string;
  /** ISO 抓取时间；null = 运行时实时计算/刷新。 */
  retrievedAt: string | null;
  /** 数量/完备极限等补充说明。 */
  notes?: string;
}

/**
 * 全部数据源（顺序即 /credits 页展示顺序）。
 * retrievedAt / 记录数取自 packages/astro-data/src/generated/*.json 的
 * meta 块（ETL 实测值，2026-07-15 批次），不做任何估算。
 */
export const DATA_SOURCES: readonly DataSourceInfo[] = [
  {
    key: 'hyg-v41',
    badge: 'HYG v4.1',
    name: 'HYG Database v4.1',
    publisher: 'astronexus (David Nash)',
    version: 'v41',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    citationZh: '星表数据来自 HYG Database (CC BY-SA 4.0)',
    citationEn: 'Star catalog data from the HYG Database (astronexus), CC BY-SA 4.0.',
    homepageUrl: 'https://www.astronexus.com/projects/hyg',
    retrievedAt: '2026-07-15T08:00:43Z', // bright-stars.json / star-extras.json meta.generatedAt
    notes:
      '核心层 mag≤6.5 全天完备（8,896 颗，处于 Hipparcos 完备极限 V≈7.3 之内）；' +
      '6.5<mag≤7.5 为纯渲染增强层（16,852 颗）。HYG 融合 Hipparcos / Yale BSC5 / Gliese 3；' +
      '自行（pmra/pmdec）、B−V 色指数、变星幅度与双星/聚星标记同批取自本表。',
  },
  {
    key: 'iau-csn',
    badge: 'IAU-CSN',
    name: 'IAU Catalog of Star Names (IAU-CSN)',
    publisher: 'IAU Division C · Working Group on Star Names (WGSN)',
    version: 'Last updated 2022-04-04（451 条；339 条与站内星表匹配）',
    license: 'CC BY 4.0（署名 IAU）',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    citationZh:
      '官方星名来自 IAU Catalog of Star Names（IAU Working Group on Star Names，CC BY 4.0，署名 IAU）。' +
      '本服务的纪念命名为私人象征性纪念，非 IAU 官方命名；恒星唯一官方专名体系见 IAU-CSN。',
    citationEn:
      'Official proper names of stars are maintained by the IAU Working Group on Star Names (WGSN) ' +
      'in the IAU Catalog of Star Names (CC BY 4.0, credit: IAU). Memorial dedications on this site ' +
      'are private and symbolic, not IAU designations.',
    homepageUrl: 'https://www.iau.org/public/themes/naming_stars/',
    retrievedAt: '2026-07-15T08:00:43Z', // iau-csn-meta.json retrievedAt
    notes: '带「IAU 官方星名」金边徽章的恒星均出自本名录（HIP/HD 号精确匹配，绝不猜测）。',
  },
  {
    key: 'openngc',
    badge: 'OpenNGC',
    name: 'OpenNGC',
    publisher: 'Mattia Verga (OpenNGC)',
    version: 'master snapshot 2026-07-11',
    license: 'CC-BY-SA-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    citationZh: '深空天体数据来自 OpenNGC (CC-BY-SA-4.0)',
    citationEn: 'Deep-sky object data from OpenNGC, CC-BY-SA-4.0.',
    homepageUrl: 'https://github.com/mattiaverga/OpenNGC',
    retrievedAt: '2026-07-15T08:00:44Z', // deep-sky.json meta.generatedAt
    notes: 'Messier 110 全量 + 非 Messier V≤10，共 574 条；中文简介为编辑人工撰写（参考公开资料）。',
  },
  {
    key: 'd3-celestial',
    badge: 'd3-celestial',
    name: 'd3-celestial 星座连线',
    publisher: 'Olaf Frohn (d3-celestial)',
    version: 'master snapshot 2026-07-11',
    license: 'BSD-3-Clause',
    licenseUrl: 'https://github.com/ofrohn/d3-celestial/blob/master/LICENSE',
    citationZh: '星座连线数据来自 d3-celestial (BSD-3-Clause)',
    citationEn: 'Constellation line data from d3-celestial by Olaf Frohn, BSD-3-Clause.',
    homepageUrl: 'https://github.com/ofrohn/d3-celestial',
    retrievedAt: '2026-07-15T08:00:43Z', // constellation-lines.json meta.generatedAt
    notes: '88 座 / 743 线段，与 HYG 星表 100% 匹配。',
  },
  {
    key: 'astronomy-engine',
    badge: '星历计算',
    name: 'astronomy-engine 天文历表',
    publisher: 'Don Cross (cosinekitty/astronomy)',
    version: '^2.1.19',
    license: 'MIT',
    licenseUrl: 'https://github.com/cosinekitty/astronomy/blob/master/LICENSE',
    citationZh: '行星与日月位置由 astronomy-engine (MIT) 实时计算',
    citationEn: 'Solar system ephemerides computed at runtime with astronomy-engine (MIT).',
    homepageUrl: 'https://github.com/cosinekitty/astronomy',
    retrievedAt: null, // 运行时实时计算，无抓取批次
    notes: '行星/日月坐标、升落中天、月相与天象日历事件均由本库运行时计算。',
  },
  {
    key: 'jpl-sbdb',
    badge: 'JPL SBDB',
    name: 'JPL Small-Body Database',
    publisher: 'NASA/JPL Solar System Dynamics',
    version: 'SBDB Query API v1.0',
    license: 'Public Domain (US Government work)',
    citationZh: '小天体轨道根数来自 NASA/JPL Small-Body Database（美国政府作品·公有领域）',
    citationEn: 'Small-body orbital elements courtesy of NASA/JPL Solar System Dynamics.',
    homepageUrl: 'https://ssd.jpl.nasa.gov',
    retrievedAt: null, // 服务端每日刷新，实际批次时间见 /api/v1/minor-bodies 的 updatedAt
    notes:
      '彗星/小行星根数由站内服务端每日自 SBDB Query API 刷新，' +
      '内置快照兜底；位置经开普勒/近抛物线方程计算，站内标注「演示级 ±0.5°」。',
  },
  {
    key: 'celestrak',
    badge: 'Celestrak',
    name: 'CelesTrak GP/TLE',
    publisher: 'CelesTrak (Dr. T.S. Kelso)',
    version: 'GP API (gp.php)',
    license: '公开数据（无正式许可证；遵守 CelesTrak 官方使用政策）',
    licenseUrl: 'https://celestrak.org/usage-policy.php',
    citationZh: '卫星轨道数据由 CelesTrak 提供',
    citationEn: 'Orbital data courtesy of CelesTrak.',
    homepageUrl: 'https://celestrak.org',
    retrievedAt: null, // 服务端每 6h 刷新，实际批次时间见 /api/v1/tle 的 updatedAt
    notes:
      '由站内服务端集中代理刷新（尊重上游 2 小时更新节奏，客户端不直连），' +
      'SGP4 推算，TLE 会过期，站内标注「人造卫星 · 演示精度」。',
  },
  {
    key: 'satellite-js',
    badge: 'satellite.js',
    name: 'satellite.js（SGP4 轨道传播库）',
    publisher: 'shashwatak/satellite-js',
    version: 'npm 依赖（见仓库锁文件）',
    license: 'MIT',
    licenseUrl: 'https://github.com/shashwatak/satellite-js/blob/develop/LICENSE',
    citationZh: '卫星位置由 satellite.js (MIT) 以 SGP4 模型推算',
    citationEn: 'Satellite positions propagated with satellite.js (MIT, SGP4).',
    homepageUrl: 'https://github.com/shashwatak/satellite-js',
    retrievedAt: null, // 运行时实时计算
  },
  {
    key: 'meteor-showers',
    badge: '流星雨常识表',
    name: '流星雨常识表（内置静态常量）',
    publisher: '星辰纪念编辑团队（历表可参考 IMO 公开日历）',
    version: '约 10 大流星雨（极大期 ±1 天近似）',
    license: '公域天文常识（编辑整理）',
    citationZh: '流星雨极大期/ZHR/辐射点为公域天文常识的编辑整理，历表可参考国际流星组织（IMO）',
    homepageUrl: 'https://www.imo.net',
    retrievedAt: null, // 内置静态常量，随仓库版本演进
    notes: '不复制任何受版权保护的日历表格原文；仅收录公域常识口径的数值。',
  },
  {
    key: 'curated',
    badge: 'HYG v4.1',
    name: '星辰纪念编辑数据（精选星档案）',
    publisher: '星辰纪念编辑团队',
    version: 'astro-data 精选星表',
    license: 'CC BY-SA 4.0（衍生自 HYG，随仓库同许可共享）',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    citationZh:
      '精选星中文档案由星辰纪念编辑团队人工撰写，基础天测数据来自 HYG Database (CC BY-SA 4.0)',
    citationEn:
      'Curated star profiles are hand-written by the site editors; ' +
      'underlying astrometry from the HYG Database (CC BY-SA 4.0).',
    homepageUrl: 'https://www.astronexus.com/projects/hyg',
    retrievedAt: '2026-07-15T08:00:43Z', // 与 HYG 批次同步
    notes: '手写精选条目的坐标/星等/光谱型均取自 HYG，绝不编造；徽章按基础天测来源显示 HYG。',
  },
] as const;

const SOURCE_BY_KEY = new Map<string, DataSourceInfo>(DATA_SOURCES.map((s) => [s.key, s]));

/**
 * 天体批次号（CelestialObject.sourceCatalog）→ 数据源登记行。
 * 与 api 侧 sourceKeyOf 同规则（前缀匹配收敛）；未知批次返回 null——
 * 前端不显示来源徽章，绝不猜测来源（数据纪律）。
 */
export function sourceInfoOf(sourceCatalog: string | null | undefined): DataSourceInfo | null {
  if (!sourceCatalog) return null;
  let key: string | null = null;
  if (sourceCatalog === 'handwritten' || sourceCatalog === 'astro-data-seed-v1') key = 'curated';
  else if (sourceCatalog.startsWith('hyg')) key = 'hyg-v41';
  else if (sourceCatalog.startsWith('openngc')) key = 'openngc';
  else if (sourceCatalog.startsWith('d3-celestial')) key = 'd3-celestial';
  else if (sourceCatalog === 'astronomy-engine') key = 'astronomy-engine';
  else if (sourceCatalog.startsWith('jpl') || sourceCatalog.includes('sbdb')) key = 'jpl-sbdb';
  else if (sourceCatalog.startsWith('celestrak')) key = 'celestrak';
  else if (sourceCatalog.startsWith('iau-csn')) key = 'iau-csn';
  if (!key) return null;
  return SOURCE_BY_KEY.get(key) ?? null;
}

/**
 * 「星等完备极限」声明（学术级诚实 = 公信力差异化，r-data.md §4-5）。
 * 数字取自 ETL 产物 meta 块实测值，改 ETL 阈值时必须同步更新。
 */
export const MAG_COMPLETENESS_LINES: readonly string[] = [
  '恒星：视星等 mag ≤ 6.5 全天完备（核心层 8,896 颗，处于 Hipparcos 完备极限 V≈7.3 之内）；6.5–7.5 等为渲染增强层（16,852 颗，仅参与渲染、不进目录检索）。',
  '深空天体：Messier 110 个全量收录 + NGC/IC 目录 V ≤ 10（合计 574 条）。',
  '太阳系小天体与人造卫星为演示级精选集，不做完备性承诺（站内逐卡标注演示精度）。',
] as const;

/** 全站统一免责句（合规核心，页脚/命名弹窗/来源页共用，改动须三处同步）。 */
export const DISCLAIMER_ZH =
  '本平台提供基于真实星体坐标的私人纪念命名登记，不代表国际天文学联合会（IAU）或任何官方机构命名；恒星的官方专名以 IAU-CSN 名录为准。';
