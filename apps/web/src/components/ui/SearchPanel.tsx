'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useMemo, useRef, useState } from 'react';
import { CONSTELLATION_ABBR, searchCelestial, type StarSearchResult } from '@star/astro-data';
import { exits, springs, stagger } from '@/lib/motionTokens';
import { constellationToAbbr, searchTypeBadgeZh } from '@/lib/objectPresenter';
import { SEARCH_CATALOG } from '@/lib/solarSystem';
import { useUniverse } from '@/lib/store';

/** 示例词覆盖各类目标：恒星 / 行星 / 深空 / 星座。 */
const EXAMPLES = ['天狼星', '火星', '仙女座星系', '猎户座', '织女星', '北极星'];

/** 星座条目（搜索结果顶部）：88 条线性扫 en/zh/缩写 includes 匹配。 */
interface ConstellationMatch {
  abbr: string;
  en: string;
  zh: string;
}

function matchConstellations(query: string): ConstellationMatch[] {
  const raw = query.trim();
  const q = raw.toLowerCase();
  if (!q) return [];
  const out: ConstellationMatch[] = [];
  for (const [abbr, v] of Object.entries(CONSTELLATION_ABBR)) {
    if (v.zh.includes(raw) || v.en.toLowerCase().includes(q) || abbr.toLowerCase() === q) {
      out.push({ abbr, en: v.en, zh: v.zh });
    }
  }
  return out.slice(0, 2);
}

export function SearchPanel() {
  const focusStar = useUniverse((s) => s.focusStar);
  const activateConstellation = useUniverse((s) => s.activateConstellation);
  // 开场序曲 stagger（Phase 9A）：'playing' 期隐藏待命，结束后依次入场
  const overturePhase = useUniverse((s) => s.overturePhase);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    // 全站目录：恒星 + 深空 + 行星日月（行星坐标由星历层实时提供，列表星等取典型值）
    return searchCelestial(query, { limit: 7, catalog: SEARCH_CATALOG });
  }, [query]);

  // 星座直达条目：置于结果列表顶部，选中即点亮连线 + 镜头飞向星座全貌。
  const conMatches = useMemo(() => matchConstellations(query), [query]);

  const chooseConstellation = (c: ConstellationMatch) => {
    activateConstellation(c.abbr, 'search');
    setQuery(c.zh);
    setOpen(false);
    inputRef.current?.blur();
  };

  const choose = (r: StarSearchResult) => {
    const uid = r.object.objectUid;
    // 搜到卫星/小天体 → 自动开启对应层；层 mount 后发现自己是 selectedUid
    // 会补飞一次（focusNonce 幂等），首搜零坐标问题闭环。
    if (uid.startsWith('SAT-')) useUniverse.setState({ showSatellites: true });
    else if (uid.startsWith('MB-')) useUniverse.setState({ showMinorBodies: true });
    // 星历天体（EPH-）不在 astro-data 目录内，仍可正常飞行：
    // CameraRig 经 resolveObjectPosition 取星历实时坐标。
    focusStar(uid);
    // 命中星座（查询即星座名）→ 同时点亮星座连线动画
    if (r.matchedOn === 'constellation') {
      const abbr =
        constellationToAbbr(r.object.constellation) ??
        constellationToAbbr(r.object.constellationZh);
      if (abbr) activateConstellation(abbr, 'search');
    }
    setQuery(r.object.nameZh);
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    // 定位层（-translate-x-1/2）与动画层分离：framer 会整体接管 motion 元素的
    // transform，序曲入场动画必须包在内层，外层纯 CSS 定位不参与动画。
    <div className="pointer-events-auto absolute left-1/2 top-6 z-30 w-[min(92vw,460px)] -translate-x-1/2">
      <motion.div
        initial={{ opacity: 0, y: -14 }}
        animate={overturePhase === 'playing' ? { opacity: 0, y: -14 } : { opacity: 1, y: 0 }}
        transition={{
          ...springs.panel,
          delay: overturePhase === 'done' ? 1 * stagger.section : 0,
        }}
      >
        <div className="glass flex items-center gap-3 rounded-2xl px-4 py-3">
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                // 顶部条目优先：星座直达 > 首个天体结果。
                if (conMatches[0]) chooseConstellation(conMatches[0]);
                else if (results[0]) choose(results[0]);
              }
              if (e.key === 'Escape') {
                setQuery('');
                setOpen(false);
              }
            }}
            placeholder="搜索星星、行星、星云、星座 — 天狼星 / 火星 / M31"
            className="w-full bg-transparent text-[15px] text-white placeholder:text-nebula-200/40 focus:outline-none"
          />
          {query && (
            <button
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="text-nebula-200/50 transition hover:text-white"
              aria-label="清除"
            >
              ✕
            </button>
          )}
        </div>

        <AnimatePresence mode="popLayout">
          {open && (query ? results.length > 0 || conMatches.length > 0 : true) && (
            // 展开坑位处理（r-fx §2.4/§3.d）：容器 layout 平滑高度变化；
            // 圆角写进 style 让库逐帧校正（layout 的 scale 会畸变 class 圆角）；
            // 子项 layout="position" 只挪位不拉伸。
            <motion.div
              layout
              style={{ borderRadius: 16 }}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6, transition: exits.fast }}
              transition={springs.panel}
              className="glass-strong mt-2 overflow-hidden"
            >
              {!query && (
                <motion.div layout="position" className="px-4 py-3">
                  <div className="mb-2 text-[11px] uppercase tracking-[0.24em] text-nebula-200/50">
                    试试这些
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {EXAMPLES.map((ex) => (
                      <motion.button
                        key={ex}
                        layout="position"
                        whileTap={{ scale: 0.96 }}
                        transition={springs.chip}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setQuery(ex);
                          setOpen(true);
                          inputRef.current?.focus();
                        }}
                        className="tap-96 rounded-full border border-nebula-400/20 bg-white/5 px-3 py-1 text-[13px] text-nebula-100 transition hover:bg-white/10"
                      >
                        {ex}
                      </motion.button>
                    ))}
                  </div>
                </motion.div>
              )}

              {query &&
                conMatches.map((c) => (
                  <motion.button
                    key={`con-${c.abbr}`}
                    layout="position"
                    whileTap={{ scale: 0.98 }}
                    transition={springs.chip}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => chooseConstellation(c)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-white/[0.06]"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-medium text-white">
                        ⌘ {c.zh}
                        <span className="ml-2 text-[12px] font-normal text-nebula-200/60">
                          {c.en}
                        </span>
                      </div>
                      <div className="truncate text-[12px] text-nebula-200/50">
                        飞向星座 · 点亮连线
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full border border-nebula-400/25 bg-nebula-500/15 px-2 py-0.5 text-[11px] text-nebula-100">
                      星座
                    </span>
                  </motion.button>
                ))}

              {query &&
                results.map((r) => {
                  const typeBadge = searchTypeBadgeZh(r.object);
                  return (
                    <motion.button
                      key={r.object.objectUid}
                      layout="position"
                      whileTap={{ scale: 0.98 }}
                      transition={springs.chip}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(r)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-white/[0.06]"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[15px] font-medium text-white">
                          {r.object.nameZh}
                          <span className="ml-2 text-[12px] font-normal text-nebula-200/60">
                            {r.object.nameEn}
                          </span>
                        </div>
                        <div className="truncate text-[12px] text-nebula-200/50">
                          {r.object.constellationZh} · {r.object.bayer ?? r.object.objectUid}
                        </div>
                      </div>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {typeBadge && (
                          <span className="rounded-full border border-nebula-400/25 bg-nebula-500/15 px-2 py-0.5 text-[11px] text-nebula-100">
                            {typeBadge}
                          </span>
                        )}
                        <span className="rounded-full border border-nebula-400/20 px-2 py-0.5 text-[11px] text-gold">
                          {r.object.magnitude.toFixed(2)}
                        </span>
                      </span>
                    </motion.button>
                  );
                })}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      className="shrink-0 text-nebula-200/70"
    >
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
      <path d="m20 20-3.2-3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
