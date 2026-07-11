/**
 * localStorage 偏好读写（Phase 6B 体验层唯一入口）。
 *
 * SSR / 隐私模式安全：任何异常一律吞掉返回默认值 / 静默失败。
 * 键统一加前缀 'star.'。已用键：
 *   star.redLight       boolean  红光护眼
 *   star.ambientOn      boolean  环境音开关
 *   star.ambientVolume  number   环境音音量 0–1
 */
const PREFIX = 'star.';

export function readPref<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writePref<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* 隐私模式 / 配额满：静默 */
  }
}
