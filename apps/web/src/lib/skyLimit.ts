/**
 * 裸眼极限星等总线（Phase 10「真实天空+悬停」域；模块级单例，非 React 状态）。
 *
 * 为什么做成单例 + 每帧一次 tick（与 skyFrame.ts 同纪律）：真实模式下核心星层、
 * 扩展层、DSO 层都要按【同一个】渐隐极限截断——若各层各自 damp，会在拖动档位
 * 时出现半秒的密度错拍。这里维护唯一的 current 值，各层 useFrame 直读 uniform，
 * 零 React、零分配。
 *
 * 与冻结契约的映射：极限星等由 (skyRealism, lightPollution) 共同决定——
 *   skyRealism==='all'  → 99（smoothstep 恒返 0，vMagVis=1，与关闭态逐位等价）；
 *   skyRealism==='naked'→ MAG_LIMIT_OF[lightPollution]（城市 4.0 / 郊区 6.0 / 荒野 6.5）。
 */

import { MAG_LIMIT_OF, type LightPollution, type SkyRealism } from './store';

/** all 档的「永不裁」哨兵星等（大到任何真实星等都亮于它）。 */
const MAG_ALL = 99;

/**
 * 渐隐羽化宽度（星等）：alpha 在 [L-FEATHER, L] 内从 1→0，避免拖动档位时硬切闪烁。
 * 星层顶点着色器 uMagFeather 常量直取此值。
 */
export const SKY_MAG_FEATHER = 0.7;

/** 切档补间率 λ(1/s)，~0.4s 追平（与 skyFrame 的指数跟踪同风格）。 */
const TRACK_LAMBDA = 6;

let target = MAG_ALL;
let current = MAG_ALL;

/** 由真实天空 + 光污染档解析出的目标极限星等（纯函数，供订阅点调用）。 */
export function resolveMagLimit(realism: SkyRealism, lp: LightPollution): number {
  return realism === 'all' ? MAG_ALL : MAG_LIMIT_OF[lp];
}

/** 低频写入目标（store 订阅回调调用；skyRealism/lightPollution 任一变化时）。 */
export function setSkyLimitTarget(realism: SkyRealism, lp: LightPollution): void {
  target = resolveMagLimit(realism, lp);
}

/** 每帧一次推进（UniverseScene 的天旋 group useFrame 内，紧邻 tickSkyFrame）。 */
export function tickSkyLimit(dt: number): void {
  if (Math.abs(target - current) < 1e-3) {
    current = target;
    return;
  }
  current += (target - current) * (1 - Math.exp(-TRACK_LAMBDA * dt));
}

/** 当前极限星等（星层 useFrame 直读写入 uMagLimit；all 档=99 → 恒不裁）。 */
export function getSkyMagLimit(): number {
  return current;
}
