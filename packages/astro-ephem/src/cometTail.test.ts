/**
 * 真彗尾几何单测（Phase 9B）：光度/尾长公式数值锚点 + 离子尾方向的
 * 独立三维验证 + 尘埃尾骨架健全性 + 可见性阈值行为。
 *
 * 锚点纪律：所有断言数值先经 2026-07-15 实跑核实（含 JPL Horizons 对照拉取，
 * 命令见 minorBodies.test.ts 头注释同法，QUANTITIES='1,19,20'）后写入：
 *   - 1P/Halley 1986-03-13（Horizons r=0.887493 Δ=0.987420）：本实现二体传播
 *     r=0.8987、Δ=0.9554、θ_ion=8.30°、尘尾 10.5°、m=5.03；
 *   - 1P/Halley 2026-07-15：r=35.19，θ≈5.4e-6°（自动无尾），m≈25.7；
 *   - 2P/Encke 近日点 2023-10-22（SBDB tp JD 2460239.65）：r=0.338≈q，θ=7.42°；
 *   - 12P 近日点 2024-04-21（SBDB tp JD 2460421.63）：r=0.781≈q，θ=13.34°。
 * 公式为演示级经验式（文件头声明），断言一律用区间而非精确值。
 */
import { Body, HelioVector } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import {
  angleBetween,
  brightnessFromMagnitude,
  cometApparentMagnitude,
  cometComaDiameterKm,
  cometTailLengthKm,
  computeCometTailGeometry,
  computeDustSkeleton,
  COMET_PHOTOMETRY,
  ionTailTangentDir,
  tailApparentAngleRad,
  unitVectorFromRaDec,
  VISIBLE_ANGLE_MIN_RAD,
  type Vec3Like,
} from './cometTail';
import { getEquatorial } from './ephemeris';
import { getMinorBodyEquatorial } from './minorBodies';

const DEG = Math.PI / 180;
const R2D = 180 / Math.PI;

function vecNorm(v: Vec3Like): number {
  return Math.hypot(v.x, v.y, v.z);
}

describe('光度与尾长公式（纯数值）', () => {
  it('哈雷 1986 量级：m(r=0.887, Δ=0.987) ≈ 5.05（区间 4.5–5.5）', () => {
    const p = COMET_PHOTOMETRY.halley!;
    const m = cometApparentMagnitude(p, 0.887, 0.987);
    expect(m).toBeGreaterThan(4.5);
    expect(m).toBeLessThan(5.5);
  });

  it('尾长/彗发随日心距单调收缩：r=0.9 → 尾千万 km 级；r=35 → 尾 <1e4 km', () => {
    const p = COMET_PHOTOMETRY.halley!;
    const near = cometTailLengthKm(p, 0.9);
    const far = cometTailLengthKm(p, 35);
    // 实跑：near ≈ 8.7e6 km、far ≈ 2e2 km
    expect(near).toBeGreaterThan(3e6);
    expect(near).toBeLessThan(3e7);
    expect(far).toBeLessThan(1e4);
    expect(cometComaDiameterKm(p, 0.9)).toBeGreaterThan(1e4);
    expect(cometComaDiameterKm(p, 0.9)).toBeLessThan(5e6);
  });

  it('视角长 θ = atan(L/(Δ·AU))：1e7 km / 1 AU ≈ 3.8°', () => {
    const theta = tailApparentAngleRad(1e7, 1);
    expect(theta * R2D).toBeGreaterThan(3.5);
    expect(theta * R2D).toBeLessThan(4.2);
  });

  it('亮度映射：m=5 → 1；m=7.5 → 0.1；m=25 → ≈0', () => {
    expect(brightnessFromMagnitude(5)).toBeCloseTo(1, 6);
    expect(brightnessFromMagnitude(7.5)).toBeCloseTo(0.1, 3);
    expect(brightnessFromMagnitude(25)).toBeLessThan(1e-6);
  });
});

describe('离子尾切向 T_ion = normalize(P̂(P̂·Ŝ)−Ŝ)', () => {
  it('数学性质：与 P̂ 正交、单位长、位于 P-S 大圆面内', () => {
    const p = unitVectorFromRaDec(40, 10);
    const s = unitVectorFromRaDec(100, -5);
    const t = ionTailTangentDir(p, s);
    expect(vecNorm(t)).toBeCloseTo(1, 8);
    expect(p.x * t.x + p.y * t.y + p.z * t.z).toBeCloseTo(0, 8);
    // 与太阳方向的夹角应为钝角（背向太阳一侧）
    expect(s.x * t.x + s.y * t.y + s.z * t.z).toBeLessThan(0);
  });

  it('退化情形（彗星与太阳同视方向）返回零向量', () => {
    const p = unitVectorFromRaDec(40, 10);
    expect(vecNorm(ionTailTangentDir(p, p))).toBe(0);
  });

  it('端到端独立验证（先实跑再断言）：日心 3D 反日射线投影回天球的切向与 T_ion 点积 > 0.99', () => {
    // 独立路径：彗星日心位置 C 沿 +Ĉ（反日）取一点，从当前地球位置投影回
    // 天球，求该投影相对彗星的大圆切向——不经过 ionTailTangentDir 的公式。
    // 实跑三日期点积均为 1.00000（公式即该投影的解析式，此处防回归）。
    for (const d of ['1986-02-21', '1986-03-13', '1986-04-02']) {
      const date = new Date(`${d}T00:00:00Z`);
      const eq = getMinorBodyEquatorial('halley', date);
      const earth = HelioVector(Body.Earth, date); // EQJ AU
      const ra = eq.raDeg * DEG;
      const dec = eq.decDeg * DEG;
      // EQJ 地心单位向量（x 春分点 / z 北天极）
      const u = {
        x: Math.cos(dec) * Math.cos(ra),
        y: Math.cos(dec) * Math.sin(ra),
        z: Math.sin(dec),
      };
      const c = {
        x: u.x * eq.distanceAu + earth.x,
        y: u.y * eq.distanceAu + earth.y,
        z: u.z * eq.distanceAu + earth.z,
      };
      const cn = Math.hypot(c.x, c.y, c.z);
      const dTail = 0.05; // 沿反日方向 0.05 AU
      const g = {
        x: c.x + (c.x / cn) * dTail - earth.x,
        y: c.y + (c.y / cn) * dTail - earth.y,
        z: c.z + (c.z / cn) * dTail - earth.z,
      };
      const gn = Math.hypot(g.x, g.y, g.z);
      // EQJ → 渲染系（y=北天极、z=−y_eqj）
      const gr = { x: g.x / gn, y: g.z / gn, z: -g.y / gn };
      const p = unitVectorFromRaDec(eq.raDeg, eq.decDeg);
      const cDot = p.x * gr.x + p.y * gr.y + p.z * gr.z;
      const t = { x: gr.x - p.x * cDot, y: gr.y - p.y * cDot, z: gr.z - p.z * cDot };
      const tn = Math.hypot(t.x, t.y, t.z);
      const sunEq = getEquatorial('sun', date);
      const ion = ionTailTangentDir(p, unitVectorFromRaDec(sunEq.raDeg, sunEq.decDeg));
      const dp = (ion.x * t.x + ion.y * t.y + ion.z * t.z) / tn;
      expect(dp).toBeGreaterThan(0.99);
    }
  });
});

describe('computeCometTailGeometry 历史锚点（实跑核实 2026-07-15）', () => {
  it('1986-03-13 哈雷（r≈0.9 AU）：θ_ion > 5°、可见、亮度饱和附近', () => {
    const g = computeCometTailGeometry('halley', new Date('1986-03-13T00:00:00Z'))!;
    // 本实现二体传播 r=0.8987（Horizons 摄动积分 0.8875，差 ~0.01 AU）
    expect(g.rAu).toBeGreaterThan(0.85);
    expect(g.rAu).toBeLessThan(0.95);
    expect(g.tailAngleRad * R2D).toBeGreaterThan(5); // 实跑 8.30°
    expect(g.tailAngleRad * R2D).toBeLessThan(20);
    expect(g.apparentMagnitude).toBeGreaterThan(4);
    expect(g.apparentMagnitude).toBeLessThan(6.5); // 实跑 5.03
    expect(g.brightness).toBeGreaterThan(0.5);
    expect(g.visible).toBe(true);
    // 尘埃尾骨架：8 点、单位向量、末端视角在合理区间（实跑 10.5°）
    expect(g.dustSkeleton.length).toBe(8);
    for (const pt of g.dustSkeleton) expect(vecNorm(pt)).toBeCloseTo(1, 6);
    expect(g.dustExtentRad * R2D).toBeGreaterThan(3);
    expect(g.dustExtentRad * R2D).toBeLessThan(25);
    // 离子尾方向与反日方向同侧：dot(T_ion, Ŝ) < 0（背离太阳）
    const { ionDir: t, sunDir: s } = g;
    expect(t.x * s.x + t.y * s.y + t.z * s.z).toBeLessThan(0);
  });

  it('2026-07-15 哈雷（r≈35 AU）：θ≈0 自动无尾、不可见、骨架跳过', () => {
    const g = computeCometTailGeometry('halley', new Date('2026-07-15T00:00:00Z'))!;
    expect(g.rAu).toBeGreaterThan(34.5);
    expect(g.rAu).toBeLessThan(35.7); // 实跑 35.19
    expect(g.tailAngleRad).toBeLessThan(0.001 * DEG); // 实跑 5.4e-6°
    expect(g.visible).toBe(false);
    expect(g.brightness).toBeLessThan(1e-6); // 实跑 m≈25.7
    expect(g.dustSkeleton.length).toBe(0); // 暗于阈值时跳过回溯
  });

  it('2P/Encke 近日点 2023-10-22：r≈q=0.338、有尾可见（实跑 θ=7.4°）', () => {
    const g = computeCometTailGeometry('encke', new Date('2023-10-22T00:00:00Z'))!;
    expect(g.rAu).toBeGreaterThan(0.33);
    expect(g.rAu).toBeLessThan(0.36);
    expect(g.tailAngleRad * R2D).toBeGreaterThan(3);
    expect(g.visible).toBe(true);
  });

  it('12P/Pons-Brooks 近日点 2024-04-21：r≈q=0.781、有尾可见（实跑 θ=13.3°）', () => {
    const g = computeCometTailGeometry('ponsbrooks', new Date('2024-04-21T00:00:00Z'))!;
    expect(g.rAu).toBeGreaterThan(0.77);
    expect(g.rAu).toBeLessThan(0.81);
    expect(g.tailAngleRad * R2D).toBeGreaterThan(5);
    expect(g.visible).toBe(true);
  });

  it('小行星与缺光度参数的天体返回 null', () => {
    expect(computeCometTailGeometry('ceres', new Date('2026-07-15T00:00:00Z'))).toBeNull();
    expect(computeCometTailGeometry('vesta', new Date('2026-07-15T00:00:00Z'))).toBeNull();
  });
});

describe('尘埃尾 synchrone 骨架', () => {
  const DATE = new Date('1986-03-13T00:00:00Z');

  it('骨架点视角距沿 τ 递增（新尘埃在头、老尘埃在尾）', () => {
    const eq = getMinorBodyEquatorial('halley', DATE);
    const cometDir = unitVectorFromRaDec(eq.raDeg, eq.decDeg);
    const pts = computeDustSkeleton('halley', DATE, { tauMaxDays: 15 });
    expect(pts.length).toBe(8);
    let prev = 0;
    for (const pt of pts) {
      const a = angleBetween(cometDir, pt);
      expect(a).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(Number.isFinite(a)).toBe(true);
      prev = a;
    }
    expect(prev).toBeGreaterThan(VISIBLE_ANGLE_MIN_RAD);
  });

  it('β=0（无辐射压）时骨架点 = 回溯彗核 3D 位置从当前地球的投影（独立重建对照）', () => {
    // 注意不能拿「τ 天前的彗星视位置」直接对照：那是从 τ 天前的地球看的，
    // 地球 2 天移动 ~0.034 AU，在 Δ≈0.95 AU 处视差可达 1°+（实跑 1.26°）。
    // 独立重建：过去地心方向×Δ + 过去地球日心位置 = 彗核日心 3D，再减去
    // 【当前】地球位置投影回天球——与 computeDustSkeleton 的路径逐步等价。
    const tau = 2;
    const pts = computeDustSkeleton('halley', DATE, {
      count: 2,
      tauMinDays: tau,
      tauMaxDays: 8,
      betaFrom: 0,
      betaTo: 0,
    });
    const pastDate = new Date(DATE.getTime() - tau * 86400000);
    const past = getMinorBodyEquatorial('halley', pastDate);
    const earthPast = HelioVector(Body.Earth, pastDate);
    const earthNow = HelioVector(Body.Earth, DATE);
    const ra = past.raDeg * DEG;
    const dec = past.decDeg * DEG;
    const g = {
      x: Math.cos(dec) * Math.cos(ra) * past.distanceAu + earthPast.x - earthNow.x,
      y: Math.cos(dec) * Math.sin(ra) * past.distanceAu + earthPast.y - earthNow.y,
      z: Math.sin(dec) * past.distanceAu + earthPast.z - earthNow.z,
    };
    const gn = Math.hypot(g.x, g.y, g.z);
    const expected = { x: g.x / gn, y: g.z / gn, z: -g.y / gn }; // EQJ → 渲染系
    expect(angleBetween(pts[0]!, expected) * R2D).toBeLessThan(1e-6);
  });
});
