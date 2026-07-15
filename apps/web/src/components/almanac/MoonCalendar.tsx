'use client';

/**
 * 月相日历视图：周一起始的月历网格，每天小月相图标 + 月出月落时刻，
 * 下方「当日详情」面板（大月相图 + 相名/照亮比例 + 升落 + 当日天象）。
 *
 * 日界固定北京时（UTC+8，中国无夏令时，直接偏移 8 小时做日界，不引入 tz 库）。
 * 单月数据（31×getMoonPhase + 31×computeMoonRiseSet ≈ 20ms）同步 useMemo 可接受。
 */
import { getMoonPhase, moonPhaseName } from '@star/astro-ephem';
import { computeMoonRiseSet, type AlmanacEvent } from '@star/astro-ephem/events';
import { useMemo, useState } from 'react';
import type { City } from '@/lib/cities';
import { formatBeijingTime } from '@/lib/format';
import { EventCard } from './EventCard';
import { MoonPhaseIcon } from './MoonPhaseIcon';

const BJ_OFFSET_MS = 8 * 3_600_000;

/** 当前北京日历日期（年/月/日）。 */
function beijingToday(): { year: number; month: number; day: number } {
  const bj = new Date(Date.now() + BJ_OFFSET_MS);
  return { year: bj.getUTCFullYear(), month: bj.getUTCMonth(), day: bj.getUTCDate() };
}

/** 北京日历日 (y, m, d) 的零点（UTC epoch ms）。 */
function beijingDayStartMs(year: number, month: number, day: number): number {
  return Date.UTC(year, month, day) - BJ_OFFSET_MS;
}

/** epoch ms → 北京日历日键 'y-m-d'。 */
function beijingDayKey(ms: number): string {
  const bj = new Date(ms + BJ_OFFSET_MS);
  return `${bj.getUTCFullYear()}-${bj.getUTCMonth()}-${bj.getUTCDate()}`;
}

interface DayCell {
  day: number;
  dayStartMs: number;
  phaseDeg: number;
  illumination: number;
  riseMs: number | null;
  setMs: number | null;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const;

export function MoonCalendar({
  city,
  events,
}: {
  city: City;
  events: AlmanacEvent[] | null;
}) {
  const today = useMemo(beijingToday, []);
  // 月导航范围钳制：[当月, 当月+11]（与事件流 12 个月窗口一致）
  const baseIndex = today.year * 12 + today.month;
  const [monthIndex, setMonthIndex] = useState(baseIndex);
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  const [selectedDay, setSelectedDay] = useState(monthIndex === baseIndex ? today.day : 1);

  const cells = useMemo<DayCell[]>(() => {
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const out: DayCell[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dayStartMs = beijingDayStartMs(year, month, d);
      // 取北京正午的月相代表整日
      const phase = getMoonPhase(new Date(dayStartMs + 12 * 3_600_000));
      const rs = computeMoonRiseSet(dayStartMs, city.latitudeDeg, city.longitudeDeg);
      out.push({
        day: d,
        dayStartMs,
        phaseDeg: phase.phaseAngleDeg,
        illumination: phase.illumination,
        riseMs: rs.riseMs,
        setMs: rs.setMs,
      });
    }
    return out;
  }, [year, month, city.latitudeDeg, city.longitudeDeg]);

  // 周一起始的前置空位数：周日(0)→6，周一(1)→0…
  const leadingBlanks = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;

  const selected = cells.find((c) => c.day === selectedDay) ?? cells[0];
  const selectedEvents = useMemo(() => {
    if (!events || !selected) return [];
    const key = beijingDayKey(selected.dayStartMs + 12 * 3_600_000);
    return events.filter((e) => beijingDayKey(e.timeMs) === key);
  }, [events, selected]);

  const isCurrentMonth = monthIndex === baseIndex;

  const goMonth = (delta: number) => {
    const next = Math.min(baseIndex + 11, Math.max(baseIndex, monthIndex + delta));
    if (next === monthIndex) return;
    setMonthIndex(next);
    setSelectedDay(next === baseIndex ? today.day : 1);
  };

  return (
    <div>
      {/* 月导航 */}
      <div className="mb-4 flex items-center justify-center gap-4">
        <button
          onClick={() => goMonth(-1)}
          disabled={monthIndex <= baseIndex}
          className="rounded-full border border-white/10 px-3 py-1 text-[13px] text-nebula-100/80 transition hover:bg-white/[0.08] disabled:opacity-30"
          aria-label="上一月"
        >
          ◀
        </button>
        <div className="w-32 text-center text-[15px] font-medium text-white">
          {year}年{month + 1}月
        </div>
        <button
          onClick={() => goMonth(1)}
          disabled={monthIndex >= baseIndex + 11}
          className="rounded-full border border-white/10 px-3 py-1 text-[13px] text-nebula-100/80 transition hover:bg-white/[0.08] disabled:opacity-30"
          aria-label="下一月"
        >
          ▶
        </button>
      </div>

      {/* 周标题 + 日历网格 */}
      <div className="glass rounded-2xl p-3">
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((w) => (
            <div key={w} className="pb-1 text-center text-[11px] text-nebula-200/50">
              {w}
            </div>
          ))}
          {Array.from({ length: leadingBlanks }, (_, i) => (
            <div key={`blank-${i}`} />
          ))}
          {cells.map((cell) => {
            const isToday = isCurrentMonth && cell.day === today.day;
            const isSelected = cell.day === selectedDay;
            return (
              <button
                key={cell.day}
                onClick={() => setSelectedDay(cell.day)}
                className={`flex flex-col items-center gap-0.5 rounded-xl px-0.5 py-1.5 transition ${
                  isSelected
                    ? 'bg-nebula-500/25 shadow-[inset_0_0_0_1px_rgba(140,155,255,0.45)]'
                    : 'hover:bg-white/[0.05]'
                } ${isToday && !isSelected ? 'shadow-[inset_0_0_0_1px_rgba(251,191,36,0.4)]' : ''}`}
              >
                <span
                  className={`text-[12px] tabular-nums ${
                    isToday ? 'text-amber-200' : 'text-nebula-100/85'
                  }`}
                >
                  {cell.day}
                </span>
                <MoonPhaseIcon phaseDeg={cell.phaseDeg} size={22} />
                <span className="hidden text-[10px] leading-tight text-nebula-200/45 sm:block">
                  {cell.riseMs != null ? `升${formatBeijingTime(new Date(cell.riseMs))}` : '无月出'}
                </span>
                <span className="hidden text-[10px] leading-tight text-nebula-200/45 sm:block">
                  {cell.setMs != null ? `落${formatBeijingTime(new Date(cell.setMs))}` : '无月落'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 当日详情 */}
      {selected && (
        <div className="glass mt-4 rounded-2xl p-5">
          <div className="flex items-center gap-5">
            <MoonPhaseIcon phaseDeg={selected.phaseDeg} size={64} />
            <div>
              <div className="text-[17px] font-medium text-white">
                {month + 1}月{selected.day}日 · {moonPhaseName(selected.phaseDeg)}
              </div>
              <div className="mt-1 text-[13px] text-nebula-100/75">
                照亮 {Math.round(selected.illumination * 100)}%
              </div>
              <div className="mt-1 text-[13px] text-nebula-100/75">
                {city.name} · 月出{' '}
                {selected.riseMs != null ? formatBeijingTime(new Date(selected.riseMs)) : '今日无月出'}{' '}
                · 月落{' '}
                {selected.setMs != null ? formatBeijingTime(new Date(selected.setMs)) : '今日无月落'}
              </div>
            </div>
          </div>
          {(selected.riseMs == null || selected.setMs == null) && (
            <p className="mt-3 text-[11.5px] text-nebula-200/45">
              月亮升落周期约 24 小时 50 分，每月约有一天缺失月出或月落，属正常现象。
            </p>
          )}
          {selectedEvents.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="text-[12px] uppercase tracking-[0.22em] text-nebula-200/55">
                当日天象
              </div>
              {selectedEvents.map((e) => (
                <EventCard key={e.id} event={e} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
