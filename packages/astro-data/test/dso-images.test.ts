import { describe, expect, it } from 'vitest';
import { CELESTIAL_CATALOG, DEEP_SKY_CATALOG, FULL_CATALOG, getCelestialByUid } from '../src/index.js';

/**
 * 宇宙 V3：著名深空天体真实影像字段（imageKey/imageCredit）与真实角尺寸（angularSizeDeg）。
 * 与 apps/web/scripts/fetch-assets.mjs 的 DSO 下载清单一一对应。
 */

/** 与 fetch-assets.mjs DSO_PHOTOS 清单对齐的 16 个著名 Messier。 */
const IMAGE_UIDS = [
  'M31', 'M33', 'M42', 'M45', 'M8', 'M16', 'M17', 'M20',
  'M27', 'M51', 'M57', 'M13', 'M81', 'M101', 'M104', 'M1',
] as const;

describe('DSO 真实影像字段（imageKey / imageCredit）', () => {
  it('16 个著名 Messier 均在深空目录且带 imageKey 与非空 imageCredit', () => {
    for (const uid of IMAGE_UIDS) {
      const obj = getCelestialByUid(uid);
      expect(obj, uid).toBeDefined();
      expect(DEEP_SKY_CATALOG.includes(obj!), uid).toBe(true);
      expect(obj!.imageKey, uid).toBeDefined();
      expect(obj!.imageCredit, uid).toBeTruthy();
    }
  });

  it('imageKey 小写、互异、形如 m<数字>，且 = uid 小写', () => {
    const seen = new Set<string>();
    for (const uid of IMAGE_UIDS) {
      const key = getCelestialByUid(uid)!.imageKey!;
      expect(key, uid).toMatch(/^m\d+$/);
      expect(key, uid).toBe(uid.toLowerCase());
      expect(seen.has(key), uid).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(16);
  });

  it('imageKey 仅出现在这 16 个天体上（全目录无泄漏）', () => {
    const allowed = new Set<string>(IMAGE_UIDS);
    for (const obj of FULL_CATALOG) {
      if (obj.imageKey !== undefined || obj.imageCredit !== undefined) {
        expect(allowed.has(obj.objectUid), obj.objectUid).toBe(true);
      }
    }
  });

  it('影像天体仍守合规红线：isNamable=false、isFeatured=true（Messier）', () => {
    for (const uid of IMAGE_UIDS) {
      const obj = getCelestialByUid(uid)!;
      expect(obj.isNamable, uid).toBe(false);
      expect(obj.isFeatured, uid).toBe(true);
    }
  });
});

describe('DSO 真实角尺寸（angularSizeDeg，由 OpenNGC MajAx 换算）', () => {
  it('抽查：M31≈2.9638°、M45=2.5°、M57≈0.0212°', () => {
    expect(getCelestialByUid('M31')!.angularSizeDeg).toBeCloseTo(2.9638, 3);
    expect(getCelestialByUid('M45')!.angularSizeDeg).toBeCloseTo(2.5, 3);
    expect(getCelestialByUid('M57')!.angularSizeDeg).toBeCloseTo(0.0212, 3);
  });

  it('有值时为正数且 < 12°（全目录最大为大麦哲伦云 ESO056-115 ≈ 10.77°）', () => {
    let withSize = 0;
    for (const obj of DEEP_SKY_CATALOG) {
      if (obj.angularSizeDeg === undefined) continue;
      withSize++;
      expect(obj.angularSizeDeg, obj.objectUid).toBeGreaterThan(0);
      expect(obj.angularSizeDeg, obj.objectUid).toBeLessThan(12);
    }
    // deep-sky.json 中 570/574 条带 majAx，全部免费获得真实角尺寸。
    expect(withSize).toBeGreaterThan(500);
  });

  it('恒星目录不受影响（无 angularSizeDeg/imageKey）', () => {
    for (const s of CELESTIAL_CATALOG) {
      expect(s.angularSizeDeg).toBeUndefined();
      expect(s.imageKey).toBeUndefined();
    }
  });
});
