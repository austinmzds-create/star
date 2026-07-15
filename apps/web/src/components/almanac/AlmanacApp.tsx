'use client';

/**
 * /almanac 路由根组件：未来 12 个月天象事件流 + 月相月历。
 * 计算走 useAlmanac（分片让出主线程）；城市复用主站 store 的 city/setCity。
 * 本路由禁止 import three/R3F/UniverseScene 任何东西（保持独立轻 chunk）。
 */
import Link from 'next/link';
import { useState } from 'react';
import { downloadIcs, type IcsEvent } from '@/lib/almanac/ics';
import { useAlmanac } from '@/lib/almanac/useAlmanac';
import { CITIES } from '@/lib/cities';
import { useUniverse } from '@/lib/store';
import { EventFeed } from './EventFeed';
import { MoonCalendar } from './MoonCalendar';
import { ReminderRunner } from './ReminderRunner';

type AlmanacView = 'feed' | 'calendar';

export function AlmanacApp() {
  const city = useUniverse((s) => s.city);
  const setCity = useUniverse((s) => s.setCity);
  const [view, setView] = useState<AlmanacView>('feed');
  const { events, complete } = useAlmanac(12);

  const onExportAll = () => {
    if (!events) return;
    const icsEvents: IcsEvent[] = events.map((e) => ({
      id: e.id,
      startMs: e.timeMs,
      summary: `星辰纪念 · ${e.titleZh}`,
      description: e.descriptionZh,
      allDay: e.allDay,
    }));
    downloadIcs('star-almanac-12mo.ics', icsEvents);
  };

  return (
    <div className="h-full overflow-y-auto bg-void">
      <ReminderRunner />

      {/* 顶部 sticky 头 */}
      <header className="glass sticky top-0 z-20 px-4 py-3">
        <div className="mx-auto flex max-w-[720px] items-center justify-between gap-3">
          <Link
            href="/"
            prefetch={false}
            className="shrink-0 text-[13px] text-nebula-200/70 transition hover:text-white"
          >
            ← 返回星空
          </Link>
          <h1 className="text-[16px] font-medium tracking-[0.2em] text-white">天象日历</h1>
          <div className="flex shrink-0 items-center gap-2">
            <select
              value={city.id}
              onChange={(e) => {
                const c = CITIES.find((x) => x.id === e.target.value);
                if (c) setCity(c);
              }}
              className="rounded-lg border border-white/10 bg-void/60 px-2 py-1 text-[12.5px] text-white focus:outline-none"
              aria-label="观测城市"
            >
              {CITIES.map((c) => (
                <option key={c.id} value={c.id} className="bg-void text-white">
                  {c.name}
                </option>
              ))}
            </select>
            <div className="flex rounded-full border border-white/10 bg-white/[0.04] p-0.5 text-[12.5px]">
              {(
                [
                  ['feed', '事件流'],
                  ['calendar', '月历'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setView(key)}
                  className={`rounded-full px-3 py-1 transition ${
                    view === key
                      ? 'bg-nebula-500/30 text-white'
                      : 'text-nebula-200/60 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[720px] px-4 pb-24 pt-6">
        {view === 'feed' ? (
          <>
            <div className="mb-5 flex items-center justify-between">
              <p className="text-[12.5px] text-nebula-200/55">
                未来 12 个月的月相、日月食、行星合月、大距冲日与流星雨
                {!complete && events && ' · 计算中…'}
              </p>
              <button
                onClick={onExportAll}
                disabled={!complete}
                className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[12px] text-nebula-100/80 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
              >
                导出全部事件 .ics
              </button>
            </div>
            {events ? <EventFeed events={events} /> : <FeedSkeleton />}
          </>
        ) : (
          <MoonCalendar city={city} events={events} />
        )}

        {/* 合规脚注 */}
        <footer className="mt-12 border-t border-white/[0.06] pt-5 text-center text-[11px] leading-relaxed text-nebula-200/40">
          天象时刻由天文算法（astronomy-engine）计算，供观星参考；实际可见性受天气、
          地形与光污染影响。私人纪念命名登记，不代表 IAU 或任何官方天文机构命名。
        </footer>
      </main>
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="glass h-24 animate-pulse rounded-2xl" />
      ))}
    </div>
  );
}
