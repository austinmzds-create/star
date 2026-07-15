'use client';

/**
 * 未来 N 个月天象事件的计算 hook。
 *
 * 12 个月全量 ≈ 150–250ms（合相粗采样为大头）：按类别分 4 片执行，
 * 片间 setTimeout(0) 让出主线程；每片完成即增量 setEvents，骨架屏只在
 * 第一片前出现（首帧 <50ms 内容可见）。模块级缓存按「起始日」命中，
 * SPA 内往返 /almanac 免重算。如未来加轨道计算再评估 worker 化。
 */
import {
  computeConjunctions,
  computeEclipses,
  computeElongationsOppositions,
  computeMeteorShowers,
  computeMoonQuarters,
  computeSeasons,
  computeSupermoons,
  type AlmanacEvent,
} from '@star/astro-ephem/events';
import { useEffect, useState } from 'react';

/** 缓存键：起始日（UTC yyyymmdd）+ 月数；值为完整结果。 */
const cache = new Map<string, AlmanacEvent[]>();

function cacheKey(fromMs: number, months: number): string {
  const d = new Date(fromMs);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}-${months}`;
}

/** 让出主线程一拍。 */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export interface UseAlmanacResult {
  /** 事件列表（时间升序）；null = 首片尚未算完（骨架屏）。计算中为部分结果。 */
  events: AlmanacEvent[] | null;
  /** 全部分片是否已完成。 */
  complete: boolean;
}

export function useAlmanac(months = 12): UseAlmanacResult {
  const [state, setState] = useState<UseAlmanacResult>(() => {
    // 客户端首渲染即尝试命中缓存（useState 惰性初始化在 effect 之前）
    if (typeof window !== 'undefined') {
      const hit = cache.get(cacheKey(Date.now(), months));
      if (hit) return { events: hit, complete: true };
    }
    return { events: null, complete: false };
  });

  useEffect(() => {
    const fromMs = Date.now();
    const key = cacheKey(fromMs, months);
    const cached = cache.get(key);
    if (cached) {
      setState({ events: cached, complete: true });
      return;
    }

    let cancelled = false;
    const to = new Date(fromMs);
    to.setUTCMonth(to.getUTCMonth() + months);
    const toMs = to.getTime();

    // 按耗时排片：① 快组 ② 日月食 ③ 大距/冲/超级月亮 ④ 合相（最重 ~150ms）
    const chunks: Array<() => AlmanacEvent[]> = [
      () => [
        ...computeMoonQuarters(fromMs, toMs),
        ...computeSeasons(fromMs, toMs),
        ...computeMeteorShowers(fromMs, toMs),
      ],
      () => computeEclipses(fromMs, toMs),
      () => [
        ...computeElongationsOppositions(fromMs, toMs),
        ...computeSupermoons(fromMs, toMs),
      ],
      () => computeConjunctions(fromMs, toMs),
    ];

    void (async () => {
      const acc: AlmanacEvent[] = [];
      for (let i = 0; i < chunks.length; i++) {
        if (i > 0) await yieldToMain();
        if (cancelled) return;
        acc.push(...chunks[i]!());
        acc.sort((a, b) => a.timeMs - b.timeMs);
        const done = i === chunks.length - 1;
        if (done) cache.set(key, [...acc]);
        if (!cancelled) setState({ events: [...acc], complete: done });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [months]);

  return state;
}
