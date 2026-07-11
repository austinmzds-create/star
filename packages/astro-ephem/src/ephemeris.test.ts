/**
 * 星历核心单测：物理不变量 + 已知历表粗校验。
 * 容差刻意宽松——只锁「参考系/单位换算/月相语义」这类结构性正确，不追角秒级精度。
 */
import { describe, expect, it } from 'vitest';
import {
  EPHEMERIS_UID_PREFIX,
  isEphemerisUid,
  listEphemerisBodies,
  uidToBodyId,
  type EphemerisBodyId,
} from './bodies';
import { getEquatorial, getMoonPhase, moonPhaseName, toCelestialObject } from './ephemeris';

const ALL_BODIES: EphemerisBodyId[] = [
  'sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune',
];

describe('getEquatorial', () => {
  it('2026-07-11 的太阳位于双子/巨蟹方向（ra≈110.6°，dec≈22°）', () => {
    const eq = getEquatorial('sun', new Date('2026-07-11T00:00:00Z'));
    expect(eq.raDeg).toBeGreaterThanOrEqual(104);
    expect(eq.raDeg).toBeLessThanOrEqual(117);
    expect(eq.decDeg).toBeGreaterThanOrEqual(20);
    expect(eq.decDeg).toBeLessThanOrEqual(24);
  });

  it('夏至/冬至的太阳赤纬到达 ±23.4° 附近', () => {
    const summer = getEquatorial('sun', new Date('2026-06-21T12:00:00Z'));
    expect(summer.decDeg).toBeGreaterThanOrEqual(23.0);
    expect(summer.decDeg).toBeLessThanOrEqual(23.6);
    const winter = getEquatorial('sun', new Date('2026-12-21T12:00:00Z'));
    expect(winter.decDeg).toBeGreaterThanOrEqual(-23.6);
    expect(winter.decDeg).toBeLessThanOrEqual(-23.0);
  });

  it('太阳地心距离全年在 0.982–1.018 AU（近日点/远日点范围）', () => {
    const seasons = ['2026-01-04', '2026-04-05', '2026-07-06', '2026-10-05'];
    for (const day of seasons) {
      const eq = getEquatorial('sun', new Date(`${day}T00:00:00Z`));
      expect(eq.distanceAu).toBeGreaterThanOrEqual(0.982);
      expect(eq.distanceAu).toBeLessThanOrEqual(1.018);
    }
  });

  it('月亮地心距离在近/远地点物理范围（0.00238–0.00272 AU）', () => {
    const eq = getEquatorial('moon', new Date('2026-07-11T00:00:00Z'));
    expect(eq.distanceAu).toBeGreaterThanOrEqual(0.00238);
    expect(eq.distanceAu).toBeLessThanOrEqual(0.00272);
  });

  it('海王星/水星地心距离在物理界内', () => {
    const nep = getEquatorial('neptune', new Date('2026-07-11T00:00:00Z'));
    expect(nep.distanceAu).toBeGreaterThanOrEqual(28.8);
    expect(nep.distanceAu).toBeLessThanOrEqual(31.1);
    const mer = getEquatorial('mercury', new Date('2026-07-11T00:00:00Z'));
    expect(mer.distanceAu).toBeGreaterThanOrEqual(0.52);
    expect(mer.distanceAu).toBeLessThanOrEqual(1.49);
  });

  it('确定性：同一 Date 两次调用逐字段相等', () => {
    const date = new Date('2026-03-15T08:30:00Z');
    for (const body of ALL_BODIES) {
      const a = getEquatorial(body, date);
      const b = getEquatorial(body, date);
      expect(a).toEqual(b);
    }
  });

  it('全部天体 × 多时刻：raDeg 归一 [0,360)，decDeg ∈ [-90,90]，distanceAu > 0', () => {
    const dates = [
      new Date('2025-01-01T00:00:00Z'),
      new Date('2026-07-11T12:00:00Z'),
      new Date('2027-11-30T23:59:00Z'),
    ];
    for (const body of ALL_BODIES) {
      for (const date of dates) {
        const eq = getEquatorial(body, date);
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
});

describe('getMoonPhase', () => {
  it('月相角与照亮比例在合法范围，且满足 illumination ≈ (1-cosφ)/2', () => {
    const dates = [
      new Date('2026-02-01T00:00:00Z'),
      new Date('2026-07-11T00:00:00Z'),
      new Date('2026-12-25T00:00:00Z'),
    ];
    for (const date of dates) {
      const { phaseAngleDeg, illumination } = getMoonPhase(date);
      expect(phaseAngleDeg).toBeGreaterThanOrEqual(0);
      expect(phaseAngleDeg).toBeLessThan(360);
      expect(illumination).toBeGreaterThanOrEqual(0);
      expect(illumination).toBeLessThanOrEqual(1);
      const expected = (1 - Math.cos((phaseAngleDeg * Math.PI) / 180)) / 2;
      expect(Math.abs(illumination - expected)).toBeLessThan(0.05);
    }
  });

  it('月相单调推进：3 天前进 30–45°（周期 29.53 天 ≈ 12.2°/天）', () => {
    const t0 = new Date('2026-07-11T00:00:00Z');
    const t1 = new Date(t0.getTime() + 3 * 24 * 3600 * 1000);
    const p0 = getMoonPhase(t0).phaseAngleDeg;
    const p1 = getMoonPhase(t1).phaseAngleDeg;
    const advance = ((p1 - p0) % 360 + 360) % 360;
    expect(advance).toBeGreaterThanOrEqual(30);
    expect(advance).toBeLessThanOrEqual(45);
  });

  it('moonPhaseName 八分相名正确', () => {
    expect(moonPhaseName(0)).toBe('新月');
    expect(moonPhaseName(90)).toBe('上弦月');
    expect(moonPhaseName(180)).toBe('满月');
    expect(moonPhaseName(270)).toBe('下弦月');
    expect(moonPhaseName(359)).toBe('新月');
    expect(moonPhaseName(135)).toBe('盈凸月');
  });
});

describe('bodies 元数据', () => {
  it('恰 9 条（太阳+月亮+7 颗可见行星，地球除外），objectUid 全带 EPH- 前缀且唯一', () => {
    const bodies = listEphemerisBodies();
    expect(bodies.length).toBe(9);
    const uids = new Set(bodies.map((b) => b.objectUid));
    expect(uids.size).toBe(9);
    for (const b of bodies) {
      expect(b.objectUid.startsWith(EPHEMERIS_UID_PREFIX)).toBe(true);
      expect(b.nameZh.length).toBeGreaterThan(0);
      expect(['sun', 'moon', 'planet']).toContain(b.kind);
      expect(b.descriptionZh.length).toBeGreaterThan(0);
    }
  });

  it('isEphemerisUid / uidToBodyId 正反互查，非法 uid 抛错', () => {
    for (const b of listEphemerisBodies()) {
      expect(isEphemerisUid(b.objectUid)).toBe(true);
      expect(uidToBodyId(b.objectUid)).toBe(b.bodyId);
    }
    expect(isEphemerisUid('HIP32349')).toBe(false);
    expect(() => uidToBodyId('HIP32349')).toThrow();
    expect(() => uidToBodyId('EPH-PLUTO')).toThrow();
  });
});

describe('toCelestialObject', () => {
  it('快照合规且坐标与 getEquatorial 一致', () => {
    const date = new Date('2026-07-11T00:00:00Z');
    for (const b of listEphemerisBodies()) {
      const obj = toCelestialObject(b.bodyId, date);
      expect(obj.isNamable).toBe(false); // 合规红线：绝不入命名池
      expect(obj.isEphemeris).toBe(true);
      expect(['sun', 'moon', 'planet']).toContain(obj.type);
      expect(obj.constellationZh).toBe('太阳系');
      const eq = getEquatorial(b.bodyId, date);
      expect(obj.raDeg).toBe(eq.raDeg);
      expect(obj.decDeg).toBe(eq.decDeg);
    }
  });
});
