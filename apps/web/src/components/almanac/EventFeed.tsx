'use client';

/**
 * 事件流视图：按北京时间月份分组的事件卡列表。
 * 同日的「超级月亮 + 满月」合并为一张卡（presenter 层合并，
 * events 数据保持正交——满月与超级月亮是两条独立事件）。
 */
import type { AlmanacEvent } from '@star/astro-ephem/events';
import { useMemo } from 'react';
import { EventCard } from './EventCard';

const monthFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  timeZone: 'Asia/Shanghai',
});

/** UTC 日期键（超级月亮与满月同刻判定用）。 */
function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

interface FeedItem {
  event: AlmanacEvent;
  titleOverride?: string;
}

interface MonthGroup {
  label: string;
  items: FeedItem[];
}

export function EventFeed({ events }: { events: AlmanacEvent[] }) {
  const groups = useMemo<MonthGroup[]>(() => {
    // 超级月亮日期集合：同日 quarter-full 卡被吸收进超级月亮卡
    const supermoonDays = new Set(
      events.filter((e) => e.kind === 'supermoon').map((e) => utcDayKey(e.timeMs)),
    );
    const out: MonthGroup[] = [];
    let current: MonthGroup | null = null;
    for (const e of events) {
      if (
        e.kind === 'moon-quarter' &&
        e.quarter === 2 &&
        supermoonDays.has(utcDayKey(e.timeMs))
      ) {
        continue; // 该满月由同日超级月亮卡合并呈现
      }
      const item: FeedItem =
        e.kind === 'supermoon' ? { event: e, titleOverride: '超级月亮（满月）' } : { event: e };
      const label = monthFormatter.format(new Date(e.timeMs));
      if (!current || current.label !== label) {
        current = { label, items: [] };
        out.push(current);
      }
      current.items.push(item);
    }
    return out;
  }, [events]);

  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.label}>
          <h2 className="mb-3 flex items-baseline gap-2 px-1">
            <span className="text-[15px] font-medium text-white">{g.label}</span>
            <span className="text-[12px] text-nebula-200/50">{g.items.length} 个天象</span>
          </h2>
          <div className="space-y-3">
            {g.items.map((item) => (
              <EventCard
                key={item.event.id}
                event={item.event}
                titleOverride={item.titleOverride}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
