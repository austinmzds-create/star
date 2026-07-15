/**
 * 太阳系天体 + 人造卫星 + 小天体的「目录行」适配（仅元数据，零重依赖）。
 *
 * 走 '@star/astro-ephem/bodies' 与 '@star/astro-ephem/minor-meta' 子入口、
 * './satellites/tles' 纯常量：搜索面板 / 信息卡只需要名字、别名、典型星等时，
 * 不把星历引擎 / satellite.js 拖进首屏 bundle。
 *
 * raDeg/decDeg 为占位 0：实时坐标一律由 ephemRegistry（行星日月）/
 * satRegistry（卫星，懒 chunk）/ minorRegistry（小天体，懒 chunk）提供，
 * 渲染/拾取/飞行/可见性全部无视这里的占位值。
 *
 * 合规红线：isNamable 恒为 false——行星/日月/卫星/小天体绝不进入纪念命名池。
 */

import { FULL_CATALOG, getCelestialByUid, type CelestialObject } from '@star/astro-data';
import { listEphemerisBodies } from '@star/astro-ephem/bodies';
import { listMinorBodies } from '@star/astro-ephem/minor-meta';
import { SATELLITE_ROWS } from './satellites/tles';

/** 9 个太阳系天体的 CelestialObject 形状元数据行（坐标占位，非实时）。 */
export const SOLAR_BODY_ROWS: CelestialObject[] = listEphemerisBodies().map((meta) => ({
  objectUid: meta.objectUid,
  type: meta.kind, // 'sun' | 'moon' | 'planet'
  nameEn: meta.nameEn,
  nameZh: meta.nameZh,
  aliases: [...meta.aliases],
  constellation: 'Solar System',
  constellationZh: '太阳系',
  raDeg: 0, // 占位：实时坐标见 ephemRegistry
  decDeg: 0,
  magnitude: meta.typicalMagnitude,
  distanceLy: null, // 太阳系内距离以 AU 计，信息卡单独展示
  catalogIds: {},
  isNamable: false, // 合规红线
  isFeatured: true,
  isEphemeris: true,
  descriptionZh: meta.descriptionZh,
  renderPriority: 100,
  searchPriority: 120,
  sourceCatalog: 'astronomy-engine',
}));

/** 小天体元数据 → 目录行（坐标占位，实时见 minorRegistry；isNamable=false 合规红线）。 */
function minorMetaToRow(meta: ReturnType<typeof listMinorBodies>[number]): CelestialObject {
  return {
    objectUid: meta.objectUid,
    type: meta.kind, // 'asteroid' | 'comet'
    nameEn: meta.nameEn,
    nameZh: meta.nameZh,
    aliases: [...meta.aliases],
    constellation: 'Solar System',
    constellationZh: '太阳系',
    raDeg: 0, // 占位：实时坐标见 minorRegistry
    decDeg: 0,
    magnitude: meta.typicalMagnitude,
    distanceLy: null,
    catalogIds: {},
    isNamable: false, // 合规红线
    isFeatured: true,
    isEphemeris: false,
    descriptionZh: meta.descriptionZh,
    renderPriority: 100,
    searchPriority: 110,
    sourceCatalog: 'jpl-sbdb-elements',
  };
}

/**
 * 内置 6 个小天体（谷神/灶神/智神 + 哈雷/恩克/12P）的元数据行；
 * 9C 起动态彗星经 appendDynamicMinorRows 运行时追加（原地 push 保引用稳定）。
 */
export const MINOR_BODY_ROWS: CelestialObject[] = listMinorBodies().map(minorMetaToRow);

const SOLAR_BY_UID = new Map<string, CelestialObject>(
  SOLAR_BODY_ROWS.map((o) => [o.objectUid, o]),
);
const SATELLITE_BY_UID = new Map<string, CelestialObject>(
  SATELLITE_ROWS.map((o) => [o.objectUid, o]),
);
const MINOR_BY_UID = new Map<string, CelestialObject>(
  MINOR_BODY_ROWS.map((o) => [o.objectUid, o]),
);

/**
 * 全站搜索目录：恒星 + 深空 + 太阳系 + 卫星 + 小天体（引用稳定，
 * searchCelestial 的 WeakMap 索引缓存按目录引用生效，只建一次）。
 */
export const SEARCH_CATALOG: CelestialObject[] = [
  ...FULL_CATALOG,
  ...SOLAR_BODY_ROWS,
  ...SATELLITE_ROWS,
  ...MINOR_BODY_ROWS,
];

/** 按 uid 取任意天体：目录（恒星/深空）→ 太阳系（EPH-）→ 卫星（SAT-）→ 小天体（MB-）。 */
export function getObjectByUid(uid: string): CelestialObject | undefined {
  return (
    getCelestialByUid(uid) ??
    SOLAR_BY_UID.get(uid) ??
    SATELLITE_BY_UID.get(uid) ??
    MINOR_BY_UID.get(uid)
  );
}

/**
 * 运行时追加动态小天体目录行（Phase 9C：minorRegistry 注册动态彗星后调用）。
 * 三处原地更新：MINOR_BODY_ROWS / MINOR_BY_UID / SEARCH_CATALOG——数组引用不变，
 * searchCelestial 的索引缓存按「引用 + 长度」判命中（astro-data search.ts），
 * push 后长度变化自动触发索引重建，新彗星立即可搜。幂等：同 uid 跳过。
 */
export function appendDynamicMinorRows(
  metas: readonly ReturnType<typeof listMinorBodies>[number][],
): void {
  for (const meta of metas) {
    if (MINOR_BY_UID.has(meta.objectUid)) continue;
    const row = minorMetaToRow(meta);
    MINOR_BODY_ROWS.push(row);
    MINOR_BY_UID.set(meta.objectUid, row);
    SEARCH_CATALOG.push(row);
  }
}
