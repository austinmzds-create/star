/**
 * localStorage 偏好读写（Phase 6B 体验层唯一入口）。
 *
 * SSR / 隐私模式安全：任何异常一律吞掉返回默认值 / 静默失败。
 * 键统一加前缀 'star.'。已用键：
 *   star.redLight       boolean  红光护眼
 *   star.ambientOn      boolean  环境音开关
 *   star.ambientVolume  number   环境音音量 0–1
 *   star.viewMode.v1    'free'|'earth'  观察模式（Phase 9B 地平锁定；带版本号
 *                       ——若未来翻转默认值需换 v2 新键弃读旧键，见下）
 *   star.skyRealism.v1      'all'|'naked'          真实天空模式（Phase 10）
 *   star.lightPollution.v1  'city'|'suburb'|'wild' 光污染档（Phase 10；naked 生效）
 *   star.planetsEnlarged.v1 boolean                行星放大开关（Phase 10）
 *   star.realSkyHintSeen.v1 boolean                进 earth 建议切裸眼的一次性提示已处理
 *
 * 显示类开关（showMinorBodies/showSatellites 等）刻意【不持久化】：
 * 默认值翻转（如 Phase 8 把 showMinorBodies 改为默认开）即对全量用户生效，
 * 无迁移。若未来要持久化某个显示开关，必须用带版本的新键
 * （如 star.showMinorBodies.v2）且旧键弃读——否则默认值翻转会被
 * 用户 localStorage 里的旧值压住，形同没改。
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
