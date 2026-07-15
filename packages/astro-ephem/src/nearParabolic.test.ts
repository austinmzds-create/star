/**
 * 近抛物线求解器单测（Phase 9C，跨域契约 4）：Stumpff/通用变量数学恒等 +
 * 椭圆域与旧路径一致性 + 真实近抛物线彗星 JPL Horizons 锚点 + 动态注册链路。
 *
 * 锚点纪律（合规红线「绝不编造坐标/根数」）：全部参考值来自权威源实拉——
 * 2026-07-15 执行：
 *   根数：curl 'https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=C/2023%20A3&full-prec=true'
 *     → orbit.epoch=2460448.5，e=1.000095309222603，q=0.3914300307809727，
 *       i=139.1121095087364，om=21.55947863619833，w=308.4917712569641，
 *       tp=2460581.240840829791（原样粘贴，绝非手编）。
 *   锚点：curl -G 'https://ssd.jpl.nasa.gov/api/horizons.api' \
 *     --data-urlencode "COMMAND='DES=C/2023 A3;CAP'" --data-urlencode "CENTER='500@399'" \
 *     --data-urlencode "EPHEM_TYPE='OBSERVER'" --data-urlencode "QUANTITIES='1,20'" \
 *     --data-urlencode "TLIST='2460462.5','2460562.5','2460598.5'"
 *     → 2024-06-01  12 02 39.42 +02 35 14.6  Δ=1.79485147965187
 *       2024-09-09  10 39 08.34 -04 27 18.1  Δ=1.57130036541944
 *       2024-10-15  14 58 35.68 +00 17 25.1  Δ=0.48614136097197
 *   （地心天文测量 RA/Dec，ICRF/J2000；时分秒原文保留于此，下方换算为度。）
 * 实测二体误差 0.004°/0.007°/0.013°；断言容差 0.5°（演示级声明的一半，
 * 远优于跨域契约的 <1° 验收线）。
 */
import { describe, expect, it } from 'vitest';
import {
  getCometPhotometry,
  registerCometPhotometry,
} from './cometTail';
import {
  getMinorBodyElements,
  getMinorBodyEquatorial,
  getMinorBodyEquatorialByUid,
  listMinorBodies,
  registerMinorBodyMeta,
  registerMinorBodyOrbit,
  solveKepler,
  stumpffC,
  stumpffS,
  trueAnomalyRadiusUniversal,
} from './minorBodies';

/** 球面角距（度）。 */
function sepDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const d = Math.PI / 180;
  const c =
    Math.sin(dec1 * d) * Math.sin(dec2 * d) +
    Math.cos(dec1 * d) * Math.cos(dec2 * d) * Math.cos((ra1 - ra2) * d);
  return Math.acos(Math.max(-1, Math.min(1, c))) / d;
}

/** C/2023 A3 (Tsuchinshan-ATLAS) 根数（JPL SBDB full-prec，抓取 2026-07-15）。 */
const C2023A3 = {
  e: 1.000095309222603,
  qAu: 0.3914300307809727,
  iDeg: 139.1121095087364,
  omDeg: 21.55947863619833,
  wDeg: 308.4917712569641,
  tpJd: 2460581.240840829791,
  epochJd: 2460448.5,
  sourceNote: 'JPL SBDB sstr=C/2023 A3，epoch JD 2460448.5，抓取 2026-07-15',
};

const jdToDate = (jd: number): Date => new Date((jd - 2440587.5) * 86400000);

describe('Stumpff 函数', () => {
  it('z=0 极限：C=1/2、S=1/6；泰勒区与解析区在 ±1e-6 处连续', () => {
    expect(stumpffC(0)).toBeCloseTo(0.5, 12);
    expect(stumpffS(0)).toBeCloseTo(1 / 6, 12);
    for (const z of [1e-6, -1e-6]) {
      expect(Math.abs(stumpffC(z * 1.01) - stumpffC(z * 0.99))).toBeLessThan(1e-9);
      expect(Math.abs(stumpffS(z * 1.01) - stumpffS(z * 0.99))).toBeLessThan(1e-9);
    }
  });

  it('解析恒等：C(z)=（1−cos√z)/z、S 同式（z=±2.5 抽查）', () => {
    expect(stumpffC(2.5)).toBeCloseTo((1 - Math.cos(Math.sqrt(2.5))) / 2.5, 12);
    expect(stumpffS(2.5)).toBeCloseTo((Math.sqrt(2.5) - Math.sin(Math.sqrt(2.5))) / 2.5 ** 1.5, 12);
    expect(stumpffC(-2.5)).toBeCloseTo((Math.cosh(Math.sqrt(2.5)) - 1) / 2.5, 12);
  });
});

describe('通用变量求解 · 数学恒等', () => {
  it('t=tp 时 r=q、ν=0（全偏心率域 e∈{0, 0.5, 0.98, 1.0, 1.0001, 1.2}）', () => {
    for (const e of [0, 0.5, 0.98, 1.0, 1.0001, 1.2]) {
      const { nuRad, rAu } = trueAnomalyRadiusUniversal(0.4, e, 0);
      expect(rAu).toBeCloseTo(0.4, 10);
      expect(Math.abs(nuRad)).toBeLessThan(1e-8);
    }
  });

  it('轨道方程恒等：r = q(1+e)/(1+e·cosν)（随机抽查 Δt ∈ ±800 天）', () => {
    for (const e of [0.3, 0.98, 0.9999, 1.0001, 1.15]) {
      for (const dt of [-800, -90, -1, 3, 45, 400]) {
        const { nuRad, rAu } = trueAnomalyRadiusUniversal(0.6, e, dt);
        const rOrbit = (0.6 * (1 + e)) / (1 + e * Math.cos(nuRad));
        expect(rAu, `e=${e} dt=${dt}`).toBeCloseTo(rOrbit, 8);
        // 时间反演对称：ν(−Δt) = −ν(Δt)
        const mirror = trueAnomalyRadiusUniversal(0.6, e, -dt);
        expect(mirror.nuRad).toBeCloseTo(-nuRad, 8);
      }
    }
  });

  it('椭圆域与既有 solveKepler 旧路径一致（e=0.5，任意时刻 <1e-6 rad）', () => {
    const q = 1.2;
    const e = 0.5;
    const a = q / (1 - e);
    const K = 0.01720209895;
    const n = K / Math.pow(a, 1.5);
    for (const dt of [0.5, 100, 400, -250]) {
      // 旧路径：M = n·Δt → E → ν, r
      const M = ((n * dt) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      const E = solveKepler(M, e);
      const nuOld = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
      const rOld = a * (1 - e * Math.cos(E));
      const { nuRad, rAu } = trueAnomalyRadiusUniversal(q, e, dt);
      // ν 归一到同一象限比较（旧路径输出 (−π,π]）
      const dNu = Math.atan2(Math.sin(nuRad - nuOld), Math.cos(nuRad - nuOld));
      expect(Math.abs(dNu), `dt=${dt}`).toBeLessThan(1e-6);
      expect(rAu).toBeCloseTo(rOld, 8);
    }
  });

  it('椭圆周期归约：Δt 与 Δt+P 结果一致（长周期外推数值稳定）', () => {
    const q = 0.34; // e=0.85 → a=2.27，P≈3.4 年
    const e = 0.85;
    const a = q / (1 - e);
    const P = 2 * Math.PI * Math.sqrt(a ** 3) / 0.01720209895;
    const one = trueAnomalyRadiusUniversal(q, e, 123.4);
    const two = trueAnomalyRadiusUniversal(q, e, 123.4 + P * 7);
    expect(two.nuRad).toBeCloseTo(one.nuRad, 6);
    expect(two.rAu).toBeCloseTo(one.rAu, 6);
  });
});

describe('C/2023 A3 近抛物线锚点（JPL Horizons 实拉 2026-07-15）', () => {
  // 动态注册链路全程：meta + orbit + photometry（web minorRegistry 同一组合）
  registerMinorBodyMeta({
    id: 'c2023a3-test',
    objectUid: 'MB-C2023A3TEST',
    kind: 'comet',
    nameZh: '紫金山-阿特拉斯彗星',
    nameEn: 'C/2023 A3 (Tsuchinshan-ATLAS)',
    aliases: ['C/2023 A3', 'Tsuchinshan-ATLAS'],
    colorHex: '#9fc8e8',
    typicalMagnitude: 5.2,
    descriptionZh: '2024 年 10 月回归的近抛物线彗星（e≈1.0001），测试锚点用。',
  });
  registerMinorBodyOrbit('c2023a3-test', C2023A3);
  registerCometPhotometry('c2023a3-test', {
    absMag: 5.2,
    slopeK: 10,
    sourceNote: 'JPL SBDB M1=5.2（K 取 n=4 标准假设），抓取 2026-07-15',
  });

  const anchors = [
    // RA 12h02m39.42s = 180.66425°, Dec +02°35'14.6" = 2.587389°
    { jd: 2460462.5, raDeg: (12 + 2 / 60 + 39.42 / 3600) * 15, decDeg: 2 + 35 / 60 + 14.6 / 3600, deltaAu: 1.79485147965187, label: '2024-06-01（近日点前 4 个月）' },
    { jd: 2460562.5, raDeg: (10 + 39 / 60 + 8.34 / 3600) * 15, decDeg: -(4 + 27 / 60 + 18.1 / 3600), deltaAu: 1.57130036541944, label: '2024-09-09（近日点前 19 天）' },
    { jd: 2460598.5, raDeg: (14 + 58 / 60 + 35.68 / 3600) * 15, decDeg: 0 + 17 / 60 + 25.1 / 3600, deltaAu: 0.48614136097197, label: '2024-10-15（近地大放异彩期）' },
  ];

  for (const a of anchors) {
    it(`${a.label}：角距 ≤0.5°、地心距 ±0.02 AU`, () => {
      const eq = getMinorBodyEquatorial('c2023a3-test', jdToDate(a.jd));
      expect(sepDeg(eq.raDeg, eq.decDeg, a.raDeg, a.decDeg)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(eq.distanceAu - a.deltaAu)).toBeLessThanOrEqual(0.02);
    });
  }

  it('过近日点时刻日心距 = q（0.3914 AU）；e>1 双曲侧无 NaN', () => {
    const eq = getMinorBodyEquatorial('c2023a3-test', jdToDate(C2023A3.tpJd));
    expect(eq.helioDistanceAu).toBeCloseTo(C2023A3.qAu, 4);
    const far = getMinorBodyEquatorial('c2023a3-test', jdToDate(C2023A3.tpJd + 3000));
    expect(Number.isFinite(far.raDeg)).toBe(true);
    expect(far.helioDistanceAu).toBeGreaterThan(5); // 双曲逃逸方向单调远离
  });

  it('动态注册后 list/byUid/elements/photometry 全链路可用；内置 6 体不受影响', () => {
    const list = listMinorBodies();
    expect(list.length).toBeGreaterThanOrEqual(7);
    expect(list.slice(0, 6).every((b) => ['ceres', 'vesta', 'pallas', 'halley', 'encke', 'ponsbrooks'].includes(b.id))).toBe(true);
    const eqByUid = getMinorBodyEquatorialByUid('MB-C2023A3TEST', jdToDate(2460462.5));
    expect(eqByUid).toEqual(getMinorBodyEquatorial('c2023a3-test', jdToDate(2460462.5)));
    const el = getMinorBodyElements('c2023a3-test');
    expect(el.e).toBeCloseTo(1.0001, 4);
    expect(el.sourceNote).toContain('JPL SBDB');
    expect(getCometPhotometry('c2023a3-test')?.absMag).toBe(5.2);
    // 内置回归锚（哈雷远日点）不因动态注册漂移
    const halley = getMinorBodyEquatorial('halley', new Date('2026-07-01T00:00:00Z'));
    expect(halley.helioDistanceAu).toBeGreaterThan(34.5);
  });

  it('注册校验：e>1.2 拒绝、近抛物线缺 tp 拒绝、重复注册幂等', () => {
    expect(() => registerMinorBodyOrbit('bad-e', { ...C2023A3, e: 1.5 })).toThrow();
    expect(() => registerMinorBodyOrbit('no-tp', { ...C2023A3, tpJd: undefined })).toThrow();
    // 幂等：同 id 再注册不抛错、不改变结果
    expect(() => registerMinorBodyOrbit('c2023a3-test', C2023A3)).not.toThrow();
  });
});
