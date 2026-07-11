/**
 * 人造卫星 TLE 快照 + 元数据（纯常量，零 satellite.js 依赖——
 * solarSystem.ts 引本文件不增主 bundle；SGP4 计算见 ./satRegistry，只进懒 chunk）。
 *
 * TLE 快照来源：Celestrak，抓取 2026-07-11：
 *   curl 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE'
 *  （同法 48274 / 20580），返回两行原样粘贴，绝非手编（校验和均通过）。
 *
 * ⚠ TLE 会过期：SGP4 外推误差随 |t−epoch| 增长（数周后达几度乃至发散）。
 * 本产品定位「演示精度」：运行时会尝试从 Celestrak 拉最新（satRegistry），
 * 失败静默回落本快照。合规红线：isNamable=false（由 SATELLITE_ROWS 落实）。
 */

import type { CelestialObject } from '@star/astro-data';

/** objectUid 统一前缀：人造卫星一律 'SAT-' 开头。 */
export const SATELLITE_UID_PREFIX = 'SAT-';

/** 判断某 objectUid 是否为人造卫星。 */
export function isSatelliteUid(uid: string): boolean {
  return uid.startsWith(SATELLITE_UID_PREFIX);
}

/** 单颗卫星的定义（TLE 快照 + 展示元数据）。 */
export interface SatelliteDef {
  uid: string;
  noradId: number;
  nameZh: string;
  nameEn: string;
  aliases: string[];
  colorHex: string;
  /** TLE 两行（line1, line2，各 69 字符）。 */
  tle: [string, string];
  /** 由 line1 第 19–32 列解析出的历元（写死备查；运行时以 parseTleEpoch 为准）。 */
  tleEpochIso: string;
  /** 一句话中文简介（不含任何命名/产权暗示）。 */
  descriptionZh: string;
}

/** 3 颗内置著名卫星（Celestrak TLE 快照，抓取 2026-07-11，历元 2026-07-11）。 */
export const SATELLITE_DEFS: SatelliteDef[] = [
  {
    uid: 'SAT-ISS',
    noradId: 25544,
    nameZh: '国际空间站',
    nameEn: 'ISS (ZARYA)',
    aliases: ['ISS', '空间站', '国际空间站'],
    colorHex: '#9fd8ff',
    tle: [
      '1 25544U 98067A   26192.31485778  .00005525  00000+0  10843-3 0  9998',
      '2 25544  51.6302 180.6822 0006688 282.4935  77.5305 15.48978902575497',
    ],
    tleEpochIso: '2026-07-11T07:33:24Z',
    descriptionZh: '约 400 公里高度、90 分钟绕地一周的载人空间站，是夜空中最亮的人造天体之一。',
  },
  {
    uid: 'SAT-TIANGONG',
    noradId: 48274,
    nameZh: '天宫空间站',
    nameEn: 'CSS (TIANHE)',
    aliases: ['天宫', '天和', '中国空间站', 'CSS'],
    colorHex: '#ffb3a0',
    tle: [
      '1 48274U 21035A   26192.36900667  .00001415  00000+0  22608-4 0  9995',
      '2 48274  41.4687 175.0236 0002483 288.9992  71.0577 15.58018409296943',
    ],
    tleEpochIso: '2026-07-11T08:51:22Z',
    descriptionZh: '中国的载人空间站，运行在约 380 公里高度的近地轨道，天和核心舱于 2021 年发射。',
  },
  {
    uid: 'SAT-HST',
    noradId: 20580,
    nameZh: '哈勃空间望远镜',
    nameEn: 'Hubble Space Telescope',
    aliases: ['哈勃', 'HST', '哈勃望远镜'],
    colorHex: '#e8d8ff',
    tle: [
      '1 20580U 90037B   26192.32864100  .00004115  00000+0  12587-3 0  9994',
      '2 20580  28.4732 275.5444 0002064  68.2345 291.8470 15.31034980792276',
    ],
    tleEpochIso: '2026-07-11T07:53:14Z',
    descriptionZh: '1990 年发射的空间望远镜，在约 520 公里高度环绕地球，深刻改变了人类对宇宙的认知。',
  },
];

/** TLE 行 mod-10 校验（末位为校验位：数字求和 + 负号计 1）。快照与运行时刷新共用。 */
export function tleChecksumOk(line: string): boolean {
  if (line.length !== 69) return false;
  let sum = 0;
  for (let i = 0; i < 68; i++) {
    const ch = line[i]!;
    if (ch >= '0' && ch <= '9') sum += ch.charCodeAt(0) - 48;
    else if (ch === '-') sum += 1;
  }
  return sum % 10 === Number(line[68]);
}

/**
 * 解析 line1 第 19–32 列（1 起）的历元：YYDDD.DDDDDDDD → Date。
 * 两位年按 NORAD 惯例：57–99 → 19xx，00–56 → 20xx。格式非法返回 null。
 */
export function parseTleEpoch(line1: string): Date | null {
  const raw = line1.slice(18, 32).trim();
  const m = /^(\d{2})(\d{3}(?:\.\d+)?)$/.exec(raw);
  if (!m) return null;
  const yy = Number(m[1]);
  const year = yy >= 57 ? 1900 + yy : 2000 + yy;
  const dayOfYear = Number(m[2]);
  if (!(dayOfYear >= 1 && dayOfYear < 367)) return null;
  return new Date(Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86400000);
}

/**
 * 搜索目录用元数据行（CelestialObject 造型）。raDeg/decDeg 为占位 0：
 * 实时坐标一律由 satRegistry（SGP4 站心计算）提供。
 * 合规红线：isNamable 恒为 false——人造卫星绝不进入纪念命名池。
 */
export const SATELLITE_ROWS: CelestialObject[] = SATELLITE_DEFS.map((d) => ({
  objectUid: d.uid,
  type: 'satellite',
  nameEn: d.nameEn,
  nameZh: d.nameZh,
  aliases: [...d.aliases],
  constellation: 'Earth Orbit',
  constellationZh: '近地轨道',
  raDeg: 0, // 占位：实时坐标见 satRegistry
  decDeg: 0,
  magnitude: -1, // 展示占位（信息卡对卫星隐藏星等徽章）
  distanceLy: null,
  catalogIds: { norad: String(d.noradId) },
  isNamable: false, // 合规红线
  isFeatured: true,
  isEphemeris: false,
  descriptionZh: d.descriptionZh,
  renderPriority: 100,
  searchPriority: 110,
  sourceCatalog: 'celestrak-tle-snapshot',
}));
