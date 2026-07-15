/**
 * 小天体（谷神星/灶神星/智神星/哈雷彗星）星历：
 * JPL 轨道根数 + 手写开普勒方程求解 → 日心黄道 → 地心 J2000 赤道 RA/Dec。
 *
 * 【精度声明（演示级）】二体开普勒轨道 + 固定历元根数：
 * 忽略行星摄动与光行时（主带小行星光行时 ~15 分钟内自行 <0.01°，可忽略）。
 * 主带小行星在根数历元 ±数年内误差 ≲0.5°；哈雷彗星根数历元为 1968 年
 * （上一次回归前），但其当前位于远日点附近、运动极慢，误差同样约 ±0.5° 量级。
 * 产品统一标注「演示级 · ±0.5°」，绝不用于任何观测精度承诺。
 *
 * 【参考系约定】与全站一致：地心 J2000（EQJ）。
 * 地球日心坐标用 astronomy-engine 的 HelioVector(Body.Earth)——其返回值
 * 本就是 EQJ 赤道 J2000 坐标（AU），与本模块「黄道→赤道」旋转后的小天体
 * 日心坐标同参考系，直接相减即得地心矢量。
 */
import { Body, HelioVector } from 'astronomy-engine';
import { minorUidToId, type BuiltinMinorBodyId, type MinorBodyId } from './minorBodiesMeta';
import { trueAnomalyRadiusUniversal } from './universalKepler';

export * from './minorBodiesMeta';
export * from './universalKepler';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
/** 高斯引力常数（rad/day）：日心轨道平均角速度 n = K_GAUSS / a^1.5。 */
const K_GAUSS = 0.01720209895;
/** 黄赤交角 ε（J2000，度）。 */
const OBLIQUITY_DEG = 23.4392911;
/** Unix epoch ms → 儒略日。 */
const msToJd = (ms: number): number => ms / 86400000 + 2440587.5;

/** J2000 日心黄道开普勒轨道根数（角度制）。 */
export interface MinorBodyElements {
  /** 半长轴（AU）。 */
  aAu: number;
  /** 偏心率。 */
  e: number;
  /** 轨道倾角（度；>90 为逆行，如哈雷）。 */
  iDeg: number;
  /** 升交点黄经 Ω（度）。 */
  omegaDeg: number;
  /** 近日点幅角 ω（度）。 */
  wDeg: number;
  /** 历元平近点角 M0（度）。 */
  m0Deg: number;
  /** 根数历元（儒略日 TDB）。 */
  epochJd: number;
  /** 来源说明（含抓取命令与日期）。 */
  sourceNote: string;
}

/**
 * 轨道根数常量 —— 来源：JPL Small-Body Database（sbdb.api，full-prec）。
 * 抓取（2026-07-11）：
 *   curl 'https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=1&full-prec=true'   // Ceres
 *   同法 sstr=2（Pallas）、sstr=4（Vesta）、sstr=1P（Halley）
 * 数值为返回 orbit.elements 的 a/e/i/om/w/ma 与 orbit.epoch 原样粘贴，绝非手编。
 * 注意：Ceres/Pallas/Vesta 历元 JD 2461200.5（2026-06），哈雷历元 JD 2439875.5
 * （1968-01，上次回归前的标准根数集）。
 */
const ELEMENTS: Record<BuiltinMinorBodyId, MinorBodyElements> = {
  ceres: {
    aAu: 2.765552595034094,
    e: 0.07969229514816586,
    iDeg: 10.58802780183462,
    omegaDeg: 80.24862682043221,
    wDeg: 73.29421453021587,
    m0Deg: 274.4193463761342,
    epochJd: 2461200.5,
    sourceNote: 'JPL SBDB sstr=1（1 Ceres），epoch JD 2461200.5，抓取 2026-07-11',
  },
  pallas: {
    aAu: 2.769559010737709,
    e: 0.2307000995648547,
    iDeg: 34.93279321851542,
    omegaDeg: 172.8866193357694,
    wDeg: 310.9699161652136,
    m0Deg: 254.2496521742734,
    epochJd: 2461200.5,
    sourceNote: 'JPL SBDB sstr=2（2 Pallas），epoch JD 2461200.5，抓取 2026-07-11',
  },
  vesta: {
    aAu: 2.361365965127599,
    e: 0.09020374382834395,
    iDeg: 7.143925545058711,
    omegaDeg: 103.701293265032,
    wDeg: 151.4686478221564,
    m0Deg: 81.19015607686903,
    epochJd: 2461200.5,
    sourceNote: 'JPL SBDB sstr=4（4 Vesta），epoch JD 2461200.5，抓取 2026-07-11',
  },
  halley: {
    aAu: 17.92863504856923,
    e: 0.9679359956953211,
    iDeg: 162.1905300439129,
    omegaDeg: 59.09894720612437,
    wDeg: 112.2414314637764,
    m0Deg: 274.3823371366792,
    epochJd: 2439875.5,
    sourceNote: 'JPL SBDB sstr=1P（1P/Halley），epoch JD 2439875.5（1968），抓取 2026-07-11',
  },
  // Phase 9B 真彗尾新增两颗「有尾可看」的周期彗星（哈雷 2061 年前常态无尾）：
  // 恩克（周期 3.3 年，回归频繁）与 12P（2024-04 刚回归过，时间机器可拨回看）。
  encke: {
    aAu: 2.219688710074586,
    e: 0.8477496967533629,
    iDeg: 11.41227811179314,
    omegaDeg: 334.1935846036774,
    wDeg: 187.1342463695676,
    m0Deg: 243.1260693210057,
    epochJd: 2459847.5,
    // 注意：恩克有明显非引力加速度（Horizons A1/A2 非零），二体外推跨年
    // 误差比主带天体大，仍在产品「演示级 ±0.5°~1°」声明范围内。
    sourceNote: 'JPL SBDB sstr=2P（2P/Encke），epoch JD 2459847.5（2022-09），抓取 2026-07-15',
  },
  ponsbrooks: {
    aAu: 17.18491452314557,
    e: 0.9545612442767357,
    iDeg: 74.19091017013747,
    omegaDeg: 255.8553510995133,
    wDeg: 198.9879994677832,
    m0Deg: 357.0928096635318,
    epochJd: 2460211.5,
    sourceNote:
      'JPL SBDB sstr=12P（12P/Pons-Brooks），epoch JD 2460211.5（2023-09），抓取 2026-07-15',
  },
};

// ── 动态小天体轨道（Phase 9C：/api/v1/minor-bodies 动态彗星，近抛物线支持）──

/**
 * 动态注册轨道根数（q/tp 参数化优先，兼容 a/M0）。
 * 与内置 MinorBodyElements 的差异：近抛物线（e≈1）没有有意义的 a/M0，
 * 用近日点距 q + 过近日点时刻 tp 参数化。
 */
export interface RegisterableElements {
  /** 偏心率，业务钳制 e ∈ [0, 1.2]（超出拒绝——二体演示级不处理强双曲）。 */
  e: number;
  /** 近日点距（AU）。缺省时由 aAu·(1−e) 推导（要求 e<1）。 */
  qAu?: number;
  /** 半长轴（AU，仅椭圆有意义）。 */
  aAu?: number;
  iDeg: number;
  omDeg: number;
  wDeg: number;
  /** 过近日点时刻（儒略日 TDB）。近抛物线（e≥0.98）必需。 */
  tpJd?: number;
  /** 历元平近点角（度，仅椭圆路径可用，与 epochJd 配对）。 */
  maDeg?: number;
  /** 根数历元（儒略日）。 */
  epochJd: number;
  /** 来源说明（信息卡展示）。 */
  sourceNote: string;
}

/** 归一化后的动态轨道（内部表示）。 */
interface DynamicOrbit {
  qAu: number;
  e: number;
  iDeg: number;
  omDeg: number;
  wDeg: number;
  /** 椭圆路径参数（e<0.98 且可推导时存在）：沿用既有 solveKepler 旧路径。 */
  elliptic?: { aAu: number; m0Deg: number; epochJd: number };
  /** 通用变量路径参数（近抛物线必有）。 */
  tpJd?: number;
  epochJd: number;
  sourceNote: string;
}

const DYNAMIC_ORBITS = new Map<string, DynamicOrbit>();

/** 近抛物线阈值：e ≥ 0.98 走通用变量法；其下走既有椭圆路径（零回归契约）。 */
export const NEAR_PARABOLIC_E = 0.98;
/** 偏心率业务上限（跨域契约 4：e ∈ [0, 1.2]）。 */
export const MAX_ECCENTRICITY = 1.2;

/**
 * 注册动态小天体的轨道根数（9C）。幂等：同 id 重复注册忽略。
 * 校验失败抛错（调用方逐体 try/catch，坏根数跳过不注册——绝不带病渲染）。
 */
export function registerMinorBodyOrbit(id: MinorBodyId, el: RegisterableElements): void {
  if (DYNAMIC_ORBITS.has(id) || id in ELEMENTS) return; // 幂等/不覆盖内置
  if (!(el.e >= 0 && el.e <= MAX_ECCENTRICITY)) {
    throw new Error(`e=${el.e} 超出 [0, ${MAX_ECCENTRICITY}]：${id}`);
  }
  // q 推导：q 缺省时需要 a 且 e<1
  const qAu = el.qAu ?? (el.aAu !== undefined && el.e < 1 ? el.aAu * (1 - el.e) : undefined);
  if (qAu === undefined || !(qAu > 0) || !Number.isFinite(qAu)) {
    throw new Error(`无法确定近日点距 q：${id}`);
  }
  for (const [k, v] of Object.entries({ i: el.iDeg, om: el.omDeg, w: el.wDeg, epoch: el.epochJd })) {
    if (!Number.isFinite(v)) throw new Error(`根数 ${k} 非法：${id}`);
  }
  const nearParabolic = el.e >= NEAR_PARABOLIC_E;
  if (nearParabolic && el.tpJd === undefined) {
    throw new Error(`近抛物线轨道缺 tp：${id}`);
  }
  // 椭圆路径参数（e<0.98）：优先 a+M0；仅有 tp 时由 M0 = n·(epoch−tp) 推导
  let elliptic: DynamicOrbit['elliptic'];
  if (!nearParabolic) {
    const aAu = el.aAu ?? qAu / (1 - el.e);
    let m0Deg = el.maDeg;
    if (m0Deg === undefined && el.tpJd !== undefined) {
      const n = K_GAUSS / Math.pow(aAu, 1.5); // rad/day
      m0Deg = (((n * (el.epochJd - el.tpJd)) * RAD2DEG) % 360 + 360) % 360;
    }
    if (m0Deg === undefined) throw new Error(`椭圆轨道缺 M0/tp：${id}`);
    elliptic = { aAu, m0Deg, epochJd: el.epochJd };
  }
  DYNAMIC_ORBITS.set(id, {
    qAu,
    e: el.e,
    iDeg: el.iDeg,
    omDeg: el.omDeg,
    wDeg: el.wDeg,
    elliptic,
    tpJd: el.tpJd,
    epochJd: el.epochJd,
    sourceNote: el.sourceNote,
  });
}

/** 某 id 是否已有可计算轨道（内置或动态）。 */
export function hasMinorBodyOrbit(id: MinorBodyId): boolean {
  return id in ELEMENTS || DYNAMIC_ORBITS.has(id);
}

/**
 * 取某小天体的轨道根数（含来源说明，信息卡展示用）。
 * 动态体合成同构形状：近抛物线的 aAu = q/(1−e)（e>1 时为负，双曲线半长轴的
 * 标准约定）、m0Deg 对近抛物线无意义记 0。未注册 id 抛错。
 */
export function getMinorBodyElements(id: MinorBodyId): MinorBodyElements {
  const builtin = (ELEMENTS as Record<string, MinorBodyElements>)[id];
  if (builtin) return builtin;
  const dyn = DYNAMIC_ORBITS.get(id);
  if (!dyn) throw new Error(`未知小天体: ${id}`);
  return {
    aAu: dyn.elliptic?.aAu ?? (dyn.e === 1 ? Infinity : dyn.qAu / (1 - dyn.e)),
    e: dyn.e,
    iDeg: dyn.iDeg,
    omegaDeg: dyn.omDeg,
    wDeg: dyn.wDeg,
    m0Deg: dyn.elliptic?.m0Deg ?? 0,
    epochJd: dyn.epochJd,
    sourceNote: dyn.sourceNote,
  };
}

/** 归一化角到 [0, 2π)。 */
function normalizeRad(x: number): number {
  const r = x % (Math.PI * 2);
  return r < 0 ? r + Math.PI * 2 : r;
}

/** 赤经归一到 [0, 360)。 */
function normalizeRaDeg(raDeg: number): number {
  const r = raDeg % 360;
  return r < 0 ? r + 360 : r;
}

/** 二分法兜底：f(E) = E − e·sinE − M 在 [0, 2π] 上单调递增（0 ≤ e < 1）。 */
function bisectKepler(M: number, e: number): number {
  let lo = 0;
  let hi = Math.PI * 2;
  for (let k = 0; k < 128; k++) {
    const mid = (lo + hi) / 2;
    if (mid - e * Math.sin(mid) - M < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * 开普勒方程 E − e·sinE = M 的牛顿迭代求解（M 需先归一到 [0, 2π)）。
 * 高偏心率（哈雷 e≈0.968）用 π 起步防近日点附近发散；60 次未收敛走二分兜底。
 */
export function solveKepler(M: number, e: number): number {
  const m = normalizeRad(M);
  let E = e < 0.8 ? m : Math.PI;
  for (let k = 0; k < 60; k++) {
    const d = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-9) return E;
  }
  return bisectKepler(m, e);
}

/** 某时刻小天体的地心 J2000 赤道坐标与距离。 */
export interface MinorBodyEquatorial {
  /** 赤经（度，[0, 360)，J2000）。 */
  raDeg: number;
  /** 赤纬（度，[-90, 90]，J2000）。 */
  decDeg: number;
  /** 地心距离（AU）。 */
  distanceAu: number;
  /** 日心距离（AU）。 */
  helioDistanceAu: number;
}

/**
 * 由真近点角/日心距 + 轨道定向角计算地心 J2000 赤道坐标（内置/动态两路共用出口）。
 * 标准三旋转 + 黄赤转换 + 地心化，绝无查表/编造坐标。
 */
function nuToEquatorial(
  nu: number,
  r: number,
  omegaDeg: number,
  wDeg: number,
  iDeg: number,
  date: Date,
): MinorBodyEquatorial {
  // 日心黄道 J2000（标准三旋转展开式）：u = ω + ν
  const u = wDeg * DEG2RAD + nu;
  const om = omegaDeg * DEG2RAD;
  const inc = iDeg * DEG2RAD;
  const cosU = Math.cos(u);
  const sinU = Math.sin(u);
  const x = r * (Math.cos(om) * cosU - Math.sin(om) * sinU * Math.cos(inc));
  const y = r * (Math.sin(om) * cosU + Math.cos(om) * sinU * Math.cos(inc));
  const z = r * sinU * Math.sin(inc);

  // 黄道 → 赤道 J2000：绕 x 轴转 ε
  const eps = OBLIQUITY_DEG * DEG2RAD;
  const xq = x;
  const yq = y * Math.cos(eps) - z * Math.sin(eps);
  const zq = y * Math.sin(eps) + z * Math.cos(eps);

  // 地心化：HelioVector(Body.Earth) 返回【EQJ 赤道 J2000】坐标（AU），同参考系直接相减
  const earth = HelioVector(Body.Earth, date);
  const gx = xq - earth.x;
  const gy = yq - earth.y;
  const gz = zq - earth.z;
  const rho = Math.hypot(gx, gy, gz);

  return {
    raDeg: normalizeRaDeg(Math.atan2(gy, gx) * RAD2DEG),
    decDeg: Math.asin(Math.max(-1, Math.min(1, gz / rho))) * RAD2DEG,
    distanceAu: rho,
    helioDistanceAu: r,
  };
}

/**
 * 计算某时刻某小天体的地心 J2000 赤道坐标（演示级 ±0.5°）。
 * 内置 6 体走既有椭圆开普勒路径（9C 零回归契约）；动态注册体按偏心率分流：
 * e<0.98 仍走椭圆路径，近抛物线（e ∈ [0.98, 1.2]）走通用变量法（universalKepler）。
 */
export function getMinorBodyEquatorial(id: MinorBodyId, date: Date): MinorBodyEquatorial {
  const jd = msToJd(date.getTime());
  const builtin = (ELEMENTS as Record<string, MinorBodyElements>)[id];

  if (builtin) {
    // —— 内置路径（与 9B 完全一致）：M = M0 + n·Δt → E → ν, r ——
    const n = K_GAUSS / Math.pow(builtin.aAu, 1.5);
    const M = normalizeRad(builtin.m0Deg * DEG2RAD + n * (jd - builtin.epochJd));
    const E = solveKepler(M, builtin.e);
    const nu = 2 * Math.atan2(
      Math.sqrt(1 + builtin.e) * Math.sin(E / 2),
      Math.sqrt(1 - builtin.e) * Math.cos(E / 2),
    );
    const r = builtin.aAu * (1 - builtin.e * Math.cos(E));
    return nuToEquatorial(nu, r, builtin.omegaDeg, builtin.wDeg, builtin.iDeg, date);
  }

  const dyn = DYNAMIC_ORBITS.get(id);
  if (!dyn) throw new Error(`未知小天体: ${id}`);

  if (dyn.elliptic) {
    // 动态椭圆（e<0.98）：同一套旧路径公式，仅参数来源不同
    const { aAu, m0Deg, epochJd } = dyn.elliptic;
    const n = K_GAUSS / Math.pow(aAu, 1.5);
    const M = normalizeRad(m0Deg * DEG2RAD + n * (jd - epochJd));
    const E = solveKepler(M, dyn.e);
    const nu = 2 * Math.atan2(
      Math.sqrt(1 + dyn.e) * Math.sin(E / 2),
      Math.sqrt(1 - dyn.e) * Math.cos(E / 2),
    );
    const r = aAu * (1 - dyn.e * Math.cos(E));
    return nuToEquatorial(nu, r, dyn.omDeg, dyn.wDeg, dyn.iDeg, date);
  }

  // 近抛物线：q/tp 参数化 + 通用变量法（registerMinorBodyOrbit 已保证 tpJd 存在）
  const { nuRad, rAu } = trueAnomalyRadiusUniversal(dyn.qAu, dyn.e, jd - (dyn.tpJd ?? jd));
  return nuToEquatorial(nuRad, rAu, dyn.omDeg, dyn.wDeg, dyn.iDeg, date);
}

/** 便捷：uid（'MB-CERES'）直接算坐标，供 web 信息卡使用；非小天体 uid 抛错。 */
export function getMinorBodyEquatorialByUid(uid: string, date: Date): MinorBodyEquatorial {
  return getMinorBodyEquatorial(minorUidToId(uid), date);
}
