import { getDeviceTier } from './deviceTier';

/**
 * 运行时质量档总线（模块级单例）——「后处理」域创建并独家拥有写入权。
 *
 * 【跨域契约（Phase 9A 冻结）】getPerfTier / subscribePerfTier：
 *   与 deviceTier 的区别——deviceTier 是启动时的静态硬件判定（一次 + GPU
 *   探测微调一次），PerfTier 是运行期实时质量档：PostFX 的 PerformanceMonitor
 *   熔断（掉帧降档、恢复升档、抖动锁死）会随时改写它。
 *   其它域只读：悬停节流间隔、glass blur 半径、stagger 密度等按档消费。
 *
 * 初始值取 deviceTier（等值映射），此后由 PostFX 按熔断阶梯维护。
 */

export type PerfTier = 'high' | 'mid' | 'low';

// 惰性初始化：模块可能在 SSR 阶段被加载（deviceTier SSR 返回 'high'），
// 首次客户端读取时再取真实设备档。
let tier: PerfTier | null = null;
const listeners = new Set<(t: PerfTier) => void>();

/** 读当前质量档（帧循环可直读，零分配）。 */
export function getPerfTier(): PerfTier {
  if (tier === null) tier = getDeviceTier();
  return tier;
}

/** 订阅质量档变化；返回退订函数。回调携带新档位。 */
export function subscribePerfTier(listener: (t: PerfTier) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 仅「后处理」域（PostFX 熔断逻辑）调用；同值去重后广播。 */
export function setPerfTier(next: PerfTier): void {
  if (getPerfTier() === next) return;
  tier = next;
  for (const l of listeners) l(next);
}
