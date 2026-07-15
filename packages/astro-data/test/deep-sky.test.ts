import { describe, expect, it } from 'vitest';
import {
  CELESTIAL_CATALOG,
  DEEP_SKY_CATALOG,
  FULL_CATALOG,
  getCelestialByUid,
} from '../src/index.js';

describe('DEEP_SKY_CATALOG 数据完整性', () => {
  it('Messier 110 全量：M1..M110 均可按 uid 取到', () => {
    for (let m = 1; m <= 110; m++) {
      const o = getCelestialByUid(`M${m}`);
      expect(o, `M${m}`).toBeDefined();
      expect(o!.catalogIds.m).toBe(String(m));
    }
  });

  it('M102 覆写为 NGC 5866（纺锤星系）', () => {
    const o = getCelestialByUid('M102');
    expect(o?.catalogIds.ngc).toBe('5866');
    expect(o?.nameZh).toBe('纺锤星系');
    expect(o?.descriptionZh).toContain('争议');
  });

  it('合规红线：所有深空天体 isNamable=false', () => {
    expect(DEEP_SKY_CATALOG.length).toBeGreaterThan(0);
    expect(DEEP_SKY_CATALOG.every((o) => !o.isNamable)).toBe(true);
  });

  it('Messier 全部 isFeatured=true，且 nameZh / descriptionZh 非空', () => {
    const messier = DEEP_SKY_CATALOG.filter((o) => o.catalogIds.m !== undefined);
    expect(messier.length).toBe(110);
    for (const o of messier) {
      expect(o.isFeatured, o.objectUid).toBe(true);
      expect(o.nameZh.length, o.objectUid).toBeGreaterThan(0);
      // 非「M 40」式 uid 空格回退（中文映射表必须命中）。
      expect(o.nameZh, o.objectUid).not.toMatch(/^M \d+$/);
      expect(o.descriptionZh && o.descriptionZh.length, o.objectUid).toBeGreaterThan(0);
    }
  });

  it('抽样坐标（J2000，容差 0.05°）与类型', () => {
    const m31 = getCelestialByUid('M31')!;
    expect(Math.abs(m31.raDeg - 10.685)).toBeLessThan(0.05);
    expect(Math.abs(m31.decDeg - 41.269)).toBeLessThan(0.05);
    expect(m31.type).toBe('galaxy');
    expect(m31.nameZh).toBe('仙女座星系');
    expect(m31.commonNameZh).toBe('仙女座大星云');

    const m42 = getCelestialByUid('M42')!;
    expect(Math.abs(m42.raDeg - 83.819)).toBeLessThan(0.05);
    expect(Math.abs(m42.decDeg - -5.389)).toBeLessThan(0.05);

    const m45 = getCelestialByUid('M45')!;
    expect(Math.abs(m45.raDeg - 56.869)).toBeLessThan(0.05);
    expect(Math.abs(m45.decDeg - 24.105)).toBeLessThan(0.05);
    expect(m45.type).toBe('cluster');

    expect(getCelestialByUid('M40')!.type).toBe('star'); // 温内克 4 双星。
    expect(getCelestialByUid('M24')!.type).toBe('cluster'); // 人马座恒星云。
  });

  it('域校验：坐标 / 类型 / 星座中文映射', () => {
    const legal = new Set(['star', 'galaxy', 'nebula', 'cluster']);
    for (const o of DEEP_SKY_CATALOG) {
      expect(o.raDeg, o.objectUid).toBeGreaterThanOrEqual(0);
      expect(o.raDeg, o.objectUid).toBeLessThan(360);
      expect(o.decDeg, o.objectUid).toBeGreaterThanOrEqual(-90);
      expect(o.decDeg, o.objectUid).toBeLessThanOrEqual(90);
      expect(legal.has(o.type), `${o.objectUid} type=${o.type}`).toBe(true);
      expect(o.sourceCatalog).toBe('openngc');
      expect(Number.isFinite(o.magnitude)).toBe(true);
    }
  });

  it('规模合理：总量 ∈ [500,700]，非 Messier 部分 mag ≤ 10', () => {
    expect(DEEP_SKY_CATALOG.length).toBeGreaterThanOrEqual(500);
    expect(DEEP_SKY_CATALOG.length).toBeLessThanOrEqual(700);
    for (const o of DEEP_SKY_CATALOG) {
      if (o.catalogIds.m === undefined) {
        expect(o.magnitude, o.objectUid).toBeLessThanOrEqual(10);
      }
    }
  });

  it('uid 唯一且与恒星表无交集；FULL_CATALOG = 两表之和', () => {
    const dsoUids = new Set(DEEP_SKY_CATALOG.map((o) => o.objectUid));
    expect(dsoUids.size).toBe(DEEP_SKY_CATALOG.length);
    for (const s of CELESTIAL_CATALOG) {
      expect(dsoUids.has(s.objectUid), s.objectUid).toBe(false);
    }
    expect(FULL_CATALOG.length).toBe(CELESTIAL_CATALOG.length + DEEP_SKY_CATALOG.length);
  });
});
