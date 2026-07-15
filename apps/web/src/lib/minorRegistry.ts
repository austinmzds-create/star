/**
 * 小天体状态注册表（模块级单例，镜像 ephemRegistry 模式）。
 *
 * 6 个小天体（谷神/灶神/智神 3 小行星 + 哈雷/恩克/庞斯-布鲁克斯 3 彗星）
 * 的地心 J2000 坐标由 @star/astro-ephem 的
 * minorBodies（JPL 根数 + 开普勒求解）按 observeTime 计算。
 * 状态槽保持独立注册表（不与 ephemRegistry 合表），但重算入口有两个：
 * MinorBodiesLayer（懒加载）订阅 observeTime 驱动 + EphemDriver 实时模式
 * 30s 心跳直驱——astro-ephem 小天体代码已被 StarInfoCard 静态引入主包，
 * EphemDriver 引 recomputeMinorBodies 增量≈1KB，不再有包体顾虑。
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
  /**
   * 彗尾当前是否可见（Phase 9B）：仅彗星有意义，由 CometTailLayer 按
   * observeTime 量化键写入（视角长与亮度双阈值判定，演示级）。
   * 注意（集成验证修订）：StarInfoCard 的「彗尾可见 · 演示级」徽章不读
   * 本字段——旗标由懒 chunk 在挂载后写入，而卡片只随 store 变化重渲染，
   * 深链/暂停态下会读到写入前的旧值；徽章改用同一纯函数
   * （computeCometTailGeometry，同 1h 量化键）同步推导。本字段保留给
   * 层内状态恢复（deepTime 退出）与调试消费。
   */
  tailVisible: boolean;
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
      tailVisible: false,
      vec: new THREE.Vector3(),
    });
  }
  return { version: 0, computedAtMs: 0, states };
}

export const minor: MinorRegistry = createRegistry();

/**
 * 整批重算 6 个小天体（开普勒 + HelioVector，<1.5ms）。
 * 仅在 observeTime 变化（MinorBodiesLayer effect）或实时模式 30s 心跳
 * （EphemDriver）时调用——小天体日运动角分级，绝不逐帧计算；
 * 相同 dateMs 去重直接 return，两路驱动幂等无争。
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

/**
 * 写入彗尾可见状态（Phase 9B）：CometTailLayer 按 1h 量化键低频调用。
 * 只改字段不 bump version——version 语义是「坐标已重算」，彗尾旗标由
 * UI 侧在自身渲染节奏里读取即可。未知 uid 静默忽略（层卸载竞态防御）。
 */
export function setCometTailVisible(uid: string, visible: boolean): void {
  const state = minor.states.get(uid);
  if (state) state.tailVisible = visible;
}
