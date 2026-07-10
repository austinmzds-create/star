'use client';

import {
  computeObservationSummary,
  computeVisibility,
} from '@star/astro-core';
import { getCelestialByUid } from '@star/astro-data';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo } from 'react';
import { CITIES } from '@/lib/cities';
import {
  formatBeijingTime,
  formatDec,
  formatDistance,
  formatRA,
} from '@/lib/format';
import { useUniverse } from '@/lib/store';

export function StarInfoCard() {
  const selectedUid = useUniverse((s) => s.selectedUid);
  const city = useUniverse((s) => s.city);
  const setCity = useUniverse((s) => s.setCity);
  const observeTime = useUniverse((s) => s.observeTime);
  const setObserveTime = useUniverse((s) => s.setObserveTime);
  const selectStar = useUniverse((s) => s.selectStar);
  const openMemorial = useUniverse((s) => s.openMemorial);

  const star = selectedUid ? getCelestialByUid(selectedUid) : undefined;

  useEffect(() => {
    if (observeTime == null) setObserveTime(Date.now());
  }, [observeTime, setObserveTime]);

  const visibility = useMemo(() => {
    if (!star) return null;
    const now = new Date(observeTime ?? Date.now());
    const observer = { latitudeDeg: city.latitudeDeg, longitudeDeg: city.longitudeDeg };
    const eq = { raDeg: star.raDeg, decDeg: star.decDeg };
    return {
      snapshot: computeVisibility(eq, observer, now),
      summary: computeObservationSummary(eq, observer, now),
    };
  }, [star, city, observeTime]);

  return (
    <AnimatePresence>
      {star && (
        <motion.aside
          key={star.objectUid}
          initial={{ opacity: 0, x: 32 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 32 }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          className="pointer-events-auto absolute right-5 top-1/2 z-30 w-[min(92vw,360px)] -translate-y-1/2"
        >
          <div className="glass-strong max-h-[82vh] overflow-y-auto rounded-3xl p-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-semibold text-white">{star.nameZh}</h2>
                <div className="mt-1 text-[13px] tracking-wide text-nebula-200/70">
                  {star.nameEn}
                  {star.bayer ? ` · ${star.bayer}` : ''}
                </div>
              </div>
              <button
                onClick={() => selectStar(null)}
                className="rounded-full border border-white/10 px-2 py-0.5 text-nebula-200/60 transition hover:bg-white/10 hover:text-white"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Badge>{star.constellationZh}</Badge>
              {star.spectralType && <Badge>{star.spectralType}</Badge>}
              <Badge>视星等 {star.magnitude.toFixed(2)}</Badge>
            </div>

            {star.descriptionZh && (
              <p className="mt-4 text-[13.5px] leading-relaxed text-nebula-100/85">
                {star.descriptionZh}
              </p>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3">
              <Fact label="距离" value={formatDistance(star.distanceLy)} />
              <Fact label="星座" value={star.constellationZh} />
              <Fact label="赤经 RA" value={formatRA(star.raDeg)} />
              <Fact label="赤纬 Dec" value={formatDec(star.decDeg)} />
            </div>

            {visibility && (
              <div className="mt-5 rounded-2xl border border-nebula-400/15 bg-white/[0.03] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[12px] uppercase tracking-[0.22em] text-nebula-200/60">
                    今晚怎么找
                  </span>
                  <select
                    value={city.id}
                    onChange={(e) => {
                      const c = CITIES.find((x) => x.id === e.target.value);
                      if (c) setCity(c);
                    }}
                    className="rounded-lg border border-white/10 bg-void/60 px-2 py-1 text-[13px] text-white focus:outline-none"
                  >
                    {CITIES.map((c) => (
                      <option key={c.id} value={c.id} className="bg-void text-white">
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {visibility.summary.neverRises ? (
                  <p className="text-[13px] text-nebula-100/80">
                    在{city.name}，这颗星赤纬过低，几乎无法升起。
                  </p>
                ) : (
                  <div className="space-y-2 text-[13px] text-nebula-100/85">
                    <VisRow
                      label="此刻"
                      value={
                        visibility.snapshot.isAboveHorizon
                          ? `地平线上 · ${visibility.snapshot.direction.zh} · 高度 ${visibility.snapshot.horizontal.altitudeDeg.toFixed(0)}°`
                          : '在地平线以下'
                      }
                    />
                    <VisRow
                      label="过中天"
                      value={`${formatBeijingTime(visibility.summary.nextTransit)} 前后 · 最高 ${visibility.summary.maxAltitudeDeg.toFixed(0)}°`}
                    />
                    {visibility.summary.isCircumpolar && (
                      <VisRow label="特性" value="拱极星 · 全天不落" />
                    )}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={openMemorial}
              className="mt-5 w-full rounded-2xl bg-gradient-to-r from-nebula-500 to-nebula-700 py-3 text-[15px] font-medium text-white shadow-[0_8px_30px_rgba(107,115,255,0.35)] transition hover:brightness-110"
            >
              为这颗星创建纪念命名
            </button>
            <p className="mt-3 text-center text-[11px] leading-relaxed text-nebula-200/45">
              私人纪念命名登记，不代表 IAU 或任何官方天文机构命名
            </p>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-nebula-400/25 bg-white/5 px-2.5 py-0.5 text-[12px] text-nebula-100">
      {children}
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.03] px-3 py-2">
      <div className="text-[11px] text-nebula-200/50">{label}</div>
      <div className="mt-0.5 text-[14px] text-white">{value}</div>
    </div>
  );
}

function VisRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-nebula-200/55">{label}</span>
      <span className="text-right text-white">{value}</span>
    </div>
  );
}
