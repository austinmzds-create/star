/**
 * 设备性能分档：低端设备做渲染降级（见 docs 渲染设计 §5.3）。
 *
 * 低档判定（任一命中即 low）：
 *  - CPU 逻辑核 <= 4；
 *  - 触屏且屏宽 < 820（典型手机/小平板）；
 *  - deviceMemory <= 4GB（Chrome 系可用）。
 *
 * 低档降级项（由各消费组件执行）：
 *  dpr 上限 1.5 / 关 antialias / 不加载扩展星场 / 环境星场减半 /
 *  假星云只留 2 团 / 行星光晕省略。
 */

export type DeviceTier = 'high' | 'low';

export function getDeviceTier(): DeviceTier {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return 'high';
  const cores = navigator.hardwareConcurrency ?? 8;
  // deviceMemory 是非标准字段（Chrome 系），类型上不存在，运行时探测。
  const deviceMemory = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  const smallTouch = 'ontouchstart' in window && window.innerWidth < 820;
  if (cores <= 4) return 'low';
  if (smallTouch) return 'low';
  if (deviceMemory !== undefined && deviceMemory <= 4) return 'low';
  return 'high';
}
