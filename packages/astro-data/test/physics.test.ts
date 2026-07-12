import { describe, expect, it } from 'vitest';
import {
  derivePhysical,
  deriveDsoProfile,
  FULL_CATALOG,
  getCelestialByUid,
  type CelestialObject,
} from '../src/index.js';

/** 构造最小恒星对象（锚点用例）。 */
function makeStar(partial: Partial<CelestialObject>): CelestialObject {
  return {
    objectUid: 'TEST-STAR',
    type: 'star',
    nameEn: 'Test',
    nameZh: '测试星',
    aliases: [],
    constellation: 'Orion',
    constellationZh: '猎户座',
    raDeg: 85,
    decDeg: 0,
    magnitude: 3,
    distanceLy: 100,
    catalogIds: {},
    isNamable: false,
    isFeatured: false,
    ...partial,
  };
}

/** 合规禁用词（命名售卖误导词，任何输出文案不得出现）。 */
const BANNED = /拥有|购买|产权|官方|认证|永久/;

describe('derivePhysical · 恒星锚点校验', () => {
  it('太阳型 G2V（mag 4.83, 32.6ly）→ T=5770、L≈1、M≈1、寿命 9~11 Gyr、主序', () => {
    const p = derivePhysical(makeStar({ spectralType: 'G2V', magnitude: 4.83, distanceLy: 32.6 }))!;
    expect(p.tempK).toBe(5770);
    expect(p.absoluteMag).toBeCloseTo(4.83, 1);
    expect(p.luminositySolar!).toBeGreaterThan(0.9);
    expect(p.luminositySolar!).toBeLessThan(1.1);
    expect(p.massSolar!).toBeGreaterThan(0.95);
    expect(p.massSolar!).toBeLessThan(1.05);
    expect(p.lifespanGyr!).toBeGreaterThan(9);
    expect(p.lifespanGyr!).toBeLessThan(11);
    expect(p.stage).toBe('main_sequence');
    expect(p.fate).toBe('white_dwarf');
    expect(p.colorDesc).toBe('金黄如太阳');
    // 剩余寿命 = 寿命 - 年龄（主序年龄取寿命中值）
    expect(p.ageGyr!).toBeCloseTo(p.lifespanGyr! * 0.5, 5);
    expect(p.remainingGyr!).toBeCloseTo(p.lifespanGyr! - p.ageGyr!, 5);
  });

  it('天狼星 HIP32349（A1V）→ T∈[9300,10000]、L≈25-27、M∈[1.9,2.5]、主序、归宿白矮星', () => {
    const sirius = getCelestialByUid('HIP32349')!;
    const p = derivePhysical(sirius)!;
    expect(p.tempK!).toBeGreaterThanOrEqual(9300);
    expect(p.tempK!).toBeLessThanOrEqual(10000);
    expect(p.luminositySolar!).toBeGreaterThan(24);
    expect(p.luminositySolar!).toBeLessThan(28);
    expect(p.massSolar!).toBeGreaterThanOrEqual(1.9);
    expect(p.massSolar!).toBeLessThanOrEqual(2.5);
    expect(p.stage).toBe('main_sequence');
    expect(p.fate).toBe('white_dwarf');
    expect(p.visibility).toBe('naked_eye');
  });

  it('参宿四 HIP27989（M1Ia）→ T∈[3400,3700]、L≈8×10⁴、超巨星、超新星归宿', () => {
    const betelgeuse = getCelestialByUid('HIP27989')!;
    const p = derivePhysical(betelgeuse)!;
    expect(p.tempK!).toBeGreaterThanOrEqual(3400);
    expect(p.tempK!).toBeLessThanOrEqual(3700);
    expect(p.luminositySolar!).toBeGreaterThan(5e4);
    expect(p.luminositySolar!).toBeLessThan(1.2e5);
    expect(p.stage).toBe('supergiant');
    expect(p.fate.startsWith('supernova')).toBe(true);
    expect(p.colorDesc).toBe('深红如炭火');
    // 红超巨星半径达数百太阳半径
    expect(p.radiusSolar!).toBeGreaterThan(300);
  });

  it('最佳观测月：猎户座 RA 85° → 12 月；可见性按星等分级', () => {
    const p = derivePhysical(makeStar({ raDeg: 85 }))!;
    expect(p.bestMonth).toBe(12);
    expect(derivePhysical(makeStar({ magnitude: 5.9 }))!.visibility).toBe('naked_eye');
    expect(derivePhysical(makeStar({ magnitude: 8 }))!.visibility).toBe('binoculars');
    expect(derivePhysical(makeStar({ magnitude: 12 }))!.visibility).toBe('telescope');
    expect(derivePhysical(makeStar({ magnitude: 14 }))!.visibility).toBe('photo');
  });

  it('光出发年份：nowYear 固定可测；dist > nowYear 输出负值（公元前）', () => {
    const p = derivePhysical(makeStar({ distanceLy: 8.6 }), { nowYear: 2026 })!;
    expect(p.lightDepartYear).toBe(2017);
    const far = derivePhysical(makeStar({ distanceLy: 2600 }), { nowYear: 2026 })!;
    expect(far.lightDepartYear).toBe(-574);
  });

  it('字段级 null：无距离 → 光度链全 null，但光谱字段仍在', () => {
    const p = derivePhysical(makeStar({ spectralType: 'K0III', distanceLy: null }))!;
    expect(p.tempK).toBe(5280);
    expect(p.colorDesc).toBe('橙红温暖');
    expect(p.stage).toBe('giant');
    expect(p.absoluteMag).toBeNull();
    expect(p.luminositySolar).toBeNull();
    expect(p.massSolar).toBeNull();
    expect(p.radiusSolar).toBeNull();
    expect(p.lifespanGyr).toBeNull();
    expect(p.remainingGyr).toBeNull();
    expect(p.lightDepartYear).toBeNull();
    expect(p.fate).toBe('');
  });

  it('脏光谱值可解析：A0m... / M1: comp / K2IIIp / B0.5IV；dF3 不误判白矮星', () => {
    expect(derivePhysical(makeStar({ spectralType: 'A0m...' }))!.tempK).toBe(9900);
    expect(derivePhysical(makeStar({ spectralType: 'M1: comp' }))!.colorDesc).toBe('深红如炭火');
    expect(derivePhysical(makeStar({ spectralType: 'K2IIIp' }))!.stage).toBe('giant');
    expect(derivePhysical(makeStar({ spectralType: 'B0.5IV' }))!.stage).toBe('subgiant');
    expect(derivePhysical(makeStar({ spectralType: 'dF3   J' }))!.stage).not.toBe('white_dwarf');
  });

  it('白矮星前缀 D：stage=white_dwarf，质量/年龄不套主序关系', () => {
    const p = derivePhysical(makeStar({ spectralType: 'DA2', magnitude: 8.44, distanceLy: 8.6 }))!;
    expect(p.stage).toBe('white_dwarf');
    expect(p.fate).toBe('white_dwarf');
    expect(p.massSolar).toBeNull();
    expect(p.ageGyr).toBeNull();
    expect(p.lifespanGyr).toBeNull();
    // BC 取 0 近似仍给出光度（白矮星光度远低于太阳）
    expect(p.luminositySolar!).toBeLessThan(0.1);
  });

  it('星历/太阳系天体返回 null', () => {
    expect(derivePhysical(makeStar({ type: 'planet' }))).toBeNull();
    expect(derivePhysical(makeStar({ isEphemeris: true }))).toBeNull();
    expect(derivePhysical(makeStar({ type: 'comet' }))).toBeNull();
  });

  it('确定性：同一 uid 两次调用 funFacts 完全相同', () => {
    const star = getCelestialByUid('HIP32349')!;
    const a = derivePhysical(star, { nowYear: 2026 })!;
    const b = derivePhysical(star, { nowYear: 2026 })!;
    expect(a.funFacts).toEqual(b.funFacts);
    expect(a.funFacts.length).toBeGreaterThanOrEqual(3);
  });

  it('深南天标注：decDeg < -55° 的星附带「中国大陆」提示', () => {
    const p = derivePhysical(makeStar({ decDeg: -60.8 }))!;
    expect(p.funFacts.some((f) => f.includes('中国大陆'))).toBe(true);
  });
});

describe('deriveDsoProfile · 深空天体档案', () => {
  it('M31：手工表命中——距离 254 万光年、与银河系并合的命运', () => {
    const p = deriveDsoProfile(getCelestialByUid('M31')!, { nowYear: 2026 });
    expect(p.stage).toBe('galaxy');
    expect(p.fate).toContain('并合');
    expect(p.lightDepartYear).toBe(2026 - 2540000);
    expect(p.funFacts.some((f) => f.includes('1 万亿'))).toBe(true);
    expect(p.tempK).toBeNull();
    expect(p.massSolar).toBeNull();
  });

  it('M13 球状星团：ageGyr 有真实值；M45 疏散星团有专属解体命运', () => {
    const m13 = deriveDsoProfile(getCelestialByUid('M13')!);
    expect(m13.stage).toBe('globular_cluster');
    expect(m13.ageGyr).toBeCloseTo(11.65, 2);
    const m45 = deriveDsoProfile(getCelestialByUid('M45')!);
    expect(m45.stage).toBe('open_cluster');
    expect(m45.fate).toContain('各奔东西');
  });

  it('M42 在 OpenNGC 里标为 cluster，手工表纠正为发射星云（恒星摇篮）', () => {
    const p = deriveDsoProfile(getCelestialByUid('M42')!);
    expect(p.stage).toBe('emission_nebula');
    expect(p.funFacts.some((f) => f.includes('原恒星'))).toBe(true);
  });

  it('M1 超新星遗迹 / M27 行星状星云 / M78 反射星云分类正确', () => {
    expect(deriveDsoProfile(getCelestialByUid('M1')!).stage).toBe('supernova_remnant');
    expect(deriveDsoProfile(getCelestialByUid('M27')!).stage).toBe('planetary_nebula');
    expect(deriveDsoProfile(getCelestialByUid('M78')!).stage).toBe('reflection_nebula');
  });

  it('无手工表的 DSO 走 descriptionZh 关键词 + 类型兜底，档案仍完整', () => {
    const m2 = deriveDsoProfile(getCelestialByUid('M2')!);
    expect(m2.stage).toBe('globular_cluster'); // 手工表
    // 任取一个非 Messier DSO：模板兜底也要有命运与 funFacts
    const other = FULL_CATALOG.find(
      (o) => o.type !== 'star' && !o.isEphemeris && o.objectUid.startsWith('NGC'),
    );
    if (other) {
      const p = deriveDsoProfile(other);
      expect(p.fate.length).toBeGreaterThan(0);
      expect(p.funFacts.length).toBeGreaterThan(0);
      expect(p.bestMonth).toBeGreaterThanOrEqual(1);
      expect(p.bestMonth).toBeLessThanOrEqual(12);
    }
  });

  it('derivePhysical 对 DSO 自动分派 deriveDsoProfile（单一入口）', () => {
    const m31 = getCelestialByUid('M31')!;
    expect(derivePhysical(m31, { nowYear: 2026 })).toEqual(
      deriveDsoProfile(m31, { nowYear: 2026 }),
    );
  });
});

describe('合规红线：全目录档案文案禁用词自检', () => {
  it('恒星与 DSO 的所有输出文案不含「拥有/购买/产权/官方/认证/永久」', () => {
    // 全量 8896 恒星 + 574 DSO 逐条推导并检查（纯函数，全量跑得动）
    for (const obj of FULL_CATALOG) {
      const p = derivePhysical(obj, { nowYear: 2026 });
      if (!p) continue;
      const text = [p.stage, p.fate, p.fateDesc, p.colorDesc, ...p.funFacts].join('\n');
      expect(text).not.toMatch(BANNED);
    }
  });

  it('数值字段全量健壮：非 NaN/Infinity，寿命与质量在物理合理区间', () => {
    for (const obj of FULL_CATALOG) {
      const p = derivePhysical(obj, { nowYear: 2026 });
      if (!p) continue;
      for (const v of [p.tempK, p.massSolar, p.radiusSolar, p.luminositySolar, p.ageGyr, p.lifespanGyr, p.remainingGyr, p.absoluteMag]) {
        if (v != null) expect(Number.isFinite(v)).toBe(true);
      }
      if (p.massSolar != null) {
        expect(p.massSolar).toBeGreaterThanOrEqual(0.08);
        expect(p.massSolar).toBeLessThanOrEqual(60);
      }
      if (p.lifespanGyr != null) expect(p.lifespanGyr).toBeGreaterThanOrEqual(0.003);
    }
  });
});
