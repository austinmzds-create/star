/**
 * 天象事件计算模块（Phase 6B：天象日历）。
 *
 * 只做「事件搜索」——月相四相 / 日月食 / 行星合月与行星合 / 大距 / 冲日 /
 * 二分二至 / 超级月亮 / 流星雨（静态表）；坐标计算仍走 ephemeris.ts。
 *
 * 约定：
 * - 全部时间出入口用 epoch ms（UTC）；astronomy-engine 的 AstroTime
 *   不出包边界（统一 .date.getTime() 转出）。
 * - 事件时刻由天文算法计算，供观星参考；日食/月食为全球性天象，
 *   本地可见性文案固定为「另查当地可见区」（合规措辞，绝不承诺可见）。
 * - 性能：12 个月全量事件 ≈ 150–250ms（合相粗采样为大头），UI 层按类别
 *   分片调用让出主线程；如未来加轨道计算再评估 worker 化。
 */
import {
  AngleBetween,
  Body,
  Ecliptic,
  GeoVector,
  NextGlobalSolarEclipse,
  NextLunarEclipse,
  NextMoonQuarter,
  Observer,
  PairLongitude,
  SearchGlobalSolarEclipse,
  SearchHourAngle,
  SearchLunarEclipse,
  SearchMaxElongation,
  SearchMoonQuarter,
  SearchRelativeLongitude,
  SearchRiseSet,
  Seasons,
} from 'astronomy-engine';
import { getEphemerisBodyMeta, type EphemerisBodyId } from './bodies';

// ── 类型定义 ──

/** 事件类别（区分联合的判别键）。 */
export type AlmanacEventKind =
  | 'moon-quarter'
  | 'lunar-eclipse'
  | 'solar-eclipse'
  | 'conjunction'
  | 'max-elongation'
  | 'opposition'
  | 'season'
  | 'supermoon'
  | 'meteor-shower';

interface AlmanacEventBase {
  /** 稳定去重键（.ics UID / React key / 提醒登记共用）。 */
  id: string;
  kind: AlmanacEventKind;
  /** 事件峰值/精确时刻（UTC epoch ms）。 */
  timeMs: number;
  /** 流星雨等只精确到「日」的事件为 true，UI 不显示具体时分。 */
  allDay?: boolean;
  /** 中文标题，如「满月」「木星冲日」「英仙座流星雨极大」。 */
  titleZh: string;
  /** 一两句人话描述（含合规/可见性措辞）。 */
  descriptionZh: string;
  /** 星图深链目标（EPH-/HIP/M uid），无则不出「在星图中查看」。 */
  focusUid?: string;
  /** 流星雨辐射点所在星座 IAU 缩写（深链 ?con= 用）。 */
  focusConstellation?: string;
}

export interface MoonQuarterEvent extends AlmanacEventBase {
  kind: 'moon-quarter';
  /** 0 新月 / 1 上弦 / 2 满月 / 3 下弦（astronomy-engine MoonQuarter.quarter 语义）。 */
  quarter: 0 | 1 | 2 | 3;
}
export interface LunarEclipseEvent extends AlmanacEventBase {
  kind: 'lunar-eclipse';
  /** EclipseKind 字符串枚举原值。 */
  eclipseKind: 'penumbral' | 'partial' | 'total';
  /** 食甚时月面被本影遮蔽比例 0–1（半影月食为 0）。 */
  obscuration: number;
  /** 偏食阶段全长（分钟，sd_partial × 2；0 表示无偏食阶段）。 */
  partialDurationMin: number;
  /** 全食阶段全长（分钟，sd_total × 2）。 */
  totalDurationMin: number;
}
export interface SolarEclipseEvent extends AlmanacEventBase {
  kind: 'solar-eclipse';
  eclipseKind: 'partial' | 'annular' | 'total';
  /** 仅 total/annular 有定义（astronomy-engine .d.ts 明示）。 */
  obscuration?: number;
  /** 食甚点纬度（度），仅 total/annular。 */
  peakLatDeg?: number;
  /** 食甚点经度（度），仅 total/annular。 */
  peakLonDeg?: number;
}
export interface ConjunctionEvent extends AlmanacEventBase {
  kind: 'conjunction';
  /** 约定 body1 为月亮或较亮者（展示排序）。 */
  body1: EphemerisBodyId;
  body2: EphemerisBodyId;
  /** 峰值时刻真实角距（度，AngleBetween）。 */
  separationDeg: number;
  /** 距太阳角距（度）；<15° 时 description 注明「近太阳，观测困难」。 */
  elongationFromSunDeg: number;
}
export interface MaxElongationEvent extends AlmanacEventBase {
  kind: 'max-elongation';
  body: 'mercury' | 'venus';
  elongationDeg: number;
  /** ElongationEvent.visibility 原值：morning 晨见（西大距）/ evening 昏见（东大距）。 */
  visibility: 'morning' | 'evening';
}
export interface OppositionEvent extends AlmanacEventBase {
  kind: 'opposition';
  body: 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune';
}
export interface SeasonEvent extends AlmanacEventBase {
  kind: 'season';
  season: 'mar-equinox' | 'jun-solstice' | 'sep-equinox' | 'dec-solstice';
}
export interface SupermoonEvent extends AlmanacEventBase {
  kind: 'supermoon';
  /** 满月时刻地心距（千米）。 */
  distanceKm: number;
}
export interface MeteorShowerEvent extends AlmanacEventBase {
  kind: 'meteor-shower';
  showerId: string;
  zhr: number;
  radiantRaDeg: number;
  radiantDecDeg: number;
}

export type AlmanacEvent =
  | MoonQuarterEvent
  | LunarEclipseEvent
  | SolarEclipseEvent
  | ConjunctionEvent
  | MaxElongationEvent
  | OppositionEvent
  | SeasonEvent
  | SupermoonEvent
  | MeteorShowerEvent;

// ── 内部工具 ──

/** bodyId → astronomy-engine Body（本模块用到的子集 + 太阳）。 */
const AE_BODY: Record<EphemerisBodyId, Body> = {
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

const DAY_MS = 86_400_000;
/** AU → km（IAU 2012 定义值）。 */
const AU_KM = 1.495978707e8;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** UTC yyyymmdd（事件 id 用）。 */
function ymdUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}

/** 角度 wrap 到 (-180, 180]。 */
function wrapDeltaDeg(deg: number): number {
  let x = deg % 360;
  if (x > 180) x -= 360;
  if (x <= -180) x += 360;
  return x;
}

// ── 月相四相 ──

const QUARTER_TITLES = ['新月', '上弦月', '满月', '下弦月'] as const;
const QUARTER_ID_CODES = ['new', 'first', 'full', 'last'] as const;
const QUARTER_DESCRIPTIONS = [
  '月亮与太阳同方向，整夜无月，是观测银河与暗弱深空天体的最佳窗口。',
  '上半夜可见半轮明月，日落后高悬于南方天空。',
  '月亮整夜可见，月光皎洁；适合赏月，不宜观测暗弱深空天体。',
  '半轮明月于后半夜升起，黎明前位于南方天空。',
] as const;

/** 枚举窗口内的月相四相（新月/上弦/满月/下弦）。12 个月约 49–50 条。 */
export function computeMoonQuarters(fromMs: number, toMs: number): MoonQuarterEvent[] {
  const out: MoonQuarterEvent[] = [];
  let mq = SearchMoonQuarter(new Date(fromMs));
  while (mq.time.date.getTime() < toMs) {
    const quarter = mq.quarter as 0 | 1 | 2 | 3;
    const timeMs = mq.time.date.getTime();
    out.push({
      id: `quarter-${QUARTER_ID_CODES[quarter]}-${ymdUtc(timeMs)}`,
      kind: 'moon-quarter',
      timeMs,
      quarter,
      titleZh: QUARTER_TITLES[quarter],
      descriptionZh: QUARTER_DESCRIPTIONS[quarter],
      focusUid: 'EPH-MOON',
    });
    mq = NextMoonQuarter(mq);
  }
  return out;
}

// ── 日月食 ──

const LUNAR_ECLIPSE_TITLES: Record<LunarEclipseEvent['eclipseKind'], string> = {
  penumbral: '半影月食',
  partial: '月偏食',
  total: '月全食',
};
const SOLAR_ECLIPSE_TITLES: Record<SolarEclipseEvent['eclipseKind'], string> = {
  partial: '日偏食',
  annular: '日环食',
  total: '日全食',
};

/** 日月食统一可见性合规措辞（全球事件，绝不承诺本地可见）。 */
const ECLIPSE_VISIBILITY_NOTE =
  '全球性天象，本地能否看到需另查当地可见区；本站仅给出食甚时刻（UTC 换算北京时间）。';

/** 枚举窗口内的月食与日食（全球事件）。 */
export function computeEclipses(
  fromMs: number,
  toMs: number,
): Array<LunarEclipseEvent | SolarEclipseEvent> {
  const out: Array<LunarEclipseEvent | SolarEclipseEvent> = [];

  // 月食：SearchLunarEclipse → NextLunarEclipse 链式枚举
  let le = SearchLunarEclipse(new Date(fromMs));
  while (le.peak.date.getTime() < toMs) {
    const eclipseKind = le.kind as LunarEclipseEvent['eclipseKind'];
    const timeMs = le.peak.date.getTime();
    const penumbralNote =
      eclipseKind === 'penumbral' ? '半影月食时月面仅轻微变暗，肉眼几乎不可察。' : '';
    out.push({
      id: `leclipse-${ymdUtc(timeMs)}`,
      kind: 'lunar-eclipse',
      timeMs,
      eclipseKind,
      obscuration: le.obscuration,
      partialDurationMin: le.sd_partial * 2,
      totalDurationMin: le.sd_total * 2,
      titleZh: LUNAR_ECLIPSE_TITLES[eclipseKind],
      descriptionZh: `${ECLIPSE_VISIBILITY_NOTE}${penumbralNote}`,
      focusUid: 'EPH-MOON',
    });
    le = NextLunarEclipse(le.peak);
  }

  // 日食：SearchGlobalSolarEclipse → NextGlobalSolarEclipse 链式枚举
  let se = SearchGlobalSolarEclipse(new Date(fromMs));
  while (se.peak.date.getTime() < toMs) {
    const eclipseKind = se.kind as SolarEclipseEvent['eclipseKind'];
    const timeMs = se.peak.date.getTime();
    // latitude/longitude 仅 total/annular 有值（partial 时为 undefined，勿使用）
    const central = eclipseKind !== 'partial' && se.latitude != null && se.longitude != null;
    const peakNote = central
      ? `食甚点位于纬度 ${se.latitude!.toFixed(1)}° 经度 ${se.longitude!.toFixed(1)}° 附近。`
      : '';
    out.push({
      id: `seclipse-${ymdUtc(timeMs)}`,
      kind: 'solar-eclipse',
      timeMs,
      eclipseKind,
      ...(central ? { obscuration: se.obscuration, peakLatDeg: se.latitude, peakLonDeg: se.longitude } : {}),
      titleZh: SOLAR_ECLIPSE_TITLES[eclipseKind],
      descriptionZh: `${ECLIPSE_VISIBILITY_NOTE}${peakNote}`,
      // 食甚时刻日月同向，travelTo 后聚焦太阳即见
      focusUid: 'EPH-SUN',
    });
    se = NextGlobalSolarEclipse(se.peak);
  }

  return out;
}

// ── 行星合月 / 行星合 ──

/** 合相收录阈值：峰值真实角距 < 2°。 */
export const CONJUNCTION_MAX_SEP_DEG = 2;

/** 参与合相搜索的天体：月亮 + 五颗肉眼行星（天海王星为事件噪音，不参与）。 */
const CONJUNCTION_BODIES: readonly EphemerisBodyId[] = [
  'moon',
  'mercury',
  'venus',
  'mars',
  'jupiter',
  'saturn',
];

/** 合相配对：月亮 × 5 行星 + 行星两两 C(5,2)=10，共 15 对。 */
function conjunctionPairs(): Array<[EphemerisBodyId, EphemerisBodyId]> {
  const pairs: Array<[EphemerisBodyId, EphemerisBodyId]> = [];
  const planets = CONJUNCTION_BODIES.filter((b) => b !== 'moon');
  for (const p of planets) pairs.push(['moon', p]);
  for (let i = 0; i < planets.length; i++) {
    for (let j = i + 1; j < planets.length; j++) {
      pairs.push([planets[i]!, planets[j]!]);
    }
  }
  return pairs;
}

/**
 * 搜索窗口内的合相事件（两天体地心黄经差过零且角距 < 2°）。
 *
 * 算法（两级）：
 * 1. 逐日采样每个天体的地心黄经（λ 按天体缓存一遍，15 个配对共享——
 *    这就是不用 PairLongitude 做粗扫的原因：它每次调用重算两颗天体）。
 * 2. Δλ wrap 到 (-180,180]，相邻两天符号翻转且 |Δλ| 均 < 90°
 *    （排除 ±180 跳变的假翻转）即为「合」候选。月亮 ~12°/天、行星对
 *    <3°/天，日采样必能桥架真实过零。
 * 3. 候选日内对 PairLongitude 的 wrap 值二分 25 次（精度 <1 分钟）。
 * 4. 峰值时刻真实角距（AngleBetween）≥ 2° 丢弃。
 */
export function computeConjunctions(fromMs: number, toMs: number): ConjunctionEvent[] {
  const days = Math.ceil((toMs - fromMs) / DAY_MS) + 1;

  // 1. 逐日黄经采样（按天体缓存，配对共享）
  const lonByBody = new Map<EphemerisBodyId, Float64Array>();
  for (const b of CONJUNCTION_BODIES) {
    const arr = new Float64Array(days);
    for (let i = 0; i < days; i++) {
      arr[i] = Ecliptic(GeoVector(AE_BODY[b], new Date(fromMs + i * DAY_MS), false)).elon;
    }
    lonByBody.set(b, arr);
  }

  const out: ConjunctionEvent[] = [];
  for (const [a, b] of conjunctionPairs()) {
    const la = lonByBody.get(a)!;
    const lb = lonByBody.get(b)!;
    for (let i = 0; i < days - 1; i++) {
      const d0 = wrapDeltaDeg(la[i]! - lb[i]!);
      const d1 = wrapDeltaDeg(la[i + 1]! - lb[i + 1]!);
      // 符号翻转 + 双端 |Δλ|<90（排除 ±180 跳变假翻转）
      if (Math.abs(d0) >= 90 || Math.abs(d1) >= 90 || (d0 < 0) === (d1 < 0)) continue;

      // 2. 候选日内二分精化（PairLongitude 单次调用便宜，只在窗口内用）
      let lo = fromMs + i * DAY_MS;
      let hi = lo + DAY_MS;
      const f = (ms: number): number =>
        wrapDeltaDeg(PairLongitude(AE_BODY[a], AE_BODY[b], new Date(ms)));
      let flo = f(lo);
      for (let k = 0; k < 25; k++) {
        const mid = (lo + hi) / 2;
        const fm = f(mid);
        if ((flo < 0) !== (fm < 0)) {
          hi = mid;
        } else {
          lo = mid;
          flo = fm;
        }
      }
      const tStar = Math.round((lo + hi) / 2);
      if (tStar < fromMs || tStar >= toMs) continue;

      // 3. 峰值真实角距过滤
      const tDate = new Date(tStar);
      const va = GeoVector(AE_BODY[a], tDate, false);
      const vb = GeoVector(AE_BODY[b], tDate, false);
      const separationDeg = AngleBetween(va, vb);
      if (separationDeg >= CONJUNCTION_MAX_SEP_DEG) continue;

      // 4. body1 = 月亮或较亮者（典型星等小者）
      let body1 = a;
      let body2 = b;
      if (a !== 'moon' && b !== 'moon') {
        const magA = getEphemerisBodyMeta(a).typicalMagnitude;
        const magB = getEphemerisBodyMeta(b).typicalMagnitude;
        if (magB < magA) {
          body1 = b;
          body2 = a;
        }
      }

      const vSun = GeoVector(Body.Sun, tDate, false);
      const elongationFromSunDeg = AngleBetween(
        GeoVector(AE_BODY[body2], tDate, false),
        vSun,
      );
      const nearSunNote =
        elongationFromSunDeg < 15 ? '此时距太阳较近，实际难以观测。' : '';

      const isMoon = body1 === 'moon';
      const planetZh = getEphemerisBodyMeta(body2).nameZh;
      const titleZh = isMoon ? `${planetZh}合月` : `${getEphemerisBodyMeta(body1).nameZh}合${planetZh}`;
      const descriptionZh = isMoon
        ? `月亮从${planetZh}近旁掠过，角距最小约 ${separationDeg.toFixed(1)}°，几乎同框。${nearSunNote}`
        : `${getEphemerisBodyMeta(body1).nameZh}与${planetZh}在天空中靠近，角距最小约 ${separationDeg.toFixed(1)}°。${nearSunNote}`;

      out.push({
        id: `conj-${body1}-${body2}-${ymdUtc(tStar)}`,
        kind: 'conjunction',
        timeMs: tStar,
        body1,
        body2,
        separationDeg,
        elongationFromSunDeg,
        titleZh,
        descriptionZh,
        // 深链聚焦：月合取行星，双行星取较亮者（body1 已排好序）
        focusUid: isMoon
          ? getEphemerisBodyMeta(body2).objectUid
          : getEphemerisBodyMeta(body1).objectUid,
      });
    }
  }
  return out;
}

// ── 大距（水金）与冲日（外行星） ──

const OPPOSITION_BODIES = ['mars', 'jupiter', 'saturn', 'uranus', 'neptune'] as const;

/** 搜索窗口内的水星/金星大距与外行星冲日。 */
export function computeElongationsOppositions(
  fromMs: number,
  toMs: number,
): Array<MaxElongationEvent | OppositionEvent> {
  const out: Array<MaxElongationEvent | OppositionEvent> = [];

  // 大距：水星 / 金星
  for (const b of ['mercury', 'venus'] as const) {
    let ev = SearchMaxElongation(AE_BODY[b], new Date(fromMs));
    while (ev.time.date.getTime() < toMs) {
      const timeMs = ev.time.date.getTime();
      const visibility = ev.visibility as 'morning' | 'evening';
      const nameZh = getEphemerisBodyMeta(b).nameZh;
      const isEvening = visibility === 'evening';
      out.push({
        id: `elong-${b}-${ymdUtc(timeMs)}`,
        kind: 'max-elongation',
        timeMs,
        body: b,
        elongationDeg: ev.elongation,
        visibility,
        titleZh: `${nameZh}${isEvening ? '东大距' : '西大距'}`,
        descriptionZh: `${nameZh}到达距太阳最大角距约 ${ev.elongation.toFixed(1)}°，${
          isEvening ? '日落后西方低空可见（昏见）' : '日出前东方低空可见（晨见）'
        }，是观测${nameZh}的好时机。`,
        focusUid: getEphemerisBodyMeta(b).objectUid,
      });
      ev = SearchMaxElongation(AE_BODY[b], ev.time.AddDays(1));
    }
  }

  // 冲日：外行星（targetRelLon=0，.d.ts 明示外行星冲日用法）
  for (const b of OPPOSITION_BODIES) {
    let t = SearchRelativeLongitude(AE_BODY[b], 0, new Date(fromMs));
    while (t.date.getTime() < toMs) {
      const timeMs = t.date.getTime();
      const nameZh = getEphemerisBodyMeta(b).nameZh;
      out.push({
        id: `opp-${b}-${ymdUtc(timeMs)}`,
        kind: 'opposition',
        timeMs,
        body: b,
        titleZh: `${nameZh}冲日`,
        descriptionZh: `${nameZh}运行到与太阳相对的方向，整夜可见且距地球较近，是一年中观测${nameZh}的最佳时机。`,
        focusUid: getEphemerisBodyMeta(b).objectUid,
      });
      t = SearchRelativeLongitude(AE_BODY[b], 0, t.AddDays(1));
    }
  }

  return out;
}

// ── 二分二至 ──

const SEASON_DEFS = [
  { season: 'mar-equinox', field: 'mar_equinox', titleZh: '春分（天文）', lonDeg: 0 },
  { season: 'jun-solstice', field: 'jun_solstice', titleZh: '夏至（天文）', lonDeg: 90 },
  { season: 'sep-equinox', field: 'sep_equinox', titleZh: '秋分（天文）', lonDeg: 180 },
  { season: 'dec-solstice', field: 'dec_solstice', titleZh: '冬至（天文）', lonDeg: 270 },
] as const;

/** 搜索窗口内的二分二至（天文时刻，非农历节气日）。 */
export function computeSeasons(fromMs: number, toMs: number): SeasonEvent[] {
  const out: SeasonEvent[] = [];
  const fromYear = new Date(fromMs).getUTCFullYear();
  const toYear = new Date(toMs).getUTCFullYear();
  for (let year = fromYear; year <= toYear; year++) {
    const info = Seasons(year);
    for (const def of SEASON_DEFS) {
      const timeMs = info[def.field].date.getTime();
      if (timeMs < fromMs || timeMs >= toMs) continue;
      out.push({
        id: `season-${def.season}-${year}`,
        kind: 'season',
        timeMs,
        season: def.season,
        titleZh: def.titleZh,
        descriptionZh: `太阳到达黄经 ${def.lonDeg}° 的精确时刻（天文定义，与农历节气日期可能相差一日内）。`,
        focusUid: 'EPH-SUN',
      });
    }
  }
  return out;
}

// ── 超级月亮 ──

/**
 * 超级月亮距离阈值（km）：满月时刻地心距 ≤ 36.33 万 km 即记为超级月亮。
 * 超级月亮无统一学术定义，此处取常用媒体定义之一的近似阈值
 * （此距离下视直径比平均满月大约 7%）。
 */
export const SUPERMOON_MAX_DISTANCE_KM = 363_300;

/** 搜索窗口内的超级月亮（满月 + 距离阈值判定，与满月事件并存、id 不同）。 */
export function computeSupermoons(fromMs: number, toMs: number): SupermoonEvent[] {
  const out: SupermoonEvent[] = [];
  for (const q of computeMoonQuarters(fromMs, toMs)) {
    if (q.quarter !== 2) continue;
    const v = GeoVector(Body.Moon, new Date(q.timeMs), true);
    const distanceKm = Math.hypot(v.x, v.y, v.z) * AU_KM;
    if (distanceKm > SUPERMOON_MAX_DISTANCE_KM) continue;
    out.push({
      id: `supermoon-${ymdUtc(q.timeMs)}`,
      kind: 'supermoon',
      timeMs: q.timeMs,
      distanceKm,
      titleZh: '超级月亮',
      descriptionZh: `本次满月恰逢月球近地点附近，地心距约 ${(distanceKm / 10_000).toFixed(1)} 万千米，视直径比平均满月大约 7%（“超级月亮”无统一学术定义，此处取常用距离阈值近似）。`,
      focusUid: 'EPH-MOON',
    });
  }
  return out;
}

// ── 流星雨（静态数据表） ──

export interface MeteorShowerInfo {
  showerId: string;
  nameZh: string;
  nameEn: string;
  /** 极大期月份（1–12，UTC 日期）。 */
  peakMonth: number;
  /** 极大期日（多年平均近似，逐年 ±1 天）。 */
  peakDay: number;
  /** 理想天顶每时出现率（ZHR，理想条件，实见通常低于此值）。 */
  zhr: number;
  radiantRaDeg: number;
  radiantDecDeg: number;
  /** 辐射点所在星座 IAU 缩写（深链 ?con= 用）。 */
  constellation: string;
  /** 活动期起 [月, 日]。 */
  activeFrom: [number, number];
  /** 活动期止 [月, 日]。 */
  activeTo: [number, number];
  /** 母体彗星/小行星。 */
  parentBody: string;
}

/**
 * 十大流星雨静态表（IMO/公域常识数据；极大期为多年平均近似，逐年 ±1 天）。
 * ZHR 为理想天顶小时率，实际所见受月光/光污染/辐射点高度影响，通常低于此值。
 */
export const METEOR_SHOWERS: readonly MeteorShowerInfo[] = [
  { showerId: 'quadrantids', nameZh: '象限仪座流星雨', nameEn: 'Quadrantids', peakMonth: 1, peakDay: 4, zhr: 120, radiantRaDeg: 230, radiantDecDeg: 49, constellation: 'Boo', activeFrom: [12, 28], activeTo: [1, 12], parentBody: '小行星 2003 EH1' },
  { showerId: 'lyrids', nameZh: '天琴座流星雨', nameEn: 'Lyrids', peakMonth: 4, peakDay: 22, zhr: 18, radiantRaDeg: 271, radiantDecDeg: 34, constellation: 'Lyr', activeFrom: [4, 14], activeTo: [4, 30], parentBody: '彗星 C/1861 G1' },
  { showerId: 'eta-aquariids', nameZh: '宝瓶座η流星雨', nameEn: 'Eta Aquariids', peakMonth: 5, peakDay: 6, zhr: 50, radiantRaDeg: 338, radiantDecDeg: -1, constellation: 'Aqr', activeFrom: [4, 19], activeTo: [5, 28], parentBody: '彗星 1P/哈雷' },
  { showerId: 'delta-aquariids', nameZh: '宝瓶座δ南流星雨', nameEn: 'Southern Delta Aquariids', peakMonth: 7, peakDay: 30, zhr: 25, radiantRaDeg: 340, radiantDecDeg: -16, constellation: 'Aqr', activeFrom: [7, 12], activeTo: [8, 23], parentBody: '彗星 96P/Machholz' },
  { showerId: 'perseids', nameZh: '英仙座流星雨', nameEn: 'Perseids', peakMonth: 8, peakDay: 13, zhr: 100, radiantRaDeg: 48, radiantDecDeg: 58, constellation: 'Per', activeFrom: [7, 17], activeTo: [8, 24], parentBody: '彗星 109P/Swift-Tuttle' },
  { showerId: 'orionids', nameZh: '猎户座流星雨', nameEn: 'Orionids', peakMonth: 10, peakDay: 21, zhr: 20, radiantRaDeg: 95, radiantDecDeg: 16, constellation: 'Ori', activeFrom: [10, 2], activeTo: [11, 7], parentBody: '彗星 1P/哈雷' },
  { showerId: 'taurids', nameZh: '金牛座南流星雨', nameEn: 'Southern Taurids', peakMonth: 11, peakDay: 5, zhr: 5, radiantRaDeg: 52, radiantDecDeg: 13, constellation: 'Tau', activeFrom: [9, 10], activeTo: [11, 20], parentBody: '彗星 2P/恩克' },
  { showerId: 'leonids', nameZh: '狮子座流星雨', nameEn: 'Leonids', peakMonth: 11, peakDay: 17, zhr: 15, radiantRaDeg: 152, radiantDecDeg: 22, constellation: 'Leo', activeFrom: [11, 6], activeTo: [11, 30], parentBody: '彗星 55P/Tempel-Tuttle' },
  { showerId: 'geminids', nameZh: '双子座流星雨', nameEn: 'Geminids', peakMonth: 12, peakDay: 14, zhr: 150, radiantRaDeg: 112, radiantDecDeg: 33, constellation: 'Gem', activeFrom: [12, 4], activeTo: [12, 17], parentBody: '小行星 3200 法厄同' },
  { showerId: 'ursids', nameZh: '小熊座流星雨', nameEn: 'Ursids', peakMonth: 12, peakDay: 22, zhr: 10, radiantRaDeg: 217, radiantDecDeg: 76, constellation: 'UMi', activeFrom: [12, 17], activeTo: [12, 26], parentBody: '彗星 8P/Tuttle' },
];

/** 窗口内的流星雨极大期事件（allDay，精确到日）。 */
export function computeMeteorShowers(fromMs: number, toMs: number): MeteorShowerEvent[] {
  const out: MeteorShowerEvent[] = [];
  const fromYear = new Date(fromMs).getUTCFullYear();
  const toYear = new Date(toMs).getUTCFullYear();
  for (let year = fromYear; year <= toYear; year++) {
    for (const s of METEOR_SHOWERS) {
      const timeMs = Date.UTC(year, s.peakMonth - 1, s.peakDay);
      if (timeMs < fromMs || timeMs >= toMs) continue;
      out.push({
        id: `shower-${s.showerId}-${year}`,
        kind: 'meteor-shower',
        timeMs,
        allDay: true,
        showerId: s.showerId,
        zhr: s.zhr,
        radiantRaDeg: s.radiantRaDeg,
        radiantDecDeg: s.radiantDecDeg,
        titleZh: `${s.nameZh}极大`,
        descriptionZh: `极大期前后数夜均可观测，ZHR 约 ${s.zhr}（理想条件天顶小时率，实见通常低于此值）；辐射点位于${s.nameZh.replace('流星雨', '')}方向，后半夜观测条件更佳。母体：${s.parentBody}。`,
        focusConstellation: s.constellation,
      });
    }
  }
  return out;
}

// ── 全量聚合 ──

/**
 * 计算自 from 起 months 个月内的全部天象事件（按时间升序）。
 * UI 层建议按类别分片调用各 compute* 让出主线程；本函数供 api/测试一次性聚合。
 */
export function computeAlmanac(from: Date, months = 12): AlmanacEvent[] {
  const fromMs = from.getTime();
  const to = new Date(from);
  to.setUTCMonth(to.getUTCMonth() + months);
  const toMs = to.getTime();
  return [
    ...computeMoonQuarters(fromMs, toMs),
    ...computeEclipses(fromMs, toMs),
    ...computeConjunctions(fromMs, toMs),
    ...computeElongationsOppositions(fromMs, toMs),
    ...computeSeasons(fromMs, toMs),
    ...computeSupermoons(fromMs, toMs),
    ...computeMeteorShowers(fromMs, toMs),
  ].sort((a, b) => a.timeMs - b.timeMs);
}

// ── 月出月落（月历视图用） ──

/** 某日 24h 内的月出/月落时刻；null = 当天无该事件（升落周期 ≈24h50m，每月约缺一天，属正常）。 */
export interface MoonRiseSet {
  riseMs: number | null;
  setMs: number | null;
}

/** 计算 dayStartMs 起 24h 内的月出/月落（站心，海拔取 0）。 */
export function computeMoonRiseSet(
  dayStartMs: number,
  latitudeDeg: number,
  longitudeDeg: number,
): MoonRiseSet {
  const obs = new Observer(latitudeDeg, longitudeDeg, 0);
  const start = new Date(dayStartMs);
  const rise = SearchRiseSet(Body.Moon, obs, +1, start, 1);
  const set = SearchRiseSet(Body.Moon, obs, -1, start, 1);
  return {
    riseMs: rise?.date.getTime() ?? null,
    setMs: set?.date.getTime() ?? null,
  };
}

// ── 升落与中天（Phase 9B §3e-5：日出日落/行星升落产品化） ──

/**
 * 某日 24h 内天体的升/落/上中天时刻；null = 窗口内无该事件。
 * 常见 null 场景：极昼极夜（太阳整日不升/不落）、月亮 ~24h50m 升落周期
 * 每月约缺一天、以及拱极天体永不落下等——均属天文事实，非计算失败。
 */
export interface BodyRiseSet {
  riseMs: number | null;
  setMs: number | null;
  /** 上中天（过子午圈、当日最高点）时刻。 */
  transitMs: number | null;
  /** 上中天时刻的地平高度角（度）；transitMs 为 null 时亦为 null。 */
  transitAltDeg: number | null;
}

/**
 * 计算 dayStartMs 起 24h 内某星历天体的升/落/上中天（站心，海拔 0；
 * SearchRiseSet 含 astronomy-engine 默认的标准大气折射与视半径修正）。
 * dayStartMs 建议传观测者本地日界（如北京时区当日 00:00 对应的 UTC ms），
 * 与 computeMoonRiseSet 同一约定。
 */
export function computeBodyRiseSet(
  bodyId: EphemerisBodyId,
  dayStartMs: number,
  latitudeDeg: number,
  longitudeDeg: number,
): BodyRiseSet {
  const obs = new Observer(latitudeDeg, longitudeDeg, 0);
  const start = new Date(dayStartMs);
  const rise = SearchRiseSet(AE_BODY[bodyId], obs, +1, start, 1);
  const set = SearchRiseSet(AE_BODY[bodyId], obs, -1, start, 1);
  // SearchHourAngle 无搜索窗口参数（必返回下一次事件）：向后搜到的首个
  // 上中天若超出本日 24h 即视为「当日无中天」（月亮中天周期 ~24h50m，
  // 每月约缺一天，与月出落缺日同理）。
  const tr = SearchHourAngle(AE_BODY[bodyId], obs, 0, start, +1);
  const trMs = tr.time.date.getTime();
  const inDay = trMs < dayStartMs + DAY_MS;
  return {
    riseMs: rise?.date.getTime() ?? null,
    setMs: set?.date.getTime() ?? null,
    transitMs: inDay ? trMs : null,
    transitAltDeg: inDay ? tr.hor.altitude : null,
  };
}

/** 太阳版便捷封装（信息卡「今日 升/落/中天」与日出日落展示用）。 */
export function computeSunRiseSet(
  dayStartMs: number,
  latitudeDeg: number,
  longitudeDeg: number,
): BodyRiseSet {
  return computeBodyRiseSet('sun', dayStartMs, latitudeDeg, longitudeDeg);
}
