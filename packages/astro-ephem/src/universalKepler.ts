/**
 * 通用变量开普勒求解（Phase 9C，近抛物线彗星支持，跨域契约 4）。
 *
 * 现役亮彗星多为近抛物线轨道（C/2023 A3 e≈1.0001），经典椭圆开普勒方程
 * （minorBodies.solveKepler）在 e→1 处病态、e>1 直接失效。本模块用
 * 【通用变量法（universal variables + Stumpff 函数）】从近日点参数化
 * （q, e, t−tp）统一求解椭圆/抛物线/双曲线，支持 e ∈ [0, 1.2]（业务钳制，
 * 见 minorBodies.registerMinorBody；数学上任意 e≥0 均成立）。
 *
 * 【公式推导】自近日点出发（r₀=q，径向速度 v_r0=0）时通用开普勒方程收缩为
 *   √μ·Δt = e·χ³·S(z) + q·χ，   z = α·χ²，α = (1−e)/q = 1/a
 * （由 Vallado 通式 √μΔt = χ³S + (r₀v_r0/√μ)χ²C + r₀χ(1−zS) 代入 v_r0=0、
 *  r₀=q、1−qα=e 化简）。dF/dχ = r（当前日心距）恒正 → F 严格单调，
 * 牛顿迭代 + 区间夹逼兜底全局收敛。位置由 f-g 函数给出近焦点系坐标：
 *   f = 1 − (χ²/q)·C(z)，g = Δt − (χ³/√μ)·S(z)，
 *   x = f·q（近日点方向 P̂），y = g·v_p（近日点切向 Q̂），v_p = √(μ(1+e)/q)。
 *
 * 【验证】对 JPL Horizons 实测锚点（C/2023 A3，三历元）角距 <0.02°
 * （见 nearParabolic.test.ts；测试容差按二体演示级放宽到 0.5°）。
 *
 * 纯函数、零依赖；供 minorBodies.ts（动态彗星路径）与单测共用。
 */

/** 高斯引力常数（rad/day）：μ = K_GAUSS²（AU³/day²，日心）。 */
const K_GAUSS = 0.01720209895;
const MU = K_GAUSS * K_GAUSS;
const SQRT_MU = K_GAUSS;

/**
 * Stumpff C(z) = (1−cos√z)/z（z>0 椭圆域）/ (cosh√−z−1)/(−z)（z<0 双曲域）。
 * |z| 很小（近抛物线）用泰勒级数防止 0/0 灾难性消去。
 */
export function stumpffC(z: number): number {
  if (z > 1e-6) {
    const s = Math.sqrt(z);
    return (1 - Math.cos(s)) / z;
  }
  if (z < -1e-6) {
    const s = Math.sqrt(-z);
    return (Math.cosh(s) - 1) / -z;
  }
  return 1 / 2 - z / 24 + (z * z) / 720; // |z|≤1e-6 时截断误差 <1e-22
}

/** Stumpff S(z) = (√z−sin√z)/√z³ / (sinh√−z−√−z)/√(−z)³；小 |z| 泰勒展开。 */
export function stumpffS(z: number): number {
  if (z > 1e-6) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (z * s);
  }
  if (z < -1e-6) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / (-z * s);
  }
  return 1 / 6 - z / 120 + (z * z) / 5040;
}

/**
 * 求解通用近点角 χ：F(χ) = e·χ³·S(αχ²) + q·χ − √μ·Δt = 0。
 * F 严格单调（F' = r > 0），先指数扩张夹逼区间，再牛顿迭代（出界回退二分）。
 * @param qAu 近日点距（AU，>0）
 * @param e   偏心率（≥0）
 * @param dtDays t − tp（天；椭圆轨道调用方应先按周期归约）
 */
export function solveUniversalAnomaly(qAu: number, e: number, dtDays: number): number {
  const alpha = (1 - e) / qAu;
  const target = SQRT_MU * dtDays;
  const F = (chi: number): number => {
    const z = alpha * chi * chi;
    return e * chi * chi * chi * stumpffS(z) + qAu * chi - target;
  };
  /** F'(χ) = r(χ) = χ²C(z) + q(1−zC(z))，恒 >0。 */
  const dF = (chi: number): number => {
    const z = alpha * chi * chi;
    const c = stumpffC(z);
    return chi * chi * c + qAu * (1 - z * c);
  };

  // 夹逼区间：初始猜测 √μΔt/q（抛物线极限的一阶项），指数扩张至变号
  let lo = 0;
  let hi = 0;
  if (dtDays >= 0) {
    hi = Math.abs(target) / qAu + 1;
    for (let k = 0; k < 200 && F(hi) < 0; k++) hi *= 2;
  } else {
    lo = -(Math.abs(target) / qAu + 1);
    for (let k = 0; k < 200 && F(lo) > 0; k++) lo *= 2;
  }

  let chi = (lo + hi) / 2;
  for (let i = 0; i < 128; i++) {
    const f = F(chi);
    if (f > 0) hi = chi;
    else lo = chi;
    const d = dF(chi);
    let next = d > 0 ? chi - f / d : (lo + hi) / 2; // 牛顿步
    if (!(next > lo && next < hi)) next = (lo + hi) / 2; // 出界 → 二分兜底
    if (Math.abs(next - chi) < 1e-13 * Math.max(1, Math.abs(chi))) return next;
    chi = next;
  }
  return chi; // 128 次夹逼后区间已极窄，直接返回
}

/** 通用变量求解输出：真近点角与日心距。 */
export interface UniversalSolution {
  /** 真近点角 ν（rad，(−π, π]；Δt<0 为负）。 */
  nuRad: number;
  /** 日心距 r（AU）。 */
  rAu: number;
}

/**
 * 从近日点参数化直接解真近点角与日心距（f-g 函数，全偏心率域）。
 * 椭圆（e<1）自动按周期归约 Δt 到 [−P/2, P/2]（数值良态 + χ 有界）。
 */
export function trueAnomalyRadiusUniversal(
  qAu: number,
  e: number,
  dtDays: number,
): UniversalSolution {
  let dt = dtDays;
  if (e < 1) {
    const a = qAu / (1 - e);
    const period = 2 * Math.PI * Math.sqrt((a * a * a) / MU);
    dt = dt % period;
    if (dt > period / 2) dt -= period;
    if (dt < -period / 2) dt += period;
  }
  const chi = solveUniversalAnomaly(qAu, e, dt);
  const alpha = (1 - e) / qAu;
  const z = alpha * chi * chi;
  const f = 1 - ((chi * chi) / qAu) * stumpffC(z);
  const g = dt - ((chi * chi * chi) / SQRT_MU) * stumpffS(z);
  const vp = Math.sqrt((MU * (1 + e)) / qAu); // 近日点速度（AU/day）
  const x = f * qAu; // 近焦点系：P̂ 指向近日点
  const y = g * vp; // Q̂ = 近日点切向（运动方向）
  return { nuRad: Math.atan2(y, x), rAu: Math.hypot(x, y) };
}
