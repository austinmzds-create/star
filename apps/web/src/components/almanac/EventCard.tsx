'use client';

/**
 * 天象事件卡：左侧图标位（月相 SVG / 类别徽章字）+ 标题/时刻/描述 +
 * 「提醒 ▾」（.ics 下载 / 页面浏览器通知）与「在星图中查看」（深链）。
 *
 * Notification 权限克制策略：绝不在页面加载时请求，仅当用户点击
 * 「页面提醒」时才 requestPermission；拒绝/不支持给出明确文案。
 */
import type { AlmanacEvent } from '@star/astro-ephem/events';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { downloadIcs } from '@/lib/almanac/ics';
import { presentEvent } from '@/lib/almanac/eventPresenter';
import { addReminder, hasReminder } from '@/lib/almanac/reminders';
import { formatBeijingTime } from '@/lib/format';
import { MoonPhaseIcon } from './MoonPhaseIcon';

/** 事件日期（北京时间，如「8月13日 周四」）。 */
function formatBeijingDate(ms: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'Asia/Shanghai',
  }).format(new Date(ms));
}

type NotifyState = 'idle' | 'unsupported' | 'denied' | 'set';

export function EventCard({
  event,
  titleOverride,
}: {
  event: AlmanacEvent;
  /** 合并卡标题覆盖（如「超级月亮（满月）」）。 */
  titleOverride?: string;
}) {
  const p = presentEvent(event);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notify, setNotify] = useState<NotifyState>(() =>
    typeof window !== 'undefined' && hasReminder(event.id) ? 'set' : 'idle',
  );
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击卡外收起提醒弹层
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const title = titleOverride ?? event.titleZh;

  const onDownloadIcs = () => {
    downloadIcs(`star-almanac-${event.id}.ics`, [
      {
        id: event.id,
        startMs: event.timeMs,
        summary: `星辰纪念 · ${title}`,
        description: event.descriptionZh,
        allDay: event.allDay,
      },
    ]);
    setMenuOpen(false);
  };

  const onPageReminder = async () => {
    if (typeof Notification === 'undefined') {
      setNotify('unsupported');
      return;
    }
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setNotify('denied');
      return;
    }
    addReminder({ id: event.id, timeMs: event.timeMs, title });
    setNotify('set');
  };

  return (
    <div className="glass relative flex gap-3.5 rounded-2xl p-4">
      {/* 左侧 40px 图标位 */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center">
        {p.moonPhaseDeg != null ? (
          <MoonPhaseIcon phaseDeg={p.moonPhaseDeg} size={34} />
        ) : (
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-full border text-[15px] font-medium ${p.badgeClass}`}
          >
            {p.badgeText}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          <h3 className="text-[15px] font-medium text-white">{title}</h3>
          <span className="text-[12.5px] tabular-nums text-nebula-200/60">
            {formatBeijingDate(event.timeMs)}
            {!event.allDay && ` ${formatBeijingTime(new Date(event.timeMs))}`}
          </span>
        </div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-nebula-100/75">
          {event.descriptionZh}
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className={`rounded-full border px-3 py-1 text-[12px] transition ${
                notify === 'set'
                  ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
                  : 'border-white/10 bg-white/[0.04] text-nebula-100/80 hover:bg-white/[0.08] hover:text-white'
              }`}
            >
              {notify === 'set' ? '已设提醒 ✓' : '提醒 ▾'}
            </button>
            {menuOpen && (
              <div className="glass-strong absolute bottom-full left-0 z-10 mb-2 w-64 rounded-xl p-2 text-[12.5px]">
                <button
                  onClick={onDownloadIcs}
                  className="block w-full rounded-lg px-3 py-2 text-left text-nebula-100/90 transition hover:bg-white/[0.08] hover:text-white"
                >
                  添加到日历 (.ics)
                </button>
                <button
                  onClick={() => void onPageReminder()}
                  className="block w-full rounded-lg px-3 py-2 text-left text-nebula-100/90 transition hover:bg-white/[0.08] hover:text-white"
                >
                  {notify === 'unsupported'
                    ? '此浏览器不支持通知'
                    : notify === 'denied'
                      ? '通知权限已被拒绝'
                      : notify === 'set'
                        ? '页面提醒 · 已设 ✓'
                        : '页面提醒（浏览器通知）'}
                </button>
                {notify === 'denied' && (
                  <p className="px-3 py-1 text-[11px] leading-relaxed text-nebula-200/50">
                    浏览器已拒绝通知权限，可在地址栏站点设置中恢复。
                  </p>
                )}
                <p className="px-3 pb-1 pt-1.5 text-[11px] leading-relaxed text-nebula-200/45">
                  页面提醒仅在本页面开启期间生效；如需可靠提醒请使用 .ics
                  添加到系统日历。
                </p>
              </div>
            )}
          </div>

          {p.deepLink && (
            <Link
              href={p.deepLink}
              prefetch={false}
              className="rounded-full border border-nebula-400/25 bg-nebula-500/10 px-3 py-1 text-[12px] text-nebula-100 transition hover:bg-nebula-500/20 hover:text-white"
            >
              在星图中查看 →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
