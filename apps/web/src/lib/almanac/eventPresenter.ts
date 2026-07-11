/**
 * 天象事件展示层：kind → 徽章字/颜色/深链。纯函数，零重依赖。
 * 月相/超级月亮的图标由 EventCard 直接渲染 <MoonPhaseIcon/>（moonPhaseDeg 提供相位角）。
 */
import type { AlmanacEvent } from '@star/astro-ephem/events';

export interface EventPresentation {
  /** 徽章单字（食/合/距/冲/至/分/流…）；月相类为 null（用月相图标代替）。 */
  badgeText: string | null;
  /** 徽章 tailwind 配色类。 */
  badgeClass: string;
  /** 「在星图中查看」深链（无聚焦目标时为 null）。 */
  deepLink: string | null;
  /** 月相图标相位角（度；仅 moon-quarter / supermoon）。 */
  moonPhaseDeg: number | null;
}

/** 事件深链：/?t=&focus= 或 /?t=&con=（流星雨辐射点星座）。 */
function deepLinkOf(e: AlmanacEvent): string | null {
  if (e.focusUid) return `/?t=${e.timeMs}&focus=${encodeURIComponent(e.focusUid)}`;
  if (e.focusConstellation) {
    // 流星雨极大（allDay，UTC 零点）：深链取当日 18:00 UTC = 北京次日凌晨 2 点，
    // 后半夜辐射点较高，星图打开即接近最佳观测时段。
    const t = e.allDay ? e.timeMs + 18 * 3_600_000 : e.timeMs;
    return `/?t=${t}&con=${encodeURIComponent(e.focusConstellation)}`;
  }
  return null;
}

/** 事件 → 展示元数据。 */
export function presentEvent(e: AlmanacEvent): EventPresentation {
  const deepLink = deepLinkOf(e);
  switch (e.kind) {
    case 'moon-quarter':
      return { badgeText: null, badgeClass: '', deepLink, moonPhaseDeg: e.quarter * 90 };
    case 'supermoon':
      return { badgeText: null, badgeClass: '', deepLink, moonPhaseDeg: 180 };
    case 'lunar-eclipse':
    case 'solar-eclipse':
      return {
        badgeText: '食',
        badgeClass: 'bg-red-500/15 text-red-300 border-red-400/30',
        deepLink,
        moonPhaseDeg: null,
      };
    case 'conjunction':
      return {
        badgeText: '合',
        badgeClass: 'bg-amber-400/15 text-amber-200 border-amber-300/30',
        deepLink,
        moonPhaseDeg: null,
      };
    case 'max-elongation':
      return {
        badgeText: '距',
        badgeClass: 'bg-cyan-400/15 text-cyan-200 border-cyan-300/30',
        deepLink,
        moonPhaseDeg: null,
      };
    case 'opposition':
      return {
        badgeText: '冲',
        badgeClass: 'bg-orange-400/15 text-orange-200 border-orange-300/30',
        deepLink,
        moonPhaseDeg: null,
      };
    case 'season':
      return {
        badgeText: e.season.includes('equinox') ? '分' : '至',
        badgeClass: 'bg-emerald-400/15 text-emerald-200 border-emerald-300/30',
        deepLink,
        moonPhaseDeg: null,
      };
    case 'meteor-shower':
      return {
        badgeText: '流',
        badgeClass: 'bg-purple-400/15 text-purple-200 border-purple-300/30',
        deepLink,
        moonPhaseDeg: null,
      };
  }
}
