/**
 * 星历注册表（模块级单例，非 React 状态）。
 *
 * 太阳/月亮/行星的实时坐标由 @star/astro-ephem 按 observeTime 计算，
 * 写入本注册表并自增 version；渲染层（PlanetsLayer/TargetHighlight）在
 * useFrame 里比较 version（O(1)），版本变化才搬运坐标——帧内零 React 更新。
 *
 * 每个天体的 vec 是【固定引用、原地 mutate】的 THREE.Vector3：
 * pickRegistry 的行星拾取条目直接持有同一引用，重算星历时拾取表零重建。
 */

import { raDecToVector3 } from '@star/astro-core';
import {
  getEquatorial,
  getMoonPhase,
  listEphemerisBodies,
  type EphemerisBodyId,
} from '@star/astro-ephem';
import * as THREE from 'three';
import { SPHERE_RADIUS } from './universe';

/** 单个星历天体的当前状态（坐标为最近一次 recomputeEphemeris 时刻的值）。 */
export interface EphemBodyState {
  uid: string;
  bodyId: EphemerisBodyId;
  kind: 'sun' | 'moon' | 'planet';
  nameZh: string;
  nameEn: string;
  colorHex: string;
  displaySize: number;
  /** 展示用典型视星等（列表/徽章场景足够）。 */
  magnitude: number;
  raDeg: number;
  decDeg: number;
  distanceAu: number;
  /** 月相角（度，仅月亮有）：0 新月 / 90 上弦 / 180 满月 / 270 下弦。 */
  phaseAngleDeg?: number;
  /** 被照亮比例 0–1（仅月亮有）。 */
  phaseFraction?: number;
  /** 天球世界坐标——固定引用、原地 mutate，勿替换实例。 */
  vec: THREE.Vector3;
}

interface EphemRegistry {
  /** 每次 recomputeEphemeris 自增；消费方用它做「变了才搬坐标」的帧内比较。 */
  version: number;
  /** 最近一次计算的时刻（epoch ms）；0 表示尚未计算。 */
  computedAtMs: number;
  bodies: Map<string, EphemBodyState>;
}

/** 模块加载即建好 9 个天体的状态槽（坐标占位 0，首次 recompute 前不应消费）。 */
function createRegistry(): EphemRegistry {
  const bodies = new Map<string, EphemBodyState>();
  for (const meta of listEphemerisBodies()) {
    bodies.set(meta.objectUid, {
      uid: meta.objectUid,
      bodyId: meta.bodyId,
      kind: meta.kind,
      nameZh: meta.nameZh,
      nameEn: meta.nameEn,
      colorHex: meta.colorHex,
      displaySize: meta.displaySize,
      magnitude: meta.typicalMagnitude,
      raDeg: 0,
      decDeg: 0,
      distanceAu: 0,
      vec: new THREE.Vector3(),
    });
  }
  return { version: 0, computedAtMs: 0, bodies };
}

export const ephem: EphemRegistry = createRegistry();

/**
 * 整批重算 9 个天体的地心 J2000 坐标（astronomy-engine 单体 <1ms，整批 <10ms）。
 * 仅在 observeTime 变化（EphemDriver）时调用——绝不在 useFrame 里逐帧调用。
 */
export function recomputeEphemeris(dateMs: number): void {
  const date = new Date(dateMs);
  const moonPhase = getMoonPhase(date);
  for (const body of ephem.bodies.values()) {
    const eq = getEquatorial(body.bodyId, date);
    body.raDeg = eq.raDeg;
    body.decDeg = eq.decDeg;
    body.distanceAu = eq.distanceAu;
    const v = raDecToVector3({ raDeg: eq.raDeg, decDeg: eq.decDeg }, SPHERE_RADIUS);
    body.vec.set(v.x, v.y, v.z); // 原地 mutate：pickRegistry 持同一引用
    if (body.bodyId === 'moon') {
      body.phaseAngleDeg = moonPhase.phaseAngleDeg;
      body.phaseFraction = moonPhase.illumination;
    }
  }
  ephem.computedAtMs = dateMs;
  ephem.version += 1;
}

// ── 播放平滑工具（Phase 9B §3b，跨域共享） ──

/**
 * 版本坐标插值窗口（ms）：与 TimeMachineBar 的 4Hz（250ms）observeTime
 * 节流对齐——渲染层把「上一 version 的显示位置 → 新 version 目标位置」
 * 在一个节流周期内补间完，位置恰好在下一次 version 到达时收敛。
 */
export const EPHEM_SLERP_WINDOW_MS = 250;

// slerp 的模块级 scratch（帧循环零分配纪律；单线程渲染无重入风险）
const slerpA = new THREE.Vector3();
const slerpB = new THREE.Vector3();

/**
 * 天球坐标球面插值（Phase 9B §3b 播放平滑，【跨域共享工具】）：
 * 把以球心为原点的两向量 a→b 按 t∈[0,1] 沿大圆插值写入 out，半径线性过渡。
 *
 * 消费方：PlanetsLayer（本「轨迹升落」域）与 MinorBodiesLayer/CometTailLayer
 * （「彗尾」域）——各渲染层在 useFrame 里对 prev/next version 坐标做 slerp
 * （因子 = 距 version 变化的墙钟时间 / EPHEM_SLERP_WINDOW_MS），消除时间
 * 机器播放 4Hz 写入的台阶跳动。每帧 ≤13 次调用、零分配。
 *
 * 退化处理：
 *  - a/b 有占位零向量（星历未算）→ 直接取 b；
 *  - 夹角 <0.006°（实时心跳的微小步进）→ 线性插值（数值更稳、观感等同）；
 *  - 近反平行（>179.9°，仅 ±24h 级大跳变会出现）→ 大圆路径不唯一，
 *    退化线性 + NaN 防御，观感一闪而过，可接受。
 */
export function slerpSphereVec(
  a: THREE.Vector3,
  b: THREE.Vector3,
  t: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const ra = a.length();
  const rb = b.length();
  if (ra < 1e-9 || rb < 1e-9) return out.copy(b);
  slerpA.copy(a).multiplyScalar(1 / ra);
  slerpB.copy(b).multiplyScalar(1 / rb);
  let cos = slerpA.dot(slerpB);
  cos = cos > 1 ? 1 : cos < -1 ? -1 : cos;
  const omega = Math.acos(cos);
  const r = ra + (rb - ra) * t;
  if (omega < 1e-4 || omega > Math.PI - 1.8e-3) {
    out.copy(slerpA).lerp(slerpB, t);
    const len = out.length();
    // 反平行 lerp 过零 → 归一失效，直接取终点方向兜底
    if (len < 1e-6) return out.copy(slerpB).multiplyScalar(r);
    return out.multiplyScalar(r / len);
  }
  const sinO = Math.sin(omega);
  const wa = Math.sin((1 - t) * omega) / sinO;
  const wb = Math.sin(t * omega) / sinO;
  return out
    .set(
      slerpA.x * wa + slerpB.x * wb,
      slerpA.y * wa + slerpB.y * wb,
      slerpA.z * wa + slerpB.z * wb,
    )
    .multiplyScalar(r);
}

// 模块加载时先按「现在」算一遍，保证任何消费方（含 SSR 之后的首帧）
// 都能读到合理坐标；EphemDriver 挂载后会以 store.observeTime 对齐重算。
try {
  recomputeEphemeris(Date.now());
} catch {
  // astronomy-engine 异常时保持占位 0——渲染层按 version=0 视为「无数据」静默降级。
}
