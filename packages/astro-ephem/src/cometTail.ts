/**
 * 真彗尾几何（Phase 9B，调研 C §3a）：彗星总亮度 / 彗发直径 / 尾长经验公式 +
 * 离子尾切平面方向 + 尘埃尾 synchrone 骨架。纯函数，web CometTailLayer 与单测共用。
 *
 * 【精度声明（演示级）】
 * - 亮度：彗星总星等标准式 m = M_abs + 5·log10(Δ) + K·log10(r)（K = 2.5n）。
 * - 彗发直径 / 尾长：Guide/projectpluto 经验公式（Stellarium 亦采用；公式为
 *   数学事实不受 GPL 约束，此处按调研报告转录并注明出处，绝非复制代码）：
 *     mhelio = M_abs + K·log10(r)
 *     彗发 D = 10^((−0.0033·mh − 0.07)·mh + 3.25) · (1−10^(−2r))(1−10^(−r))  千公里
 *     尾长 L = 10^((−0.0075·mh − 0.19)·mh + 2.1) · (1−10^(−4r))(1−10^(−2r))  百万公里
 *   出处：projectpluto.com/update7b.htm（Guide 软件彗尾公式）。
 * - 尘埃尾：Finson–Probstein 零级简化——粒子在 t−τ 释放后「冻结在释放点 +
 *   太阳径向漂移 ½·β·(GM_sun/r²)·τ²」，忽略粒子自身轨道运动的持续演化。
 * - 所有输出仅用于渲染示意，绝不用于任何观测精度承诺。
 *
 * 【坐标约定】输出的天球方向向量一律采用与 astro-core raDecToVector3 相同的
 * 渲染系约定：x = cosδ·cosα，y = sinδ（+y 北天极），z = −cosδ·sinα。
 * 内部日心几何用 astronomy-engine 的 EQJ（x 春分点、z 北天极），出口处转换。
 */
import { Body, HelioVector } from 'astronomy-engine';
import { getEquatorial } from './ephemeris';
import { getMinorBodyEquatorial } from './minorBodies';
import { getMinorBodyMeta, type MinorBodyId } from './minorBodiesMeta';

const DEG2RAD = Math.PI / 180;
/** 1 AU（km，IAU 2012 定义值）。 */
const AU_KM = 1.495978707e8;
/** 太阳引力参数 GM☉（km³/s²，IAU 标称值）。 */
const GM_SUN_KM3_S2 = 1.32712440018e11;
const DAY_S = 86400;
const DAY_MS = 86400000;

/** 纯数据三维向量（不引 three，保持本包零渲染依赖）。 */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/* ---------------------------------------------------------------- 向量小工具 */

function norm(v: Vec3Like): number {
  return Math.hypot(v.x, v.y, v.z);
}

function normalize(v: Vec3Like): Vec3Like {
  const n = norm(v);
  // 退化向量（模长 ~0）返回零向量，调用方各自兜底
  if (n < 1e-12) return { x: 0, y: 0, z: 0 };
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}

function dot(a: Vec3Like, b: Vec3Like): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** 两单位向量夹角（rad），数值裁剪防 acos 越界。 */
export function angleBetween(a: Vec3Like, b: Vec3Like): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
}

/** EQJ（x 春分点 / y 赤经 90° / z 北天极）→ 渲染系（y 北天极、RA 从 +x 向 −z 增）。 */
function eqjToRender(v: Vec3Like): Vec3Like {
  return { x: v.x, y: v.z, z: -v.y };
}

/** RA/Dec（度）→ 渲染系单位向量（与 astro-core raDecToVector3 同约定，半径 1）。 */
export function unitVectorFromRaDec(raDeg: number, decDeg: number): Vec3Like {
  const ra = raDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const cosDec = Math.cos(dec);
  return { x: cosDec * Math.cos(ra), y: Math.sin(dec), z: -cosDec * Math.sin(ra) };
}

/** RA/Dec（度）→ EQJ 单位向量（内部日心几何用）。 */
function eqjUnitFromRaDec(raDeg: number, decDeg: number): Vec3Like {
  const ra = raDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const cosDec = Math.cos(dec);
  return { x: cosDec * Math.cos(ra), y: cosDec * Math.sin(ra), z: Math.sin(dec) };
}

/* ---------------------------------------------------------------- 光度参数 */

/** 彗星光度参数：m = absMag + 5·log10(Δ) + slopeK·log10(r)，slopeK = 2.5n。 */
export interface CometPhotometry {
  /** 绝对总星等 M_abs（r = Δ = 1 AU 时）。 */
  absMag: number;
  /** 日心距斜率 K = 2.5n（星等 / dex）。 */
  slopeK: number;
  /** 来源说明。 */
  sourceNote: string;
}

/**
 * 三颗内置彗星的光度参数。
 * 来源：MPC CometEls.txt（2026-07-15 抓取，g/k 总星等参数，K = 2.5k）：
 *   1P/Halley       g=5.5  k=3.2 → K=8.0 （与 JPL SBDB M1=5.5/K1=8.0 一致）
 *   2P/Encke        g=11.5 k=6.0 → K=15.0（SBDB M1=15.6/K1=4.5 为跨全弧拟合，
 *                                   近日点段亮度严重偏暗，采用 MPC 近期拟合值）
 *   12P/Pons-Brooks g=5.0  k=6.0 → K=15.0（与 SBDB M1=5.0/K1=15.0 一致）
 */
export const COMET_PHOTOMETRY: Partial<Record<MinorBodyId, CometPhotometry>> = {
  halley: { absMag: 5.5, slopeK: 8.0, sourceNote: 'MPC CometEls.txt g=5.5 k=3.2（2026-07-15）' },
  encke: { absMag: 11.5, slopeK: 15.0, sourceNote: 'MPC CometEls.txt g=11.5 k=6.0（2026-07-15）' },
  ponsbrooks: { absMag: 5.0, slopeK: 15.0, sourceNote: 'MPC CometEls.txt g=5.0 k=6.0（2026-07-15）' },
};

/** 彗星总视星等 m = M_abs + 5·log10(Δ) + K·log10(r)（标准彗星总星等式）。 */
export function cometApparentMagnitude(
  photometry: CometPhotometry,
  rAu: number,
  deltaAu: number,
): number {
  return photometry.absMag + 5 * Math.log10(deltaAu) + photometry.slopeK * Math.log10(rAu);
}

/** 日心星等 mhelio = M_abs + K·log10(r)（彗发/尾长经验公式的输入）。 */
export function cometHelioMagnitude(photometry: CometPhotometry, rAu: number): number {
  return photometry.absMag + photometry.slopeK * Math.log10(rAu);
}

/** 彗发直径（km）：Guide/projectpluto 经验公式（见文件头注释，演示级）。 */
export function cometComaDiameterKm(photometry: CometPhotometry, rAu: number): number {
  const mh = cometHelioMagnitude(photometry, rAu);
  const d0 = Math.pow(10, (-0.0033 * mh - 0.07) * mh + 3.25); // 千公里
  return d0 * (1 - Math.pow(10, -2 * rAu)) * (1 - Math.pow(10, -rAu)) * 1000;
}

/** 尾长（km）：Guide/projectpluto 经验公式（见文件头注释，演示级）。 */
export function cometTailLengthKm(photometry: CometPhotometry, rAu: number): number {
  const mh = cometHelioMagnitude(photometry, rAu);
  const l0 = Math.pow(10, (-0.0075 * mh - 0.19) * mh + 2.1); // 百万公里
  return l0 * (1 - Math.pow(10, -4 * rAu)) * (1 - Math.pow(10, -2 * rAu)) * 1e6;
}

/** 尾的视角长 θ = atan(L / (Δ·AU_KM))（rad）。 */
export function tailApparentAngleRad(tailLengthKm: number, deltaAu: number): number {
  return Math.atan(tailLengthKm / (deltaAu * AU_KM));
}

/* ---------------------------------------------------------------- 方向几何 */

/**
 * 离子尾在彗星 P 点切平面内的方向：T_ion = normalize(P̂·(P̂·Ŝ) − Ŝ)。
 * 即「反日方向 −Ŝ 在天球 P 点切平面上的投影」——离子尾始终笔直背向太阳。
 * P̂、Ŝ 为同一坐标系下的单位向量（渲染系或 EQJ 均可，输出同系）。
 * 退化情形（彗星与太阳/反日点视方向重合，切向无定义）返回零向量。
 */
export function ionTailTangentDir(pHat: Vec3Like, sHat: Vec3Like): Vec3Like {
  const c = dot(pHat, sHat);
  return normalize({
    x: pHat.x * c - sHat.x,
    y: pHat.y * c - sHat.y,
    z: pHat.z * c - sHat.z,
  });
}

/* ---------------------------------------------------------------- 综合几何 */

/** 尘埃尾 synchrone 骨架参数（默认值即调研报告值）。 */
export interface DustSkeletonOptions {
  /** 骨架点数 K。 */
  count?: number;
  /** 回溯时长 τ 范围（天，对数分布）。 */
  tauMinDays?: number;
  tauMaxDays?: number;
  /** 辐射压比 β 范围（β = 辐射压/引力，演示级取 0.3–0.6 线性过渡）。 */
  betaFrom?: number;
  betaTo?: number;
}

/** computeCometTailGeometry 的输出：一次快照，全部为纯数据。 */
export interface CometTailGeometry {
  id: MinorBodyId;
  /** 日心距离（AU）。 */
  rAu: number;
  /** 地心距离（AU）。 */
  deltaAu: number;
  /** 总视星等（演示级）。 */
  apparentMagnitude: number;
  /** 彗发直径（km，经验公式）。 */
  comaDiameterKm: number;
  /** 尾长（km，经验公式原始值，未乘展示增益）。 */
  tailLengthKm: number;
  /**
   * 离子尾渲染视角长（rad）：atan(L·增益/Δ) 后再钳到 [0, MAX_TAIL_ANGLE]。
   * 增益见 ION_PRESENTATION_GAIN 注释（演示级）。
   */
  tailAngleRad: number;
  /** 彗星天球方向（渲染系单位向量）。 */
  cometDir: Vec3Like;
  /** 太阳天球方向（渲染系单位向量）。 */
  sunDir: Vec3Like;
  /** 离子尾切向（渲染系单位向量；退化时为零向量且 visible=false）。 */
  ionDir: Vec3Like;
  /** 尘埃尾 synchrone 骨架（渲染系单位向量 ×K，沿尾从近到远）。 */
  dustSkeleton: Vec3Like[];
  /** 尘埃尾骨架末端相对彗星的视角距（rad）。 */
  dustExtentRad: number;
  /** 渲染强度 0–1（由总星等映射，见 brightnessFromMagnitude）。 */
  brightness: number;
  /** 是否值得画：亮度与（离子尾或尘埃尾）视角长同时超阈值。 */
  visible: boolean;
}

/**
 * 离子尾展示增益（演示级）：Guide/projectpluto 尾长公式对大彗星显著偏保守
 * （1986 年哈雷公式值 ≈0.9e7 km、视角 ≈3°，而目视记录达 10°+；Hale-Bopp
 * 同样低估 2–5 倍）。渲染取 L×2.5 对齐目视观感；tailLengthKm 保留公式原值。
 */
export const ION_PRESENTATION_GAIN = 2.5;
/** 渲染视角长上限（rad）：防近距离掠日情形整条尾绕过半个天球。 */
export const MAX_TAIL_ANGLE_RAD = 35 * DEG2RAD;
/** 可见性阈值：视角长 ≥ 0.3° 且亮度 ≥ 0.02 才画。 */
export const VISIBLE_ANGLE_MIN_RAD = 0.3 * DEG2RAD;
export const VISIBLE_BRIGHTNESS_MIN = 0.02;

/** 总星等 → 渲染强度 0–1：m=5 记满亮，每暗 1 等衰减 10^0.4（放大镜式软钳）。 */
export function brightnessFromMagnitude(m: number): number {
  return Math.max(0, Math.min(1, Math.pow(10, -0.4 * (m - 5))));
}

/**
 * 尘埃尾骨架目标视角长：与离子尾同量级略短（真实彗星尘尾通常短于离子尾），
 * 下限 0.5°、上限 25°。固定 τ_max=60 天在近日点段会回溯到彗星飞掠的大段
 * 天球弧（实跑：1986 哈雷 67°、2023 恩克 136°，绕天半圈显然不能直接画），
 * 故 computeCometTailGeometry 里按此目标自适应缩短 τ_max（演示级取舍）。
 */
export function dustTargetExtentRad(tailAngleRad: number): number {
  return Math.max(0.5 * DEG2RAD, Math.min(25 * DEG2RAD, tailAngleRad * 0.8));
}

const DEFAULT_SKELETON: Required<DustSkeletonOptions> = {
  count: 8,
  tauMinDays: 2,
  tauMaxDays: 60,
  betaFrom: 0.6,
  betaTo: 0.3,
};

/** 某时刻某彗星的日心 EQJ 位置（AU）：地心视方向 × Δ + 地球日心位置。 */
function cometHelioEqj(id: MinorBodyId, date: Date): Vec3Like {
  const eq = getMinorBodyEquatorial(id, date);
  const u = eqjUnitFromRaDec(eq.raDeg, eq.decDeg);
  const earth = HelioVector(Body.Earth, date); // EQJ，AU
  return {
    x: u.x * eq.distanceAu + earth.x,
    y: u.y * eq.distanceAu + earth.y,
    z: u.z * eq.distanceAu + earth.z,
  };
}

/**
 * 尘埃尾 synchrone 骨架（渲染系单位向量 ×K）。
 * 每个骨架点 = 「τ_k 天前彗核释放的尘埃现在看起来在哪」：
 *   1. 回溯彗核日心位置 C_k（getMinorBodyEquatorial 开普勒回溯 + 地球位置还原）；
 *   2. 叠加太阳径向漂移 ½·β_k·(GM☉/r_k²)·τ_k²（Finson–Probstein 零级近似，
 *      冻结释放点、忽略粒子横向轨道演化——演示级）；
 *   3. 从当前地球位置投影回天球。
 * τ_k 对数分布（新尘埃密、老尘埃疏），β_k 从 betaFrom 线性过渡到 betaTo。
 */
export function computeDustSkeleton(
  id: MinorBodyId,
  date: Date,
  options?: DustSkeletonOptions,
): Vec3Like[] {
  const opt = { ...DEFAULT_SKELETON, ...options };
  const earthNow = HelioVector(Body.Earth, date); // EQJ，AU
  const points: Vec3Like[] = [];
  const lnMin = Math.log(opt.tauMinDays);
  const lnMax = Math.log(opt.tauMaxDays);
  for (let k = 0; k < opt.count; k++) {
    const f = opt.count === 1 ? 0 : k / (opt.count - 1);
    const tauDays = Math.exp(lnMin + (lnMax - lnMin) * f);
    const beta = opt.betaFrom + (opt.betaTo - opt.betaFrom) * f;
    const past = new Date(date.getTime() - tauDays * DAY_MS);
    // 1. 释放时刻的彗核日心位置
    const c = cometHelioEqj(id, past);
    const rKm = norm(c) * AU_KM;
    // 2. 太阳径向漂移（km → AU）：½·β·(GM☉/r²)·τ²
    const driftAu =
      (0.5 * beta * (GM_SUN_KM3_S2 / (rKm * rKm)) * (tauDays * DAY_S) ** 2) / AU_KM;
    const cHat = normalize(c);
    const gx = c.x + cHat.x * driftAu - earthNow.x;
    const gy = c.y + cHat.y * driftAu - earthNow.y;
    const gz = c.z + cHat.z * driftAu - earthNow.z;
    // 3. 当前地心视方向 → 渲染系
    points.push(eqjToRender(normalize({ x: gx, y: gy, z: gz })));
  }
  return points;
}

/**
 * 一站式彗尾几何快照：亮度 + 彗发/尾长 + 离子尾切向 + 尘埃尾骨架 + 可见性。
 * 非彗星或无光度参数返回 null。太阳方向内部自取（getEquatorial('sun')），
 * 与 web ephemRegistry 同源（astronomy-engine），无跨注册表时序依赖。
 * 调用成本：≈(2 + 2K) 次开普勒/VSOP 计算，调用方应按 observeTime 量化节流。
 */
export function computeCometTailGeometry(
  id: MinorBodyId,
  date: Date,
  options?: DustSkeletonOptions,
): CometTailGeometry | null {
  if (getMinorBodyMeta(id).kind !== 'comet') return null;
  const photometry = COMET_PHOTOMETRY[id];
  if (!photometry) return null;

  const eq = getMinorBodyEquatorial(id, date);
  const r = eq.helioDistanceAu;
  const delta = eq.distanceAu;

  const apparentMagnitude = cometApparentMagnitude(photometry, r, delta);
  const comaDiameterKm = cometComaDiameterKm(photometry, r);
  const tailLengthKm = cometTailLengthKm(photometry, r);
  const tailAngleRad = Math.min(
    tailApparentAngleRad(tailLengthKm * ION_PRESENTATION_GAIN, delta),
    MAX_TAIL_ANGLE_RAD,
  );

  const cometDir = unitVectorFromRaDec(eq.raDeg, eq.decDeg);
  const sunEq = getEquatorial('sun', date);
  const sunDir = unitVectorFromRaDec(sunEq.raDeg, sunEq.decDeg);
  const ionDir = ionTailTangentDir(cometDir, sunDir);

  const brightness = brightnessFromMagnitude(apparentMagnitude);

  // 亮度低于阈值时跳过骨架回溯（8×2 次星历计算），远日点常态零成本。
  // τ_max 自适应：先按报告默认 2–60 天算一遍，若骨架末端视角远超目标
  //（近日点段彗星自身掠过的天球弧太长），按 extent∝τ^(1..2) 的经验幂
  // 收缩 τ_max 重算，至多两轮（成本上限 3×16 次星历，仍在 1h 量化预算内）。
  const wantSkeleton = brightness >= VISIBLE_BRIGHTNESS_MIN;
  let dustSkeleton: Vec3Like[] = [];
  let dustExtentRad = 0;
  if (wantSkeleton) {
    const target = dustTargetExtentRad(tailAngleRad);
    let opt: DustSkeletonOptions = { ...DEFAULT_SKELETON, ...options };
    for (let pass = 0; pass < 3; pass++) {
      dustSkeleton = computeDustSkeleton(id, date, opt);
      const last = dustSkeleton[dustSkeleton.length - 1];
      dustExtentRad = last ? angleBetween(cometDir, last) : 0;
      if (dustExtentRad <= target * 1.3 || pass === 2) break;
      const tauMax = opt.tauMaxDays ?? DEFAULT_SKELETON.tauMaxDays;
      const tauMin = opt.tauMinDays ?? DEFAULT_SKELETON.tauMinDays;
      const shrunk = Math.max(tauMin * 2, tauMax * Math.pow(target / dustExtentRad, 0.6));
      if (shrunk >= tauMax * 0.98) break; // 已无可缩（τ_min 托底）
      opt = { ...opt, tauMaxDays: shrunk };
    }
  }

  const ionValid = norm(ionDir) > 0.5; // 退化（正对/背对太阳）时零向量
  const visible =
    brightness >= VISIBLE_BRIGHTNESS_MIN &&
    ionValid &&
    Math.max(tailAngleRad, dustExtentRad) >= VISIBLE_ANGLE_MIN_RAD;

  return {
    id,
    rAu: r,
    deltaAu: delta,
    apparentMagnitude,
    comaDiameterKm,
    tailLengthKm,
    tailAngleRad,
    cometDir,
    sunDir,
    ionDir,
    dustSkeleton,
    dustExtentRad,
    brightness,
    visible,
  };
}
