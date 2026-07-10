'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useMemo, useRef, useState } from 'react';
import { searchCelestial } from '@star/astro-data';
import { useUniverse } from '@/lib/store';

const EXAMPLES = ['天狼星', '织女星', '北极星', '参宿四', '猎户座'];

export function SearchPanel() {
  const focusStar = useUniverse((s) => s.focusStar);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    return searchCelestial(query, { limit: 7 });
  }, [query]);

  const choose = (uid: string, label: string) => {
    focusStar(uid);
    setQuery(label);
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="pointer-events-auto absolute left-1/2 top-6 z-30 w-[min(92vw,460px)] -translate-x-1/2">
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
            if (e.key === 'Enter' && results[0]) {
              choose(results[0].object.objectUid, results[0].object.nameZh);
            }
            if (e.key === 'Escape') {
              setQuery('');
              setOpen(false);
            }
          }}
          placeholder="搜索星星、星座 — 天狼星 / Vega / 北极星"
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

      <AnimatePresence>
        {open && (query ? results.length > 0 : true) && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
            className="glass-strong mt-2 overflow-hidden rounded-2xl"
          >
            {!query && (
              <div className="px-4 py-3">
                <div className="mb-2 text-[11px] uppercase tracking-[0.24em] text-nebula-200/50">
                  试试这些
                </div>
                <div className="flex flex-wrap gap-2">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setQuery(ex);
                        setOpen(true);
                        inputRef.current?.focus();
                      }}
                      className="rounded-full border border-nebula-400/20 bg-white/5 px-3 py-1 text-[13px] text-nebula-100 transition hover:bg-white/10"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {query &&
              results.map((r) => (
                <button
                  key={r.object.objectUid}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(r.object.objectUid, r.object.nameZh)}
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
                  <span className="shrink-0 rounded-full border border-nebula-400/20 px-2 py-0.5 text-[11px] text-gold">
                    {r.object.magnitude.toFixed(2)}
                  </span>
                </button>
              ))}
          </motion.div>
        )}
      </AnimatePresence>
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
