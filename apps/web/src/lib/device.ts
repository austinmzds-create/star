/**
 * 轻量设备特征探测（星座层用；性能分档另见 deviceTier.ts）。
 * 所有函数 SSR 安全：无 window 时返回保守默认值。
 */

/** 是否粗指针设备（触屏手机/平板）。星座层据此收紧节流与纹理档位。 */
export function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

/** 用户是否偏好减弱动效（prefers-reduced-motion）。 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
