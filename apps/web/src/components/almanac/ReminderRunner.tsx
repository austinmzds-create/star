'use client';

/**
 * 页面本地提醒轮询器（挂在 AlmanacApp 内，无 UI）：
 * 每 30s 检查 localStorage 登记，对「1 小时内即将发生且未发过」的事件
 * 触发一次浏览器 Notification。仅在本页面开启期间生效（弹层文案已注明）。
 * 不在此处请求权限——权限请求只发生在用户点击「页面提醒」时。
 */
import { useEffect } from 'react';
import {
  listReminders,
  markReminderFired,
  pruneExpiredReminders,
} from '@/lib/almanac/reminders';
import { formatBeijingTime } from '@/lib/format';

const POLL_MS = 30_000;
const LEAD_MS = 60 * 60_000; // 提前 1 小时内提醒

export function ReminderRunner() {
  useEffect(() => {
    pruneExpiredReminders();
    const tick = () => {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      const now = Date.now();
      for (const r of listReminders()) {
        if (r.fired) continue;
        const delta = r.timeMs - now;
        if (delta <= 0 || delta > LEAD_MS) continue;
        try {
          new Notification('星辰纪念 · 天象提醒', {
            body: `${r.title} 将于 ${formatBeijingTime(new Date(r.timeMs))}（北京时间）发生`,
          });
        } catch {
          // 部分平台（如 Android Chrome 页面上下文）构造 Notification 会抛错：静默跳过
        }
        markReminderFired(r.id);
      }
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  return null;
}
