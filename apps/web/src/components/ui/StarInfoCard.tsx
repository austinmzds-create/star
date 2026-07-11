'use client';

import {
  computeObservationSummary,
  computeVisibility,
} from '@star/astro-core';
import {
  getEquatorial,
  getMoonPhase,
  isEphemerisUid,
  moonPhaseName,
  uidToBodyId,
} from '@star/astro-ephem';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo } from 'react';
import { CITIES } from '@/lib/cities';
import {
  formatBeijingTime,
  formatDec,
  formatDistance,
  formatRA,
} from '@/lib/format';
import { formatDistanceAu, kindLabelZh, primaryBadgeZh } from '@/lib/objectPresenter';
import { getObjectByUid } from '@/lib/solarSystem';
import { useUniverse } from '@/lib/store';

/**
 * 天体信息卡（按类型泛化）：
 *  - 恒星：光谱/距离/坐标/今晚可见性/命名 CTA（isNamable 才显示）；
 *  - 深空天体（星系/星云/星团）：类型徽章 + 简介 + 固定坐标可见性；
 *  - 行星/日月：坐标与距离（AU）按 observeTime 实时计算，月亮加月相行。
 *
 * 合规：不可命名天体（DSO/行星/日月/著名星）不显示命名 CTA，
 * 改为「探索可命名的星空」引导回命名池，脚注追加说明。
 */
export function StarInfoCard() {
  const selectedUid = useUniverse((s) => s.selectedUid);
  const city = useUniverse((s) => s.city);
  const setCity = useUniverse((s) => s.setCity);
  const observeTime = useUniverse((s) => s.observeTime);
  const setObserveTime = useUniverse((s) => s.setObserveTime);
  const selectStar = useUniverse((s) => s.selectStar);
  const openMemorial = useUniverse((s) => s.openMemorial);
  const resetView = useUniverse((s) => s.resetView);
  const coupleMode = useUniverse((s) => s.coupleMode);
  const coupleSlotA = useUniverse((s) => s.coupleSlotA);
  const coupleSlotB = useUniverse((s) => s.coupleSlotB);
  const addStarToCouple = useUniverse((s) => s.addStarToCouple);

  const obj = selectedUid ? getObjectByUid(selectedUid) : undefined;
  const inCouple = obj ? obj.objectUid === coupleSlotA || obj.objectUid === coupleSlotB : false;

  useEffect(() => {
    if (observeTime == null) setObserveTime(Date.now());
  }, [observeTime, setObserveTime]);

  // 星历天体（行星/日月）的实时坐标 + 月相：低频（选中/时间变化）计算，<1ms
  const eph = useMemo(() => {
    if (!obj?.isEphemeris || !isEphemerisUid(obj.objectUid)) return null;
    const date = new Date(observeTime ?? Date.now());
    const bodyId = uidToBodyId(obj.objectUid);
    const eq = getEquatorial(bodyId, date);
    const moon = bodyId === 'moon' ? getMoonPhase(date) : null;
    return { bodyId, eq, moon };
  }, [obj, observeTime]);

  // 展示与可见性统一用「当前坐标」：星历天体取实时值，其余取目录静态值
  const coords = eph
    ? { raDeg: eph.eq.raDeg, decDeg: eph.eq.decDeg }
    : obj
      ? { raDeg: obj.raDeg, decDeg: obj.decDeg }
      : null;

  const visibility = useMemo(() => {
    if (!obj || !coords) return null;
    const now = new Date(observeTime ?? Date.now());
    const observer = { latitudeDeg: city.latitudeDeg, longitudeDeg: city.longitudeDeg };
    return {
      snapshot: computeVisibility(coords, observer, now),
      summary: computeObservationSummary(coords, observer, now),
    };
    // coords 由 obj/eph 派生，依赖已覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obj, eph, city, observeTime]);

  const isStar = obj?.type === 'star';
  const badge = obj ? primaryBadgeZh(obj) : null;

  return (
    <AnimatePresence>
      {obj && (
        <motion.aside
          key={obj.objectUid}
          initial={{ opacity: 0, x: 32 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 32 }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          className="pointer-events-auto absolute right-5 top-1/2 z-30 w-[min(92vw,360px)] -translate-y-1/2"
        >
          <div className="glass-strong max-h-[82vh] overflow-y-auto rounded-3xl p-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-semibold text-white">{obj.nameZh}</h2>
                <div className="mt-1 text-[13px] tracking-wide text-nebula-200/70">
                  {obj.commonNameZh ? `${obj.commonNameZh} · ` : ''}
                  {obj.nameEn}
                  {obj.bayer ? ` · ${obj.bayer}` : ''}
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
              {badge && <Badge>{badge}</Badge>}
              {!eph && <Badge>{obj.constellationZh}</Badge>}
              {isStar && obj.spectralType && <Badge>{obj.spectralType}</Badge>}
              <Badge>视星等 {obj.magnitude.toFixed(2)}</Badge>
            </div>

            {obj.descriptionZh && (
              <p className="mt-4 text-[13.5px] leading-relaxed text-nebula-100/85">
                {obj.descriptionZh}
              </p>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3">
              {eph ? (
                <Fact label="地心距离" value={formatDistanceAu(eph.eq.distanceAu)} />
              ) : (
                <Fact label="距离" value={formatDistance(obj.distanceLy)} />
              )}
              {eph ? (
                <Fact label="类型" value={kindLabelZh(obj)} />
              ) : (
                <Fact label="星座" value={obj.constellationZh} />
              )}
              {coords && <Fact label="赤经 RA" value={formatRA(coords.raDeg)} />}
              {coords && <Fact label="赤纬 Dec" value={formatDec(coords.decDeg)} />}
              {eph?.moon && (
                <Fact
                  label="月相"
                  value={`${moonPhaseName(eph.moon.phaseAngleDeg)} · 照亮 ${Math.round(eph.moon.illumination * 100)}%`}
                />
              )}
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
                    在{city.name}，这个天体赤纬过低，几乎无法升起。
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

            {obj.isNamable ? (
              coupleMode ? (
                <button
                  onClick={() => addStarToCouple(obj.objectUid)}
                  className={`mt-5 w-full rounded-2xl py-3 text-[15px] font-medium text-white shadow-[0_8px_30px_rgba(107,115,255,0.35)] transition hover:brightness-110 ${
                    inCouple
                      ? 'border border-nebula-400/40 bg-nebula-500/20'
                      : 'bg-gradient-to-r from-nebula-500 to-nebula-700'
                  }`}
                >
                  {inCouple ? '✓ 已加入双星 · 点此移出' : '✦ 加入双星纪念'}
                </button>
              ) : (
                <button
                  onClick={openMemorial}
                  className="mt-5 w-full rounded-2xl bg-gradient-to-r from-nebula-500 to-nebula-700 py-3 text-[15px] font-medium text-white shadow-[0_8px_30px_rgba(107,115,255,0.35)] transition hover:brightness-110"
                >
                  为这颗星创建纪念命名
                </button>
              )
            ) : (
              // 不可命名（著名星 / DSO / 行星日月）：次级引导回命名池
              <button
                onClick={resetView}
                className="mt-5 w-full rounded-2xl border border-nebula-400/30 bg-white/[0.04] py-3 text-[15px] font-medium text-nebula-100 transition hover:bg-white/[0.08] hover:text-white"
              >
                ✦ 探索可命名的星空
              </button>
            )}
            <p className="mt-3 text-center text-[11px] leading-relaxed text-nebula-200/45">
              {!obj.isNamable && '著名天体与太阳系天体不开放纪念命名，仅供探索欣赏。'}
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
