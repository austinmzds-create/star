import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyStarExtrasToCatalog,
  CELESTIAL_CATALOG,
  DEEP_SKY_CATALOG,
  FULL_CATALOG,
  getCelestialByUid,
  loadStarExtras,
  searchCelestial,
} from '../src/index.js';
import brightStars from '../src/generated/bright-stars.json';

describe('CELESTIAL_CATALOG 数据完整性', () => {
  it('每颗星的字段都在合法范围内', () => {
    for (const s of CELESTIAL_CATALOG) {
      expect(s.raDeg).toBeGreaterThanOrEqual(0);
      expect(s.raDeg).toBeLessThan(360);
      expect(s.decDeg).toBeGreaterThanOrEqual(-90);
      expect(s.decDeg).toBeLessThanOrEqual(90);
      expect(s.nameEn.length).toBeGreaterThan(0);
      expect(s.nameZh.length).toBeGreaterThan(0);
      expect(s.constellationZh).not.toBe(s.constellation); // 中文映射应生效（全 88 覆盖）
      expect(Number.isFinite(s.magnitude)).toBe(true);
    }
  });

  it('目录规模合理（有 generated 时 > 3000，降级时 >= 60）', () => {
    expect(CELESTIAL_CATALOG.length).toBeGreaterThanOrEqual(60);
  });

  it('distanceLy 要么 null 要么正数', () => {
    for (const s of CELESTIAL_CATALOG) {
      if (s.distanceLy !== null) {
        expect(s.distanceLy).toBeGreaterThan(0);
      }
    }
  });

  it('objectUid 全局唯一', () => {
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

  it('renderPriority 值域 ∈ {0,1,2,3}，著名星为 0', () => {
    for (const s of CELESTIAL_CATALOG) {
      if (s.renderPriority !== undefined) {
        expect([0, 1, 2, 3]).toContain(s.renderPriority);
      }
      if (s.isFeatured) {
        expect(s.renderPriority).toBe(0);
      }
    }
  });
});

describe('合并去重（手写 60 优先）', () => {
  const HANDWRITTEN_UIDS = [
    'HIP32349', 'HIP91262', 'HIP11767', 'HIP97649', 'HIP27989', 'HIP70890',
  ];

  it('手写精选星全部保留，未被 generated 覆盖（保留中文名/简介/isFeatured）', () => {
    for (const uid of HANDWRITTEN_UIDS) {
      const s = getCelestialByUid(uid);
      expect(s, uid).toBeDefined();
      expect(s!.isFeatured).toBe(true);
      expect(s!.descriptionZh && s!.descriptionZh.length).toBeGreaterThan(0);
      expect(s!.sourceCatalog).toBe('handwritten');
    }
  });

  it('无 hip 编号交集重复（归一化后 hip 唯一）', () => {
    const seen = new Set<string>();
    for (const s of CELESTIAL_CATALOG) {
      const hip = s.catalogIds.hip?.replace(/^0+/, '');
      if (!hip) continue;
      expect(seen.has(hip), `hip 重复:${hip}`).toBe(false);
      seen.add(hip);
    }
  });

  it('天狼星只有一条（generated 版被去重）', () => {
    const siri = CELESTIAL_CATALOG.filter((s) => s.catalogIds.hip === '32349');
    expect(siri.length).toBe(1);
    expect(siri[0]?.nameZh).toBe('天狼星');
  });
});

describe('featured / isNamable 策略', () => {
  it('所有著名星 isNamable=false（合规红线）', () => {
    for (const s of CELESTIAL_CATALOG) {
      if (s.isFeatured) {
        expect(s.isNamable, s.objectUid).toBe(false);
      }
    }
  });

  it('存在命名候选池：isNamable 星均为非著名、4.0≤mag≤6.0、有 HIP', () => {
    const namable = CELESTIAL_CATALOG.filter((s) => s.isNamable);
    expect(namable.length).toBeGreaterThan(0);
    for (const s of namable) {
      expect(s.isFeatured).toBe(false);
      expect(s.magnitude).toBeGreaterThanOrEqual(4.0);
      expect(s.magnitude).toBeLessThanOrEqual(6.0);
      expect(s.catalogIds.hip).toBeTruthy();
    }
  });
});

describe('核心层扩容（mag ≤ 6.5）', () => {
  it('核心层规模 ∈ [8000,10000]，meta.magLimit = 6.5', () => {
    expect(CELESTIAL_CATALOG.length).toBeGreaterThanOrEqual(8000);
    expect(CELESTIAL_CATALOG.length).toBeLessThanOrEqual(10000);
    expect(brightStars.meta.magLimit).toBe(6.5);
  });

  it('命名池规则不变的回归锁：6.0 < mag ≤ 6.5 的新增星 isNamable=false', () => {
    const dim = CELESTIAL_CATALOG.filter(
      (s) => s.magnitude > 6.0 && s.magnitude <= 6.5,
    );
    expect(dim.length).toBeGreaterThan(1000); // 扩容层确实存在
    for (const s of dim) {
      expect(s.isNamable, s.objectUid).toBe(false);
    }
  });

  it('FULL_CATALOG 长度 = 恒星表 + 深空表之和', () => {
    expect(FULL_CATALOG.length).toBe(CELESTIAL_CATALOG.length + DEEP_SKY_CATALOG.length);
  });
});

describe('扩展层产物（apps/web/public/data/stars-extended.json）', () => {
  const extPath = resolve(__dirname, '../../../apps/web/public/data/stars-extended.json');

  it('文件存在且列式数组等长、坐标/星等/光谱/自行域合法', () => {
    expect(existsSync(extPath), extPath).toBe(true);
    const ext = JSON.parse(readFileSync(extPath, 'utf8')) as {
      meta: { magRange: [number, number]; count: number };
      n: number;
      ra: number[];
      dec: number[];
      mag: number[];
      spec: string;
      pmra: number[];
      pmdec: number[];
    };
    expect(ext.n).toBe(ext.meta.count);
    expect(ext.ra.length).toBe(ext.n);
    expect(ext.dec.length).toBe(ext.n);
    expect(ext.mag.length).toBe(ext.n);
    expect(ext.spec.length).toBe(ext.n);
    expect(ext.pmra.length).toBe(ext.n);
    expect(ext.pmdec.length).toBe(ext.n);
    expect(ext.n).toBeGreaterThanOrEqual(14000);
    expect(ext.n).toBeLessThanOrEqual(20000);
    for (let i = 0; i < ext.n; i++) {
      expect(ext.ra[i]!).toBeGreaterThanOrEqual(0);
      expect(ext.ra[i]!).toBeLessThan(360);
      expect(ext.dec[i]!).toBeGreaterThanOrEqual(-90);
      expect(ext.dec[i]!).toBeLessThanOrEqual(90);
      expect(ext.mag[i]!).toBeGreaterThan(6.5);
      expect(ext.mag[i]!).toBeLessThanOrEqual(7.51);
      // 自行列：int16 语义整数（单位 0.5 mas/yr，解码 = 值 × 0.5）
      expect(Number.isInteger(ext.pmra[i]!)).toBe(true);
      expect(Number.isInteger(ext.pmdec[i]!)).toBe(true);
      expect(Math.abs(ext.pmra[i]!)).toBeLessThanOrEqual(32767);
      expect(Math.abs(ext.pmdec[i]!)).toBeLessThanOrEqual(32767);
    }
    expect(/^[OBAFGKM?]+$/.test(ext.spec)).toBe(true);
  });
});

describe('恒星自行（9B 星座时光机 → 9C star-extras 迁移）', () => {
  // 期望值全部先用 awk/python 对缓存 CSV（scripts/.cache/hygdata.csv，HYG v41）实跑核实
  // 再写入断言（2026-07-15）；ETL round 0.1 mas/yr。
  // 9C 主 chunk 回收：pm 不再随 bright-stars.json 进主表，目录对象在
  // applyStarExtrasToCatalog 前不带 pm——lean 断言在前，回填断言在后（同文件顺序执行）。

  it('lean 断言：extras 回填前，主表 JSON（列式）无 pm/ci 列，目录对象无 pm（First Load 回收）', () => {
    // 主表 JSON（9C columnar-v1）：只允许 lean 列集合
    const cols = (brightStars as { cols: Record<string, unknown[]> }).cols;
    expect(Object.keys(cols).sort()).toEqual(
      ['bayer', 'bf', 'con', 'dec', 'dist', 'flam', 'hd', 'hip', 'hr', 'mag', 'proper', 'ra', 'spect'].sort(),
    );
    expect('pmra' in cols).toBe(false);
    expect('ci' in cols).toBe(false);
    // 目录对象：除手写兜底星（比邻星）外全部无 pm（回填前）
    const g1830 = getCelestialByUid('HIP57939')!; // generated 直通星
    expect(g1830.pmRaMasYr).toBeUndefined();
    // 手写兜底通道仍在（extras 覆盖不到时的红线兜底）
    expect(getCelestialByUid('HIP70890')!.pmRaMasYr).toBeCloseTo(-3775.6, 1);
  });

  it('回填断言：applyStarExtrasToCatalog 后核心层 pm 覆盖率 100%、锚点值精确', async () => {
    const extras = await loadStarExtras();
    applyStarExtrasToCatalog(extras);

    const sirius = getCelestialByUid('HIP32349')!;
    expect(sirius.sourceCatalog).toBe('handwritten'); // 回填不改变手写优先语义
    expect(sirius.pmRaMasYr).toBeCloseTo(-546.0, 0);
    expect(sirius.pmDecMasYr).toBeCloseTo(-1223.1, 0);

    const arcturus = getCelestialByUid('HIP69673')!;
    expect(arcturus.pmRaMasYr).toBeCloseTo(-1093.4, 0);
    expect(arcturus.pmDecMasYr).toBeCloseTo(-1999.4, 0);
    const vega = getCelestialByUid('HIP91262')!;
    expect(vega.pmRaMasYr).toBeCloseTo(201.0, 0);
    expect(vega.pmDecMasYr).toBeCloseTo(287.5, 0);

    // 核心层最快星 Groombridge 1830：深时模式量级自证（7.06″/yr × 10 万年 ≈ 196°，
    // 远超小角度域——渲染侧必须用精确大圆旋转，TwinkleStars shader 注释同步声明）。
    const g1830 = getCelestialByUid('HIP57939')!;
    expect(g1830.pmRaMasYr).toBeCloseTo(4003.7, 0);
    expect(g1830.pmDecMasYr).toBeCloseTo(-5813.0, 0);
    const totalMasYr = Math.hypot(g1830.pmRaMasYr!, g1830.pmDecMasYr!);
    expect(totalMasYr).toBeGreaterThan(6900);
    expect(totalMasYr).toBeLessThan(7200);

    // 北斗七星形变方向锚点（astroEDU/大熊座移动星群）：+10 万年勺柄拉直、勺口张开。
    expect(getCelestialByUid('HIP54061')!.pmRaMasYr!).toBeLessThan(0); // 天枢
    expect(getCelestialByUid('HIP67301')!.pmRaMasYr!).toBeLessThan(0); // 摇光
    for (const hip of ['HIP53910', 'HIP58001', 'HIP59774', 'HIP62956', 'HIP65378']) {
      expect(getCelestialByUid(hip)!.pmRaMasYr!, hip).toBeGreaterThan(0); // 天璇…开阳
    }

    // 覆盖率 100% + 值域（HYG v41 分量截断上限 9999.99，Barnard 星不在层内）
    let withPm = 0;
    for (const s of CELESTIAL_CATALOG) {
      if (s.pmRaMasYr === undefined) continue;
      withPm++;
      expect(Number.isFinite(s.pmRaMasYr)).toBe(true);
      expect(Number.isFinite(s.pmDecMasYr!)).toBe(true);
      expect(Math.abs(s.pmRaMasYr!)).toBeLessThan(10500);
      expect(Math.abs(s.pmDecMasYr!)).toBeLessThan(10500);
    }
    expect(withPm).toBe(CELESTIAL_CATALOG.length);
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

  it('HD 编号可搜索（别名命中天狼星）', () => {
    expect(searchCelestial('HD 48915')[0]?.object.nameEn).toBe('Sirius');
  });

  it('星座名返回该星座下的天体（名称前缀命中的 M42 置顶，恒星按亮度跟随）', () => {
    const r = searchCelestial('猎户座');
    expect(r.length).toBeGreaterThan(1);
    // 「猎户座大星云」是名称前缀命中（权重 1），高于恒星的星座字段命中（权重 0.6）。
    expect(r[0]?.object.objectUid).toBe('M42');
    const rigel = r.find((h) => h.object.nameEn === 'Rigel');
    expect(rigel).toBeDefined(); // 猎户座最亮恒星仍在前列
    for (const hit of r) {
      expect(hit.object.constellationZh).toBe('猎户座');
    }
  });

  it('著名星置顶（搜天狼星，首条为 featured）', () => {
    const r = searchCelestial('天狼星');
    expect(r[0]?.object.isFeatured).toBe(true);
    expect(r[0]?.object.nameEn).toBe('Sirius');
  });

  it('前缀匹配排在包含匹配之前', () => {
    const r = searchCelestial('北');
    expect(r[0]?.object.nameZh.startsWith('北')).toBe(true);
  });

  it('空查询返回空', () => {
    expect(searchCelestial('   ')).toEqual([]);
  });

  it('尊重 limit', () => {
    expect(searchCelestial('座', { limit: 3 }).length).toBeLessThanOrEqual(3);
  });

  it('深空天体可搜索：M31 / 仙女座星系 / 仙女座大星云 / NGC 224 均命中 M31', () => {
    expect(searchCelestial('M31')[0]?.object.objectUid).toBe('M31');
    expect(searchCelestial('仙女座星系')[0]?.object.objectUid).toBe('M31');
    expect(searchCelestial('仙女座大星云')[0]?.object.objectUid).toBe('M31');
    expect(searchCelestial('NGC 224')[0]?.object.objectUid).toBe('M31');
  });

  it('深空天体可搜索：猎户座大星云命中 M42，「昴」命中 M45', () => {
    expect(searchCelestial('猎户座大星云')[0]?.object.objectUid).toBe('M42');
    expect(searchCelestial('昴')[0]?.object.objectUid).toBe('M45');
  });

  it('性能：100 次查询在宽松阈值内（索引缓存生效）', () => {
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      searchCelestial('a');
    }
    const elapsed = Date.now() - start;
    // 阈值随目录扩容（5k → 9.5k：核心层 mag≤6.5 + 深空 574）等比放宽；
    // 若索引缓存失效（每次查询重建），耗时会数倍于此，仍能被本测试捕获。
    expect(elapsed).toBeLessThan(1500);
  });
});
