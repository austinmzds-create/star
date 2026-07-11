/**
 * 小天体星历单测：求解器数学恒等 + 轨道几何边界 + JPL Horizons 锚点。
 *
 * 锚点纪律（合规红线「绝不编造观测坐标」）：全部参考值来自权威源实拉——
 * 2026-07-11 执行：
 *   curl -G 'https://ssd.jpl.nasa.gov/api/horizons.api' \
 *     --data-urlencode "COMMAND='1;'" --data-urlencode "CENTER='500@399'" \
 *     --data-urlencode "EPHEM_TYPE='OBSERVER'" --data-urlencode "QUANTITIES='1,20'" \
 *     --data-urlencode "START_TIME='2026-07-01'" --data-urlencode "STOP_TIME='2026-07-02'" \
 *     --data-urlencode "STEP_SIZE='1d'" ...
 *  （COMMAND='1;' Ceres / '4;' Vesta / '2;' Pallas / 'DES=1P;CAP' Halley，
 *   CENTER='500@399' 地心，QUANTITIES='1' 天文测量 RA/Dec ICRF/J2000。）
 * 返回值原样换算为度粘贴于下，注释保留时分秒原文。
 */
import { describe, expect, it } from 'vitest';
import {
  getMinorBodyElements,
  getMinorBodyEquatorial,
  getMinorBodyEquatorialByUid,
  isMinorBodyUid,
  listMinorBodies,
  minorUidToId,
  solveKepler,
  type MinorBodyId,
} from './minorBodies';

const ALL: MinorBodyId[] = ['ceres', 'vesta', 'pallas', 'halley'];

/** 球面角距（度）——勿直接减 RA。 */
function angularSeparationDeg(
  ra1: number,
  dec1: number,
  ra2: number,
  dec2: number,
): number {
  const d2r = Math.PI / 180;
  const cosSep =
    Math.sin(dec1 * d2r) * Math.sin(dec2 * d2r) +
    Math.cos(dec1 * d2r) * Math.cos(dec2 * d2r) * Math.cos((ra1 - ra2) * d2r);
  return Math.acos(Math.max(-1, Math.min(1, cosSep))) / d2r;
}

/**
 * JPL Horizons 地心天文测量锚点（2026-07-01 00:00 UT，ICRF/J2000，抓取 2026-07-11）：
 *   Ceres  04 47 51.40 +20 05 33.9
 *   Vesta  01 15 57.75 +00 37 22.4   delta 2.30323 AU
 *   Pallas 01 09 11.70 +03 34 57.8   delta 2.99871 AU
 *   Halley 08 12 17.92 +03 37 21.3   delta 35.91706 AU
 */
const HORIZONS_ANCHORS: Array<{
  id: MinorBodyId;
  raDeg: number;
  decDeg: number;
  distanceAu?: number;
  tolDeg: number;
}> = [
  { id: 'ceres', raDeg: (4 + 47 / 60 + 51.4 / 3600) * 15, decDeg: 20 + 5 / 60 + 33.9 / 3600, tolDeg: 1.0 },
  { id: 'vesta', raDeg: (1 + 15 / 60 + 57.75 / 3600) * 15, decDeg: 0 + 37 / 60 + 22.4 / 3600, distanceAu: 2.30323, tolDeg: 1.0 },
  { id: 'pallas', raDeg: (1 + 9 / 60 + 11.7 / 3600) * 15, decDeg: 3 + 34 / 60 + 57.8 / 3600, distanceAu: 2.99871, tolDeg: 1.0 },
  // 哈雷根数历元 1968（上次回归前），远日点附近运动极慢，仍给略宽容差
  { id: 'halley', raDeg: (8 + 12 / 60 + 17.92 / 3600) * 15, decDeg: 3 + 37 / 60 + 21.3 / 3600, distanceAu: 35.91706, tolDeg: 1.5 },
];

const T0 = new Date('2026-07-01T00:00:00Z');

describe('solveKepler', () => {
  it('数学恒等：E − e·sinE ≈ M（e ∈ {0, 0.3, 0.8, 0.967} × 32 个 M）', () => {
    for (const e of [0, 0.3, 0.8, 0.967]) {
      for (let k = 0; k < 32; k++) {
        const M = ((k + 0.5) / 32) * Math.PI * 2;
        const E = solveKepler(M, e);
        expect(Math.abs(E - e * Math.sin(E) - M)).toBeLessThan(1e-8);
        expect(Number.isFinite(E)).toBe(true);
      }
    }
  });

  it('e=0 时 E === M', () => {
    for (const M of [0, 1, Math.PI, 5]) {
      expect(solveKepler(M, 0)).toBeCloseTo(M, 10);
    }
  });

  it('M 归一化：M 与 M+2π 结果一致', () => {
    const a = solveKepler(1.2, 0.5);
    const b = solveKepler(1.2 + Math.PI * 2, 0.5);
    expect(Math.abs(a - b)).toBeLessThan(1e-8);
  });
});

describe('轨道几何边界', () => {
  it('2026 年 12 个月首日：四体日心距离均在 [a(1−e), a(1+e)]（±0.01 AU）', () => {
    for (const id of ALL) {
      const el = getMinorBodyElements(id);
      for (let m = 1; m <= 12; m++) {
        const date = new Date(Date.UTC(2026, m - 1, 1));
        const eq = getMinorBodyEquatorial(id, date);
        expect(eq.helioDistanceAu).toBeGreaterThanOrEqual(el.aAu * (1 - el.e) - 0.01);
        expect(eq.helioDistanceAu).toBeLessThanOrEqual(el.aAu * (1 + el.e) + 0.01);
        expect(eq.raDeg).toBeGreaterThanOrEqual(0);
        expect(eq.raDeg).toBeLessThan(360);
        expect(eq.decDeg).toBeGreaterThanOrEqual(-90);
        expect(eq.decDeg).toBeLessThanOrEqual(90);
        expect(eq.distanceAu).toBeGreaterThan(0);
        expect(Number.isFinite(eq.raDeg)).toBe(true);
        expect(Number.isFinite(eq.decDeg)).toBe(true);
      }
    }
  });

  it('哈雷远日点锚（真实天文事实）：2026-07-01 日心距离 35.1 ± 0.6 AU，逆行根数无 NaN', () => {
    const eq = getMinorBodyEquatorial('halley', T0);
    expect(eq.helioDistanceAu).toBeGreaterThanOrEqual(34.5);
    expect(eq.helioDistanceAu).toBeLessThanOrEqual(35.7);
    expect(Number.isFinite(eq.raDeg)).toBe(true);
    expect(Number.isFinite(eq.decDeg)).toBe(true);
    // i > 90°（逆行）确认根数没被误归一
    expect(getMinorBodyElements('halley').iDeg).toBeGreaterThan(90);
  });

  it('参考系自洽：Ceres 地心黄纬 |β| 有界（黄赤转换方向转反会出 ±23° 级系统偏差）', () => {
    const eps = 23.4392911 * (Math.PI / 180);
    for (let m = 1; m <= 12; m++) {
      const eq = getMinorBodyEquatorial('ceres', new Date(Date.UTC(2026, m - 1, 1)));
      // RA/Dec → 黄纬 β（逆旋转）
      const ra = eq.raDeg * (Math.PI / 180);
      const dec = eq.decDeg * (Math.PI / 180);
      const xq = Math.cos(dec) * Math.cos(ra);
      const yq = Math.cos(dec) * Math.sin(ra);
      const zq = Math.sin(dec);
      const ze = -yq * Math.sin(eps) + zq * Math.cos(eps);
      const betaDeg = Math.asin(Math.max(-1, Math.min(1, ze))) * (180 / Math.PI);
      // 几何上 Ceres 地心黄纬受 i=10.6° 与地心距放大约束；转反黄赤方向时 β 会系统性偏到 20°+
      expect(Math.abs(betaDeg)).toBeLessThanOrEqual(18);
    }
  });
});

describe('JPL Horizons 锚点（2026-07-01，抓取 2026-07-11）', () => {
  for (const anchor of HORIZONS_ANCHORS) {
    it(`${anchor.id}: 角距 ≤ ${anchor.tolDeg}°`, () => {
      const eq = getMinorBodyEquatorial(anchor.id, T0);
      const sep = angularSeparationDeg(eq.raDeg, eq.decDeg, anchor.raDeg, anchor.decDeg);
      expect(sep).toBeLessThanOrEqual(anchor.tolDeg);
      if (anchor.distanceAu !== undefined) {
        expect(Math.abs(eq.distanceAu - anchor.distanceAu)).toBeLessThanOrEqual(
          anchor.id === 'halley' ? 0.7 : 0.1,
        );
      }
    });
  }
});

describe('元数据与 uid', () => {
  it('恰 4 条，MB- 前缀且唯一，描述非空；哈雷标注远日点示意', () => {
    const list = listMinorBodies();
    expect(list.length).toBe(4);
    const uids = new Set(list.map((b) => b.objectUid));
    expect(uids.size).toBe(4);
    for (const b of list) {
      expect(b.objectUid.startsWith('MB-')).toBe(true);
      expect(['asteroid', 'comet']).toContain(b.kind);
      expect(b.nameZh.length).toBeGreaterThan(0);
      expect(b.descriptionZh.length).toBeGreaterThan(0);
    }
    const halley = list.find((b) => b.id === 'halley')!;
    expect(halley.descriptionZh).toContain('远日点');
  });

  it('isMinorBodyUid / minorUidToId 正反互查，byUid 计算与 byId 一致', () => {
    for (const b of listMinorBodies()) {
      expect(isMinorBodyUid(b.objectUid)).toBe(true);
      expect(minorUidToId(b.objectUid)).toBe(b.id);
      const a = getMinorBodyEquatorial(b.id, T0);
      const c = getMinorBodyEquatorialByUid(b.objectUid, T0);
      expect(c).toEqual(a);
    }
    expect(isMinorBodyUid('EPH-MARS')).toBe(false);
    expect(() => minorUidToId('EPH-MARS')).toThrow();
    expect(() => getMinorBodyEquatorialByUid('HIP32349', T0)).toThrow();
  });

  it('根数常量携带来源说明与历元', () => {
    for (const id of ALL) {
      const el = getMinorBodyElements(id);
      expect(el.sourceNote).toContain('JPL SBDB');
      expect(el.epochJd).toBeGreaterThan(2400000);
      expect(el.e).toBeGreaterThanOrEqual(0);
      expect(el.e).toBeLessThan(1);
    }
  });
});
