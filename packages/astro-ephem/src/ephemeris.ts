/**
 * 星历计算核心：太阳/月亮/八大行星的地心 J2000 赤道坐标 + 月相。
 *
 * 基于 astronomy-engine（MIT）。关键约定：
 * - 用 GeoVector + EquatorFromVector 拿【地心 J2000（EQJ）】坐标，
 *   与全站星表（HYG / 手写精选）及 raDecToVector3 同一参考系；
 *   不要用 Equator()——那是站心（topocentric）坐标且必须传观测者。
 * - EquatorFromVector().ra 单位是恒星时【小时】（0–24），出口一律 ×15 转【度】。
 * - astronomy-engine 的 IlluminationInfo 字段是 snake_case（phase_fraction 等），
 *   在本包内立即转 camelCase，把命名怪癖隔离在包边界之内。
 * - 精度说明：地心 vs 站心，行星差 <1 角秒，月亮最大差约 1°；
 *   渲染与信息卡采用地心值（与恒星层同一约定），属产品可接受近似。
 */
import { Body, EquatorFromVector, GeoVector, Illumination, MoonPhase } from 'astronomy-engine';
import type { CelestialObject } from '@star/astro-data';
import {
  getEphemerisBodyMeta,
  type EphemerisBodyId,
} from './bodies';

/** bodyId → astronomy-engine Body 枚举。 */
const BODY_MAP: Record<EphemerisBodyId, Body> = {
  sun: Body.Sun,
  moon: Body.Moon,
  mercury: Body.Mercury,
  venus: Body.Venus,
  mars: Body.Mars,
  jupiter: Body.Jupiter,
  saturn: Body.Saturn,
  uranus: Body.Uranus,
  neptune: Body.Neptune,
};

/** 某时刻的地心 J2000 赤道坐标。 */
export interface EphemerisEquatorial {
  /** 赤经（度，[0, 360)）。 */
  raDeg: number;
  /** 赤纬（度，[-90, 90]）。 */
  decDeg: number;
  /** 地心距离（天文单位 AU）。 */
  distanceAu: number;
}

/** 赤经归一到 [0, 360)。 */
function normalizeRaDeg(raDeg: number): number {
  const r = raDeg % 360;
  return r < 0 ? r + 360 : r;
}

/**
 * 计算某时刻某天体的地心 J2000 赤道坐标。
 * 与星表 raDeg/decDeg 同一参考系，可直接喂给 raDecToVector3 / computeVisibility。
 */
export function getEquatorial(bodyId: EphemerisBodyId, date: Date): EphemerisEquatorial {
  // GeoVector(body, time, aberration=true)：地心 J2000 位置矢量（AU）
  const vec = GeoVector(BODY_MAP[bodyId], date, true);
  // EquatorFromVector：矢量 → { ra: 恒星时小时, dec: 度, dist: AU }
  const eq = EquatorFromVector(vec);
  return {
    raDeg: normalizeRaDeg(eq.ra * 15), // ra 单位是小时，×15 转度
    decDeg: eq.dec,
    distanceAu: eq.dist,
  };
}

/** 月相信息。 */
export interface MoonPhaseInfo {
  /**
   * 月相角（度，[0, 360)，日月地心黄经差）：
   * 0 新月，90 上弦，180 满月，270 下弦。
   */
  phaseAngleDeg: number;
  /** 被照亮比例 0–1。 */
  illumination: number;
}

/** 计算某时刻的月相。 */
export function getMoonPhase(date: Date): MoonPhaseInfo {
  const phaseAngleDeg = MoonPhase(date); // 度，[0, 360)
  const illum = Illumination(Body.Moon, date); // IlluminationInfo（snake_case 字段）
  return { phaseAngleDeg, illumination: illum.phase_fraction };
}

/** 月相角 → 中文相名（按 45° 八分）。 */
export function moonPhaseName(phaseAngleDeg: number): string {
  const names = ['新月', '娥眉月', '上弦月', '盈凸月', '满月', '亏凸月', '下弦月', '残月'] as const;
  // 以每档中心为界：[-22.5, 22.5) 归新月，依此类推
  const idx = Math.floor((((phaseAngleDeg % 360) + 360) % 360 + 22.5) / 45) % 8;
  return names[idx] ?? '新月';
}

/**
 * 生成 CelestialObject 形状的快照（含指定时刻的实时坐标）。
 * 供 api 搜索索引与 web 信息卡直接复用现有渲染/可见性管线。
 *
 * 合规：isNamable 恒为 false（行星/日月绝不入命名池）。
 */
export function toCelestialObject(bodyId: EphemerisBodyId, date: Date): CelestialObject {
  const meta = getEphemerisBodyMeta(bodyId);
  const eq = getEquatorial(bodyId, date);
  return {
    objectUid: meta.objectUid,
    type: meta.kind, // 'sun' | 'moon' | 'planet'
    nameEn: meta.nameEn,
    nameZh: meta.nameZh,
    aliases: meta.aliases,
    constellation: 'Solar System',
    constellationZh: '太阳系',
    raDeg: eq.raDeg,
    decDeg: eq.decDeg,
    magnitude: meta.typicalMagnitude,
    distanceLy: null, // 太阳系内距离以 AU 计，卡片单独展示 distanceAu
    catalogIds: {},
    isNamable: false,
    isFeatured: true,
    isEphemeris: true,
    descriptionZh: meta.descriptionZh,
    renderPriority: 100,
    searchPriority: 120, // 高于精选恒星（100）：搜「火星」必中第一
    sourceCatalog: 'astronomy-engine',
  };
}
