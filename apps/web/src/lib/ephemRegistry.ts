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

// 模块加载时先按「现在」算一遍，保证任何消费方（含 SSR 之后的首帧）
// 都能读到合理坐标；EphemDriver 挂载后会以 store.observeTime 对齐重算。
try {
  recomputeEphemeris(Date.now());
} catch {
  // astronomy-engine 异常时保持占位 0——渲染层按 version=0 视为「无数据」静默降级。
}
