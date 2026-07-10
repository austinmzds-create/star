import { describe, expect, it } from 'vitest';
import {
  CELESTIAL_CATALOG,
  getCelestialByUid,
  searchCelestial,
} from '../src/index.js';

describe('CELESTIAL_CATALOG 数据完整性', () => {
  it('每颗星的字段都在合法范围内', () => {
    for (const s of CELESTIAL_CATALOG) {
      expect(s.raDeg).toBeGreaterThanOrEqual(0);
      expect(s.raDeg).toBeLessThan(360);
      expect(s.decDeg).toBeGreaterThanOrEqual(-90);
      expect(s.decDeg).toBeLessThanOrEqual(90);
      expect(s.nameEn.length).toBeGreaterThan(0);
      expect(s.nameZh.length).toBeGreaterThan(0);
      expect(s.constellationZh).not.toBe(s.constellation); // 中文映射应生效
      expect(Number.isFinite(s.magnitude)).toBe(true);
    }
  });

  it('objectUid 唯一', () => {
    const uids = new Set(CELESTIAL_CATALOG.map((s) => s.objectUid));
    expect(uids.size).toBe(CELESTIAL_CATALOG.length);
  });

  it('按视星等从亮到暗排序，天狼星排第一', () => {
    expect(CELESTIAL_CATALOG[0]?.nameEn).toBe('Sirius');
    for (let i = 1; i < CELESTIAL_CATALOG.length; i++) {
      expect(CELESTIAL_CATALOG[i]!.magnitude).toBeGreaterThanOrEqual(
        CELESTIAL_CATALOG[i - 1]!.magnitude,
      );
    }
  });
});

describe('getCelestialByUid', () => {
  it('能取到已知星体，未知返回 undefined', () => {
    expect(getCelestialByUid('HIP32349')?.nameEn).toBe('Sirius');
    expect(getCelestialByUid('NOPE')).toBeUndefined();
  });
});

describe('searchCelestial', () => {
  it('中文名精确命中', () => {
    const r = searchCelestial('织女星');
    expect(r[0]?.object.nameEn).toBe('Vega');
    expect(r[0]?.matchedOn).toBe('name');
  });

  it('英文名大小写不敏感', () => {
    expect(searchCelestial('sirius')[0]?.object.nameZh).toBe('天狼星');
    expect(searchCelestial('SIRIUS')[0]?.object.nameZh).toBe('天狼星');
  });

  it('别名可命中（河鼓二 -> 牛郎星）', () => {
    const r = searchCelestial('河鼓二');
    expect(r[0]?.object.nameEn).toBe('Altair');
  });

  it('中文别名 北辰/勾陈一 命中北极星', () => {
    expect(searchCelestial('勾陈一')[0]?.object.nameEn).toBe('Polaris');
    expect(searchCelestial('北辰')[0]?.object.nameEn).toBe('Polaris');
  });

  it('HIP 编号可搜索', () => {
    expect(searchCelestial('HIP32349')[0]?.object.nameEn).toBe('Sirius');
    expect(searchCelestial('32349')[0]?.object.nameEn).toBe('Sirius');
  });

  it('星座名返回该星座下的星，按亮度优先', () => {
    const r = searchCelestial('猎户座');
    expect(r.length).toBeGreaterThan(1);
    expect(r[0]?.object.nameEn).toBe('Rigel'); // 猎户座最亮
    for (const hit of r) {
      expect(hit.object.constellationZh).toBe('猎户座');
    }
  });

  it('前缀匹配排在包含匹配之前', () => {
    const r = searchCelestial('北');
    // 「北河三」「北河二」「北极星」「北极二」「北落师门」都以「北」开头
    expect(r[0]?.object.nameZh.startsWith('北')).toBe(true);
  });

  it('空查询返回空', () => {
    expect(searchCelestial('   ')).toEqual([]);
  });

  it('尊重 limit', () => {
    expect(searchCelestial('座', { limit: 3 }).length).toBeLessThanOrEqual(3);
  });
});
