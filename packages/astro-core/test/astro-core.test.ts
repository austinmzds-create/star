import { describe, expect, it } from 'vitest';
import {
  azimuthToDirection,
  computeObservationSummary,
  computeVisibility,
  equatorialToHorizontal,
  greenwichMeanSiderealTime,
  julianDate,
  localSiderealTime,
  normalizeDegrees,
  raDecToVector3,
  JD_J2000,
} from '../src/index.js';

describe('normalizeDegrees', () => {
  it('把角度归一化到 [0, 360)', () => {
    expect(normalizeDegrees(0)).toBe(0);
    expect(normalizeDegrees(360)).toBe(0);
    expect(normalizeDegrees(370)).toBe(10);
    expect(normalizeDegrees(-10)).toBe(350);
    expect(normalizeDegrees(-370)).toBe(350);
  });
});

describe('julianDate', () => {
  it('J2000.0（2000-01-01T12:00:00Z）应为 JD 2451545.0', () => {
    const date = new Date('2000-01-01T12:00:00Z');
    expect(julianDate(date)).toBeCloseTo(JD_J2000, 6);
  });

  it('Unix 纪元应为 JD 2440587.5', () => {
    expect(julianDate(new Date('1970-01-01T00:00:00Z'))).toBeCloseTo(2440587.5, 6);
  });
});

describe('greenwichMeanSiderealTime', () => {
  it('J2000.0 时 GMST ≈ 280.4606°（约 18h41m50s）', () => {
    const gmst = greenwichMeanSiderealTime(new Date('2000-01-01T12:00:00Z'));
    expect(gmst).toBeCloseTo(280.46061837, 4);
  });
});

describe('raDecToVector3', () => {
  const R = 1000;
  it('RA=0, Dec=0 落在 +X 轴', () => {
    const v = raDecToVector3({ raDeg: 0, decDeg: 0 }, R);
    expect(v.x).toBeCloseTo(R, 6);
    expect(v.y).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it('Dec=90（北天极）落在 +Y 轴', () => {
    const v = raDecToVector3({ raDeg: 123, decDeg: 90 }, R);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(R, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it('RA=90, Dec=0 落在 -Z 轴', () => {
    const v = raDecToVector3({ raDeg: 90, decDeg: 0 }, R);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(-R, 6);
  });

  it('所有点都在半径 r 的球面上', () => {
    const v = raDecToVector3({ raDeg: 217, decDeg: -33 }, R);
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    expect(len).toBeCloseTo(R, 6);
  });
});

describe('equatorialToHorizontal', () => {
  it('在北极点，任意星体的高度角等于其赤纬', () => {
    const observer = { latitudeDeg: 90, longitudeDeg: 0 };
    const date = new Date('2026-07-10T18:00:00Z');
    const h = equatorialToHorizontal({ raDeg: 200, decDeg: 37 }, observer, date);
    expect(h.altitudeDeg).toBeCloseTo(37, 6);
  });

  it('在北极点，另一颗星同样满足 alt=dec（与时间无关）', () => {
    const observer = { latitudeDeg: 90, longitudeDeg: 0 };
    const date = new Date('2026-01-01T03:30:00Z');
    const h = equatorialToHorizontal({ raDeg: 10, decDeg: -12 }, observer, date);
    expect(h.altitudeDeg).toBeCloseTo(-12, 6);
  });
});

describe('azimuthToDirection', () => {
  it('主要方位映射正确', () => {
    expect(azimuthToDirection(0).en).toBe('N');
    expect(azimuthToDirection(0).zh).toBe('正北');
    expect(azimuthToDirection(45).en).toBe('NE');
    expect(azimuthToDirection(90).en).toBe('E');
    expect(azimuthToDirection(180).en).toBe('S');
    expect(azimuthToDirection(225).en).toBe('SW');
    expect(azimuthToDirection(225).zh).toBe('西南');
    expect(azimuthToDirection(270).en).toBe('W');
  });
});

describe('computeObservationSummary', () => {
  const beijing = { latitudeDeg: 39.9, longitudeDeg: 116.4 };
  const fromDate = new Date('2026-07-10T12:00:00Z');

  it('最大高度角等于 90 - |纬度 - 赤纬|', () => {
    const summary = computeObservationSummary(
      { raDeg: 100, decDeg: 20 },
      beijing,
      fromDate,
    );
    expect(summary.maxAltitudeDeg).toBeCloseTo(90 - Math.abs(39.9 - 20), 4);
  });

  it('高赤纬星体在中高纬度拱极', () => {
    const summary = computeObservationSummary(
      { raDeg: 37, decDeg: 80 },
      { latitudeDeg: 60, longitudeDeg: 0 },
      fromDate,
    );
    expect(summary.isCircumpolar).toBe(true);
    expect(summary.neverRises).toBe(false);
  });

  it('深南天星体在北半球永不升起', () => {
    const summary = computeObservationSummary(
      { raDeg: 95, decDeg: -70 },
      { latitudeDeg: 40, longitudeDeg: 0 },
      fromDate,
    );
    expect(summary.neverRises).toBe(true);
    expect(summary.isCircumpolar).toBe(false);
  });

  it('下一次上中天时刻的本地恒星时应回到该星 RA', () => {
    const star = { raDeg: 101.287, decDeg: -16.716 }; // 天狼星
    const summary = computeObservationSummary(star, beijing, fromDate);
    const lstAtTransit = localSiderealTime(summary.nextTransit, beijing.longitudeDeg);
    const diff = Math.abs(normalizeDegrees(lstAtTransit - star.raDeg + 180) - 180);
    expect(diff).toBeLessThan(0.05);
  });

  it('上中天时刻实际算出的高度角应等于最大高度角，且位于子午线（方位 ~0 或 ~180）', () => {
    const star = { raDeg: 279.23, decDeg: 38.78 }; // 织女星
    const summary = computeObservationSummary(star, beijing, fromDate);
    const snap = computeVisibility(star, beijing, summary.nextTransit);
    expect(snap.horizontal.altitudeDeg).toBeCloseTo(summary.maxAltitudeDeg, 1);
    const az = snap.horizontal.azimuthDeg;
    const onMeridian = Math.min(az, Math.abs(az - 180), Math.abs(az - 360));
    expect(onMeridian).toBeLessThan(0.5);
  });
});
