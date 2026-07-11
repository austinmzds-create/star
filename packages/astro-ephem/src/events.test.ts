/**
 * 天象事件单测：已知 2026 天文事实锚点（宽容差）+ 结构性不变量。
 * 锚点数值均以仓库内实际安装的 astronomy-engine 运行验证；容差刻意宽松
 * （日期 ±1~3 天），只锁「事件被找到 + 语义/单位正确」，不追分钟级精度。
 * 均以 UTC 断言；WINDOW = [2026-01-01T00:00Z, 2027-01-01T00:00Z)。
 */
import { Body, PairLongitude } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import {
  computeAlmanac,
  computeConjunctions,
  computeEclipses,
  computeElongationsOppositions,
  computeMeteorShowers,
  computeMoonQuarters,
  computeMoonRiseSet,
  computeSeasons,
  computeSupermoons,
  METEOR_SHOWERS,
  SUPERMOON_MAX_DISTANCE_KM,
  type LunarEclipseEvent,
  type SolarEclipseEvent,
} from './events';

const FROM = Date.UTC(2026, 0, 1);
const TO = Date.UTC(2027, 0, 1);
const DAY = 86_400_000;

/** |timeMs - 某 UTC 日期| ≤ days 天。 */
function nearUtcDay(timeMs: number, iso: string, days: number): boolean {
  return Math.abs(timeMs - Date.parse(iso)) <= days * DAY;
}

/** wrap 到 (-180, 180]。 */
function wrapDelta(deg: number): number {
  let x = deg % 360;
  if (x > 180) x -= 360;
  if (x <= -180) x += 360;
  return x;
}

describe('computeSeasons：2026 二分二至', () => {
  const events = computeSeasons(FROM, TO);
  it('恰 4 个事件，日期各 ±1 天（实测 Seasons(2026)）', () => {
    expect(events.length).toBe(4);
    const bySeason = new Map(events.map((e) => [e.season, e]));
    expect(nearUtcDay(bySeason.get('mar-equinox')!.timeMs, '2026-03-20T14:45:00Z', 1)).toBe(true);
    expect(nearUtcDay(bySeason.get('jun-solstice')!.timeMs, '2026-06-21T08:25:00Z', 1)).toBe(true);
    expect(nearUtcDay(bySeason.get('sep-equinox')!.timeMs, '2026-09-23T00:05:00Z', 1)).toBe(true);
    expect(nearUtcDay(bySeason.get('dec-solstice')!.timeMs, '2026-12-21T20:50:00Z', 1)).toBe(true);
  });
});

describe('computeEclipses：2026 日月食', () => {
  const events = computeEclipses(FROM, TO);
  const lunar = events.filter((e): e is LunarEclipseEvent => e.kind === 'lunar-eclipse');
  const solar = events.filter((e): e is SolarEclipseEvent => e.kind === 'solar-eclipse');

  it('月食恰 2 次：3-3 月全食（obscuration>0.99）+ 8-28 月偏食（0.9<obs<1）', () => {
    expect(lunar.length).toBe(2);
    const [first, second] = lunar;
    expect(first!.eclipseKind).toBe('total');
    expect(nearUtcDay(first!.timeMs, '2026-03-03T12:00:00Z', 1)).toBe(true);
    expect(first!.obscuration).toBeGreaterThan(0.99);
    expect(second!.eclipseKind).toBe('partial');
    expect(nearUtcDay(second!.timeMs, '2026-08-28T04:00:00Z', 1)).toBe(true);
    expect(second!.obscuration).toBeGreaterThan(0.9);
    expect(second!.obscuration).toBeLessThan(1);
  });

  it('日食恰 2 次：2-17 日环食 + 8-12 日全食（食甚点纬度 60–70°）', () => {
    expect(solar.length).toBe(2);
    const [annular, total] = solar;
    expect(annular!.eclipseKind).toBe('annular');
    expect(nearUtcDay(annular!.timeMs, '2026-02-17T12:00:00Z', 1)).toBe(true);
    expect(total!.eclipseKind).toBe('total');
    expect(nearUtcDay(total!.timeMs, '2026-08-12T17:45:00Z', 1)).toBe(true);
    expect(total!.peakLatDeg).toBeGreaterThan(60);
    expect(total!.peakLatDeg).toBeLessThan(70);
  });

  it('日食可见性合规措辞：一律「全球性天象 · 本地可见区另查」', () => {
    for (const e of solar) {
      expect(e.descriptionZh).toContain('全球性天象');
      expect(e.descriptionZh).toContain('另查');
    }
  });
});

describe('computeMoonQuarters：月相自洽锚（借「食必朔望」）', () => {
  const quarters = computeMoonQuarters(FROM, TO);

  it('2026-08-12 ±1 天有新月（与日全食同日）；2026-03-03 ±1 天有满月（与月全食同日）', () => {
    expect(
      quarters.some((q) => q.quarter === 0 && nearUtcDay(q.timeMs, '2026-08-12T17:37:00Z', 1)),
    ).toBe(true);
    expect(
      quarters.some((q) => q.quarter === 2 && nearUtcDay(q.timeMs, '2026-03-03T11:38:00Z', 1)),
    ).toBe(true);
  });

  it('结构性：12 个月数量 ∈ [48,51]；相邻间隔 ∈ [6.0, 8.7] 天；序列循环 (q+1)%4', () => {
    expect(quarters.length).toBeGreaterThanOrEqual(48);
    expect(quarters.length).toBeLessThanOrEqual(51);
    for (let i = 1; i < quarters.length; i++) {
      const gapDays = (quarters[i]!.timeMs - quarters[i - 1]!.timeMs) / DAY;
      expect(gapDays).toBeGreaterThanOrEqual(6.0);
      expect(gapDays).toBeLessThanOrEqual(8.7);
      expect(quarters[i]!.quarter).toBe((quarters[i - 1]!.quarter + 1) % 4);
    }
  });
});

describe('computeElongationsOppositions：2026 冲日与大距', () => {
  const events = computeElongationsOppositions(FROM, TO);
  const opps = events.filter((e) => e.kind === 'opposition');
  const elongs = events.filter((e) => e.kind === 'max-elongation');

  it('木星冲日 2026-01-10 ±2 天、土星冲日 2026-10-04 ±2 天', () => {
    const jupiter = opps.find((e) => e.kind === 'opposition' && e.body === 'jupiter');
    const saturn = opps.find((e) => e.kind === 'opposition' && e.body === 'saturn');
    expect(jupiter).toBeDefined();
    expect(nearUtcDay(jupiter!.timeMs, '2026-01-10T08:29:00Z', 2)).toBe(true);
    expect(saturn).toBeDefined();
    expect(nearUtcDay(saturn!.timeMs, '2026-10-04T12:00:00Z', 2)).toBe(true);
  });

  it('自洽：冲日时刻 PairLongitude(body, Sun) 与 180° 相差 <3°', () => {
    const BODY: Record<string, Body> = {
      mars: Body.Mars,
      jupiter: Body.Jupiter,
      saturn: Body.Saturn,
      uranus: Body.Uranus,
      neptune: Body.Neptune,
    };
    for (const e of opps) {
      if (e.kind !== 'opposition') continue;
      const rel = PairLongitude(BODY[e.body]!, Body.Sun, new Date(e.timeMs));
      expect(Math.abs(wrapDelta(rel - 180))).toBeLessThan(3);
    }
  });

  it('金星东大距 2026-08-15 ±3 天，elongation ∈ (44,48)，昏见', () => {
    const venus = elongs.find((e) => e.kind === 'max-elongation' && e.body === 'venus');
    expect(venus).toBeDefined();
    if (venus?.kind !== 'max-elongation') throw new Error('unreachable');
    expect(nearUtcDay(venus.timeMs, '2026-08-15T00:00:00Z', 3)).toBe(true);
    expect(venus.elongationDeg).toBeGreaterThan(44);
    expect(venus.elongationDeg).toBeLessThan(48);
    expect(venus.visibility).toBe('evening');
  });

  it('水星 2026 大距 5–7 次，elongation 全部 ∈ (17,29)，其中一次 2026-02-19 ±2 天', () => {
    const mercury = elongs.filter((e) => e.kind === 'max-elongation' && e.body === 'mercury');
    expect(mercury.length).toBeGreaterThanOrEqual(5);
    expect(mercury.length).toBeLessThanOrEqual(7);
    for (const e of mercury) {
      if (e.kind !== 'max-elongation') continue;
      expect(e.elongationDeg).toBeGreaterThan(17);
      expect(e.elongationDeg).toBeLessThan(29);
    }
    expect(mercury.some((e) => nearUtcDay(e.timeMs, '2026-02-19T00:00:00Z', 2))).toBe(true);
  });
});

describe('computeSupermoons：2026 超级月亮', () => {
  const events = computeSupermoons(FROM, TO);

  it('命中 2026-11-24 与 2026-12-24（各 ±1 天），distanceKm < 阈值；全年 2–4 次', () => {
    expect(events.some((e) => nearUtcDay(e.timeMs, '2026-11-24T14:54:00Z', 1))).toBe(true);
    expect(events.some((e) => nearUtcDay(e.timeMs, '2026-12-24T01:28:00Z', 1))).toBe(true);
    for (const e of events) expect(e.distanceKm).toBeLessThan(SUPERMOON_MAX_DISTANCE_KM);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.length).toBeLessThanOrEqual(4);
  });
});

describe('computeMeteorShowers：静态表事件', () => {
  const events = computeMeteorShowers(FROM, TO);

  it('2026 窗口含英仙座（8-13 ±1 天）与双子座（12-14 ±1 天）极大，皆 allDay', () => {
    const perseids = events.find((e) => e.id === 'shower-perseids-2026');
    const geminids = events.find((e) => e.id === 'shower-geminids-2026');
    expect(perseids).toBeDefined();
    expect(nearUtcDay(perseids!.timeMs, '2026-08-13T00:00:00Z', 1)).toBe(true);
    expect(perseids!.allDay).toBe(true);
    expect(geminids).toBeDefined();
    expect(nearUtcDay(geminids!.timeMs, '2026-12-14T00:00:00Z', 1)).toBe(true);
  });

  it('每条 zhr>0、辐射点坐标在合法范围、带星座深链缩写', () => {
    expect(METEOR_SHOWERS.length).toBe(10);
    for (const e of events) {
      expect(e.zhr).toBeGreaterThan(0);
      expect(e.radiantRaDeg).toBeGreaterThanOrEqual(0);
      expect(e.radiantRaDeg).toBeLessThan(360);
      expect(e.radiantDecDeg).toBeGreaterThanOrEqual(-90);
      expect(e.radiantDecDeg).toBeLessThanOrEqual(90);
      expect(e.focusConstellation).toBeTruthy();
      expect(e.descriptionZh).toContain('理想条件');
    }
  });
});

describe('computeConjunctions：合相不变量（事件逐年多变，不锚具体日期）', () => {
  const events = computeConjunctions(FROM, TO);

  it('所有事件 separationDeg < 2；峰值时刻黄经差 wrap 后 <0.5°；body1≠body2', () => {
    expect(events.length).toBeGreaterThan(0);
    const AE: Record<string, Body> = {
      moon: Body.Moon,
      mercury: Body.Mercury,
      venus: Body.Venus,
      mars: Body.Mars,
      jupiter: Body.Jupiter,
      saturn: Body.Saturn,
    };
    for (const e of events) {
      expect(e.separationDeg).toBeLessThan(2);
      expect(e.body1).not.toBe(e.body2);
      const rel = PairLongitude(AE[e.body1]!, AE[e.body2]!, new Date(e.timeMs));
      expect(Math.abs(wrapDelta(rel))).toBeLessThan(0.5);
    }
  });

  it('12 个月月合行星事件 ≥ 1（月亮每月扫过全黄道，<2° 月合全年必有）', () => {
    expect(events.some((e) => e.body1 === 'moon')).toBe(true);
  });

  it('确定性：同参数两次调用 deepEqual', () => {
    expect(computeConjunctions(FROM, TO)).toEqual(events);
  });
});

describe('computeAlmanac：聚合不变量', () => {
  const from = new Date(FROM);
  const events = computeAlmanac(from, 12);

  it('按 timeMs 升序；id 全局唯一；timeMs ∈ [from, to)', () => {
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.timeMs).toBeGreaterThanOrEqual(events[i - 1]!.timeMs);
    }
    const ids = new Set(events.map((e) => e.id));
    expect(ids.size).toBe(events.length);
    for (const e of events) {
      expect(e.timeMs).toBeGreaterThanOrEqual(FROM);
      expect(e.timeMs).toBeLessThan(TO);
      expect(e.titleZh.length).toBeGreaterThan(0);
      expect(e.descriptionZh.length).toBeGreaterThan(0);
    }
  });
});

describe('computeMoonRiseSet', () => {
  it('北京 2026-07-11（北京日界）rise/set 非 null 且落在 [dayStart, dayStart+25h)', () => {
    const dayStart = Date.UTC(2026, 6, 10, 16); // 北京 2026-07-11 00:00 = UTC 07-10T16:00
    const rs = computeMoonRiseSet(dayStart, 39.9042, 116.4074);
    expect(rs.riseMs).not.toBeNull();
    expect(rs.setMs).not.toBeNull();
    for (const t of [rs.riseMs!, rs.setMs!]) {
      expect(t).toBeGreaterThanOrEqual(dayStart);
      expect(t).toBeLessThan(dayStart + 25 * 3600_000);
    }
  });

  it('纬度 89° 假想观测者 2026-06 月中返回 null 不抛错（极地兜底路径）', () => {
    const rs = computeMoonRiseSet(Date.UTC(2026, 5, 13), 89, 0);
    expect(rs.riseMs).toBeNull();
    expect(rs.setMs).toBeNull();
  });
});
