/**
 * 页面本地提醒登记（localStorage）：仅在 /almanac 页面开启期间生效的
 * 浏览器 Notification 提醒（ReminderRunner 轮询触发）。
 * 需要可靠提醒请走 .ics 添加到系统日历（EventCard 弹层内已注明）。
 */

export interface AlmanacReminder {
  /** 事件 id（与 AlmanacEvent.id / ics UID 同源）。 */
  id: string;
  /** 事件时刻（UTC epoch ms）。 */
  timeMs: number;
  /** 通知标题（事件中文名）。 */
  title: string;
  /** 已发过通知（防重复）。 */
  fired?: boolean;
}

const STORAGE_KEY = 'star.almanac.reminders.v1';

function read(): AlmanacReminder[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is AlmanacReminder =>
        typeof r === 'object' && r !== null &&
        typeof (r as AlmanacReminder).id === 'string' &&
        typeof (r as AlmanacReminder).timeMs === 'number' &&
        typeof (r as AlmanacReminder).title === 'string',
    );
  } catch {
    return [];
  }
}

function write(list: AlmanacReminder[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // localStorage 不可用（隐私模式等）：静默降级，提醒仅本次会话内存生效
  }
}

/** 列出全部登记（含已过期，调用方可先 pruneExpiredReminders）。 */
export function listReminders(): AlmanacReminder[] {
  return read();
}

/** 是否已为某事件设过提醒。 */
export function hasReminder(id: string): boolean {
  return read().some((r) => r.id === id);
}

/** 登记一条提醒（同 id 幂等覆盖）。 */
export function addReminder(reminder: AlmanacReminder): void {
  const list = read().filter((r) => r.id !== reminder.id);
  list.push(reminder);
  write(list);
}

/** 移除一条提醒。 */
export function removeReminder(id: string): void {
  write(read().filter((r) => r.id !== id));
}

/** 标记某条提醒已发过通知。 */
export function markReminderFired(id: string): void {
  write(read().map((r) => (r.id === id ? { ...r, fired: true } : r)));
}

/** 清理已过期（事件时刻已过去 1 天以上）的登记。 */
export function pruneExpiredReminders(now = Date.now()): void {
  write(read().filter((r) => r.timeMs > now - 86_400_000));
}
