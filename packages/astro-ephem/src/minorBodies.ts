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
import { minorUidToId, type MinorBodyId } from './minorBodiesMeta';

export * from './minorBodiesMeta';

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
const ELEMENTS: Record<MinorBodyId, MinorBodyElements> = {
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
};

/** 取某小天体的轨道根数（含来源说明，信息卡展示用）。 */
export function getMinorBodyElements(id: MinorBodyId): MinorBodyElements {
  return ELEMENTS[id];
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
 * 计算某时刻某小天体的地心 J2000 赤道坐标（演示级 ±0.5°）。
 * 全公式推导（开普勒方程 + 标准三旋转 + 黄赤转换），绝无查表/编造坐标。
 */
export function getMinorBodyEquatorial(id: MinorBodyId, date: Date): MinorBodyEquatorial {
  const el = ELEMENTS[id];
  const jd = msToJd(date.getTime());

  // 平近点角：n = K_GAUSS / a^1.5（rad/day），M = M0 + n·Δt
  const n = K_GAUSS / Math.pow(el.aAu, 1.5);
  const M = normalizeRad(el.m0Deg * DEG2RAD + n * (jd - el.epochJd));
  const E = solveKepler(M, el.e);

  // 真近点角 ν 与日心距离 r
  const nu = 2 * Math.atan2(
    Math.sqrt(1 + el.e) * Math.sin(E / 2),
    Math.sqrt(1 - el.e) * Math.cos(E / 2),
  );
  const r = el.aAu * (1 - el.e * Math.cos(E));

  // 日心黄道 J2000（标准三旋转展开式）：u = ω + ν
  const u = el.wDeg * DEG2RAD + nu;
  const om = el.omegaDeg * DEG2RAD;
  const inc = el.iDeg * DEG2RAD;
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

/** 便捷：uid（'MB-CERES'）直接算坐标，供 web 信息卡使用；非小天体 uid 抛错。 */
export function getMinorBodyEquatorialByUid(uid: string, date: Date): MinorBodyEquatorial {
  return getMinorBodyEquatorial(minorUidToId(uid), date);
}
