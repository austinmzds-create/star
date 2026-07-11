/**
 * 小天体状态注册表（模块级单例，镜像 ephemRegistry 模式）。
 *
 * 谷神星/灶神星/智神星/哈雷彗星的地心 J2000 坐标由 @star/astro-ephem 的
 * minorBodies（JPL 根数 + 开普勒求解）按 observeTime 计算。
 * 刻意【不并入 ephemRegistry/EphemDriver】：那是多 agent 热点文件，且小天体
 * 默认关、不应常驻计算——MinorBodiesLayer（懒加载）自行订阅 observeTime 驱动。
 *
 * 每个天体的 vec 是【固定引用、原地 mutate】的 THREE.Vector3：
 * pickRegistry 动态条目直接持同一引用，重算时拾取表零重建。
 */

import { raDecToVector3 } from '@star/astro-core';
import {
  getMinorBodyEquatorial,
  listMinorBodies,
  type MinorBodyId,
} from '@star/astro-ephem';
import * as THREE from 'three';
import { SPHERE_RADIUS } from './universe';

/** 单个小天体的当前状态（坐标为最近一次 recomputeMinorBodies 时刻的值）。 */
export interface MinorBodyState {
  uid: string;
  id: MinorBodyId;
  kind: 'asteroid' | 'comet';
  nameZh: string;
  colorHex: string;
  raDeg: number;
  decDeg: number;
  /** 地心距离（AU）。 */
  distanceAu: number;
  /** 日心距离（AU）。 */
  helioDistanceAu: number;
  /** 天球世界坐标——固定引用、原地 mutate，勿替换实例。 */
  vec: THREE.Vector3;
}

interface MinorRegistry {
  /** 每次 recomputeMinorBodies 自增；消费方 useFrame 比较版本才搬坐标。 */
  version: number;
  /** 最近一次计算的时刻（epoch ms）；0 表示尚未计算。 */
  computedAtMs: number;
  states: Map<string, MinorBodyState>;
}

function createRegistry(): MinorRegistry {
  const states = new Map<string, MinorBodyState>();
  for (const meta of listMinorBodies()) {
    states.set(meta.objectUid, {
      uid: meta.objectUid,
      id: meta.id,
      kind: meta.kind,
      nameZh: meta.nameZh,
      colorHex: meta.colorHex,
      raDeg: 0,
      decDeg: 0,
      distanceAu: 0,
      helioDistanceAu: 0,
      vec: new THREE.Vector3(),
    });
  }
  return { version: 0, computedAtMs: 0, states };
}

export const minor: MinorRegistry = createRegistry();

/**
 * 整批重算 4 个小天体（开普勒 + HelioVector，<1ms）。
 * 仅在 observeTime 变化（MinorBodiesLayer effect）时调用——小天体日运动
 * 角分级，绝不逐帧计算；相同 dateMs 去重直接 return。
 */
export function recomputeMinorBodies(dateMs: number): void {
  if (dateMs === minor.computedAtMs && minor.version > 0) return;
  const date = new Date(dateMs);
  for (const state of minor.states.values()) {
    const eq = getMinorBodyEquatorial(state.id, date);
    state.raDeg = eq.raDeg;
    state.decDeg = eq.decDeg;
    state.distanceAu = eq.distanceAu;
    state.helioDistanceAu = eq.helioDistanceAu;
    const v = raDecToVector3({ raDeg: eq.raDeg, decDeg: eq.decDeg }, SPHERE_RADIUS * 0.99);
    state.vec.set(v.x, v.y, v.z); // 原地 mutate：pickRegistry 持同一引用
  }
  minor.computedAtMs = dateMs;
  minor.version += 1;
}
