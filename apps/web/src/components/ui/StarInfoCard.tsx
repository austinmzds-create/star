'use client';

import { computeObservationSummary, computeVisibility } from '@star/astro-core';
import {
  computeBodyRiseSet,
  computeCometTailGeometry,
  getEquatorial,
  getMinorBodyElements,
  getMinorBodyEquatorialByUid,
  getMoonPhase,
  isEphemerisUid,
  isMinorBodyUid,
  minorUidToId,
  moonPhaseName,
  uidToBodyId,
} from '@star/astro-ephem';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { StarArchiveSection } from './StarArchiveSection';
import { exits, springs, stagger } from '@/lib/motionTokens';
import { ObjectVisualThumb } from '@/components/viewer/ObjectVisualThumb';
import { CITIES, type City } from '@/lib/cities';
import { isSatelliteUid } from '@/lib/satellites/tles';
import { formatBeijingTime, formatDec, formatDistance, formatRA } from '@/lib/format';
import { formatDistanceAu, kindLabelZh, primaryBadgeZh } from '@/lib/objectPresenter';
import { getObjectByUid } from '@/lib/solarSystem';
import { useUniverse } from '@/lib/store';

// 深空科普长文 + lightbox：仅选中带照片的 DSO 才拉取（16 篇长文不进主页首包）
const DsoLoreSection = dynamic(() => import('./DsoLoreSection').then((m) => m.DsoLoreSection), {
  ssr: false,
  loading: () => null,
});

// 行星 3D 预览块：选中星历天体才拉取 three/R3F 代码块（不进主 bundle 增量）
const PlanetPreviewCard = dynamic(
  () => import('@/components/planet3d/PlanetPreviewCard').then((m) => m.PlanetPreviewCard),
  {
    ssr: false,
    loading: () => <div className="mt-4 h-[220px] animate-pulse rounded-2xl bg-white/[0.04]" />,
  },
);

/** 卫星实时快照（satRegistry 在懒 chunk 里，动态 import 取值）。 */
interface SatSnapshot {
  raDeg: number;
  decDeg: number;
  rangeKm: number;
  heightKm: number;
  speedKmS: number;
  tleEpoch: Date | null;
}

/**
 * 卫星实时坐标 hook：satRegistry 只在卫星层的异步 chunk 内——层已开时模块
 * 必已加载（Promise 微任务即回）；层未开时顺带把 chunk 拉起来。
 * 实时模式下 1s 心跳刷新（LEO 卫星 ~1°/s，静态值会迅速失真）；
 * 未就绪时返回 null，坐标区显示占位。
 */
function useSatSnapshot(
  uid: string | null,
  observeTime: number | null,
  city: City,
): SatSnapshot | null {
  const [snap, setSnap] = useState<SatSnapshot | null>(null);
  useEffect(() => {
    if (!uid) {
      setSnap(null);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    void import('@/lib/satellites/satRegistry')
      .then((m) => {
        if (cancelled) return;
        const update = () => {
          const s = useUniverse.getState();
          const simMs = s.timeFollowsNow ? Date.now() : (s.observeTime ?? Date.now());
          m.recomputeSatellites(simMs, s.city);
          const st = m.sats.states.get(uid);
          setSnap(
            st && st.valid
              ? {
                  raDeg: st.raDeg,
                  decDeg: st.decDeg,
                  rangeKm: st.rangeKm,
                  heightKm: st.heightKm,
                  speedKmS: st.speedKmS,
                  tleEpoch: st.tleEpoch,
                }
              : null,
          );
        };
        update();
        timer = window.setInterval(update, 1000);
      })
      .catch(() => {
        if (!cancelled) setSnap(null);
      });
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [uid, observeTime, city]);
  return snap;
}

/**
 * 天体信息卡（按类型泛化）：
 *  - 恒星：光谱/距离/坐标/今晚可见性/命名 CTA（isNamable 才显示）；
 *  - 深空天体（星系/星云/星团）：类型徽章 + 简介 + 固定坐标可见性；
 *  - 行星/日月：坐标与距离（AU）按 observeTime 实时计算，月亮加月相行；
 *  - 人造卫星（SAT-）：站心实时坐标 + 轨道高度/速度/TLE 历元，「演示精度」；
 *  - 小天体（MB-）：开普勒轨道实时坐标 + 轨道要素/距离，「演示级 ±0.5°」。
 *
 * 合规：不可命名天体（DSO/行星/日月/卫星/小天体/著名星）不显示命名 CTA，
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

  const isSatellite = obj ? isSatelliteUid(obj.objectUid) : false;
  // 卫星实时坐标（懒 chunk 动态取，未就绪时 null → 坐标区占位）
  const sat = useSatSnapshot(isSatellite && obj ? obj.objectUid : null, observeTime, city);

  // 「今日 升/落/中天」（Phase 9B §3e-5）：仅太阳/月亮/行星显示。
  // 日界取北京时区（全站时间展示统一北京时间）当日 00:00；dayStart 是
  // 从 observeTime 折算的整数，只在跨日时变化——播放期 4Hz 写 observeTime
  // 也不会高频触发 SearchRiseSet（单体 3 次搜索 ~几 ms）。
  const riseSetDayStartMs = Math.floor(((observeTime ?? Date.now()) + 8 * 3_600_000) / 86_400_000) * 86_400_000 - 8 * 3_600_000;
  const ephBodyId = eph?.bodyId ?? null;
  const riseSet = useMemo(() => {
    if (!ephBodyId) return null;
    try {
      return computeBodyRiseSet(ephBodyId, riseSetDayStartMs, city.latitudeDeg, city.longitudeDeg);
    } catch {
      return null; // astronomy-engine 极端参数异常时静默隐藏该行
    }
  }, [ephBodyId, riseSetDayStartMs, city]);

  // 小天体（MB-）：开普勒轨道同步计算（engine 已在依赖里，成本为零）
  const minorInfo = useMemo(() => {
    if (!obj || !isMinorBodyUid(obj.objectUid)) return null;
    const date = new Date(observeTime ?? Date.now());
    const eq = getMinorBodyEquatorialByUid(obj.objectUid, date);
    const el = getMinorBodyElements(minorUidToId(obj.objectUid));
    return { eq, el };
  }, [obj, observeTime]);

  // 展示与可见性统一用「当前坐标」级联：星历 → 卫星 → 小天体 → 目录静态值。
  // 卫星未就绪时为 null（占位），绝不回落到占位 0 的目录行坐标。
  const coords = eph
    ? { raDeg: eph.eq.raDeg, decDeg: eph.eq.decDeg }
    : isSatellite
      ? sat && { raDeg: sat.raDeg, decDeg: sat.decDeg }
      : minorInfo
        ? { raDeg: minorInfo.eq.raDeg, decDeg: minorInfo.eq.decDeg }
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
    // coords 由 obj/eph/sat/minorInfo 派生，依赖已覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obj, eph, sat, minorInfo, city, observeTime]);

  const isStar = obj?.type === 'star';
  const badge = obj ? primaryBadgeZh(obj) : null;

  // 彗尾徽章（Phase 9B）：与 CometTailLayer 同一纯函数按同一 1h 量化键推导
  // （视角长+亮度双阈值，演示级）。刻意不读 minorRegistry.tailVisible——
  // 该旗标由懒 chunk 的层在挂载后写入，而本卡只随 store 变化重渲染，
  // 深链/暂停态（timeFollowsNow=false，observeTime 不再变）下会读到写入前
  // 的旧值漏亮徽章。非彗星 computeCometTailGeometry 返回 null，恒 false。
  const tailQuantKey = Math.floor((observeTime ?? Date.now()) / 3_600_000);
  const tailVisible = useMemo(() => {
    if (!obj || !isMinorBodyUid(obj.objectUid)) return false;
    try {
      const g = computeCometTailGeometry(
        minorUidToId(obj.objectUid),
        new Date(tailQuantKey * 3_600_000),
      );
      return g?.visible ?? false;
    } catch {
      return false; // 极端历元下星历异常时静默隐藏徽章
    }
  }, [obj, tailQuantKey]);

  // ── 入场动画（Phase 7 → 9A tokens 化）：卡片 spring 弹出 + 分区 stagger。
  // reduced-motion 由全局 MotionConfig reducedMotion="user" 统一接管
  // （x/scale/y 位移自动禁用，opacity 保留），不再逐组件判断。──
  const cardVariants: Variants = {
    hidden: { opacity: 0, x: 56, scale: 0.9 },
    show: {
      opacity: 1,
      x: 0,
      scale: 1,
      transition: {
        ...springs.modal,
        when: 'beforeChildren',
        staggerChildren: stagger.item,
        delayChildren: 0.05,
      },
    },
    exit: { opacity: 0, x: 28, scale: 0.96, transition: exits.base },
  };
  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 14 },
    show: { opacity: 1, y: 0, transition: springs.chip },
  };

  // ── 分享海报（Phase 6B 目标 5）：posterGenerator 动态 chunk，点击才加载 ──
  const [posterBusy, setPosterBusy] = useState(false);
  const [posterError, setPosterError] = useState(false);
  async function onSharePoster() {
    if (!obj || !coords || posterBusy) return;
    setPosterBusy(true);
    setPosterError(false);
    try {
      const { generatePoster, downloadBlob } = await import('@/lib/posterGenerator');
      const dateMs = observeTime ?? Date.now();
      const blob = await generatePoster({ obj, coords, cityName: city.name, dateMs });
      const d = new Date(dateMs);
      const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      downloadBlob(blob, `星辰纪念-${obj.objectUid}-${ymd}.png`);
    } catch {
      setPosterError(true);
    } finally {
      setPosterBusy(false);
    }
  }

  // 定位两层化（Phase 8）：外层纯 CSS flex 居中容器常驻挂载、不参与动画——
  // framer-motion 会整体接管 motion 元素的 style.transform（x/scale），若定位层
  // 自己带 -translate-y-1/2 会被覆盖导致卡片下坠半屏，故定位与动画必须分层。
  // 外层 pointer-events-none 保证空载时对 canvas 零干扰；max-h 用 dvh 修移动端
  // 地址栏抖动，-7rem 给底部 ControlBar（bottom-6 + 栏高≈4.5rem）与顶部留白。
  return (
    <div className="pointer-events-none absolute inset-y-0 right-5 z-30 flex w-[min(92vw,360px)] items-center">
      <AnimatePresence>
        {obj && (
          <motion.aside
            key={obj.objectUid}
            variants={cardVariants}
            initial="hidden"
            animate="show"
            exit="exit"
            className="pointer-events-auto w-full"
          >
            <div className="glass-strong card-scroll max-h-[min(82dvh,calc(100dvh-7rem))] overflow-y-auto overscroll-contain rounded-3xl p-6">
              <motion.div variants={itemVariants} className="flex items-start justify-between">
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
              </motion.div>

              <motion.div variants={itemVariants} className="mt-3 flex flex-wrap gap-2">
                {badge && <Badge>{badge}</Badge>}
                {/* 远日点示意徽章与彗尾徽章互斥：时间机器拨回近日点段（如 1986）
                  时彗尾可见，「远日点附近」的常态描述不再成立 */}
                {obj.objectUid === 'MB-HALLEY' && !tailVisible && <Badge>远日点附近 · 示意</Badge>}
                {tailVisible && <Badge>彗尾可见 · 演示级</Badge>}
                {minorInfo && <Badge>演示级 ±0.5°</Badge>}
                {!eph && <Badge>{obj.constellationZh}</Badge>}
                {isStar && obj.spectralType && <Badge>{obj.spectralType}</Badge>}
                {/* 卫星星等随过境几何剧烈变化，目录值仅为占位，不展示 */}
                {!isSatellite && <Badge>视星等 {obj.magnitude.toFixed(2)}</Badge>}
              </motion.div>

              {obj.descriptionZh && (
                <motion.p
                  variants={itemVariants}
                  className="mt-4 text-[13.5px] leading-relaxed text-nebula-100/85"
                >
                  {obj.descriptionZh}
                </motion.p>
              )}

              {/* 可视化缩略块（Phase 8）：所有天体的统一预览入口，点击进全屏查看器。
                有 imageKey（真实照片富组件）或 isEphemeris（PlanetPreviewCard 3D）
                的天体保留原有富组件，不再叠加缩略块，避免同卡出现两个预览。 */}
              {!obj.imageKey && !obj.isEphemeris && (
                <motion.div variants={itemVariants} className="mt-4">
                  <ObjectVisualThumb uid={obj.objectUid} />
                </motion.div>
              )}

              {/* 著名 Messier：科普长文「了解更多」+ 照片 lightbox（仅 16 个带 imageKey+长文的天体） */}
              {obj.imageKey && (
                <motion.div variants={itemVariants}>
                  <DsoLoreSection
                    uid={obj.objectUid}
                    nameZh={obj.nameZh}
                    imageKey={obj.imageKey}
                    imageCredit={obj.imageCredit}
                  />
                </motion.div>
              )}

              {obj.isEphemeris && (
                <motion.div variants={itemVariants}>
                  <PlanetPreviewCard uid={obj.objectUid} />
                </motion.div>
              )}

              <motion.div variants={itemVariants} className="mt-4 grid grid-cols-2 gap-3">
                {eph ? (
                  <Fact label="地心距离" value={formatDistanceAu(eph.eq.distanceAu)} />
                ) : isSatellite ? (
                  <Fact
                    label="站心距离"
                    value={sat ? `${Math.round(sat.rangeKm).toLocaleString()} km` : '—'}
                  />
                ) : minorInfo ? (
                  <Fact label="地心距离" value={formatDistanceAu(minorInfo.eq.distanceAu)} />
                ) : (
                  <Fact label="距离" value={formatDistance(obj.distanceLy)} />
                )}
                {eph || isSatellite || minorInfo ? (
                  <Fact label="类型" value={kindLabelZh(obj)} />
                ) : (
                  <Fact label="星座" value={obj.constellationZh} />
                )}
                <Fact label="赤经 RA" value={coords ? formatRA(coords.raDeg) : '—'} />
                <Fact label="赤纬 Dec" value={coords ? formatDec(coords.decDeg) : '—'} />
                {eph?.moon && (
                  <Fact
                    label="月相"
                    value={`${moonPhaseName(eph.moon.phaseAngleDeg)} · 照亮 ${Math.round(eph.moon.illumination * 100)}%`}
                  />
                )}
                {isSatellite && (
                  <>
                    <Fact label="轨道高度" value={sat ? `~${Math.round(sat.heightKm)} km` : '—'} />
                    <Fact label="速度" value={sat ? `${sat.speedKmS.toFixed(1)} km/s` : '—'} />
                    <Fact
                      label="TLE 历元"
                      value={sat?.tleEpoch ? sat.tleEpoch.toISOString().slice(0, 10) : '—'}
                    />
                  </>
                )}
                {minorInfo && (
                  <>
                    <Fact label="日心距离" value={formatDistanceAu(minorInfo.eq.helioDistanceAu)} />
                    <Fact
                      label="轨道要素"
                      value={`a ${minorInfo.el.aAu.toFixed(2)} AU · e ${minorInfo.el.e.toFixed(3)} · i ${minorInfo.el.iDeg.toFixed(1)}°`}
                    />
                    <Fact label="根数历元" value={`JD ${minorInfo.el.epochJd.toFixed(1)}`} />
                  </>
                )}
              </motion.div>

              {/* 天体档案：仅带光谱型与距离的恒星（估算依据齐备才展示，DSO/太阳系不套用） */}
              {isStar && obj.spectralType && obj.distanceLy != null && (
                <StarArchiveSection obj={obj} itemVariants={itemVariants} />
              )}

              {visibility && (
                <motion.div
                  variants={itemVariants}
                  className="mt-5 rounded-2xl border border-nebula-400/15 bg-white/[0.03] p-4"
                >
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

                  {isSatellite ? (
                    // 卫星 90 分钟绕地一周，「过中天/永不升起」语义失效：只显此刻方位
                    <div className="space-y-2 text-[13px] text-nebula-100/85">
                      <VisRow
                        label="此刻"
                        value={
                          visibility.snapshot.isAboveHorizon
                            ? `地平线上 · ${visibility.snapshot.direction.zh} · 高度 ${visibility.snapshot.horizontal.altitudeDeg.toFixed(0)}°`
                            : '在地平线以下'
                        }
                      />
                    </div>
                  ) : visibility.summary.neverRises ? (
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
                      {/* 太阳/月亮/行星：当日升/落/中天（Phase 9B §3e-5，SearchRiseSet
                        精确搜索，北京时间；「—」= 当日无该事件，如极昼极夜/月亮缺日） */}
                      {riseSet ? (
                        <VisRow
                          label="今日"
                          value={`升 ${riseSet.riseMs ? formatBeijingTime(new Date(riseSet.riseMs)) : '—'} · 落 ${riseSet.setMs ? formatBeijingTime(new Date(riseSet.setMs)) : '—'} · 中天 ${riseSet.transitMs ? formatBeijingTime(new Date(riseSet.transitMs)) : '—'}`}
                        />
                      ) : (
                        <VisRow
                          label="过中天"
                          value={`${formatBeijingTime(visibility.summary.nextTransit)} 前后 · 最高 ${visibility.summary.maxAltitudeDeg.toFixed(0)}°`}
                        />
                      )}
                      {visibility.summary.isCircumpolar && (
                        <VisRow label="特性" value="拱极星 · 全天不落" />
                      )}
                    </div>
                  )}
                </motion.div>
              )}

              <motion.div variants={itemVariants}>
                {obj.isNamable ? (
                  coupleMode ? (
                    <motion.button
                      whileTap={{ scale: 0.96 }}
                      transition={springs.chip}
                      onClick={() => addStarToCouple(obj.objectUid)}
                      className={`tap-96 mt-5 w-full rounded-2xl py-3 text-[15px] font-medium text-white shadow-[0_8px_30px_rgba(107,115,255,0.35)] transition hover:brightness-110 ${
                        inCouple
                          ? 'border border-nebula-400/40 bg-nebula-500/20'
                          : 'bg-gradient-to-r from-nebula-500 to-nebula-700'
                      }`}
                    >
                      {inCouple ? '✓ 已加入双星 · 点此移出' : '✦ 加入双星纪念'}
                    </motion.button>
                  ) : (
                    <motion.button
                      whileTap={{ scale: 0.96 }}
                      transition={springs.chip}
                      onClick={openMemorial}
                      className="tap-96 mt-5 w-full rounded-2xl bg-gradient-to-r from-nebula-500 to-nebula-700 py-3 text-[15px] font-medium text-white shadow-[0_8px_30px_rgba(107,115,255,0.35)] transition hover:brightness-110"
                    >
                      为这颗星创建纪念命名
                    </motion.button>
                  )
                ) : (
                  // 不可命名（著名星 / DSO / 行星日月）：次级引导回命名池
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    transition={springs.chip}
                    onClick={resetView}
                    className="tap-96 mt-5 w-full rounded-2xl border border-nebula-400/30 bg-white/[0.04] py-3 text-[15px] font-medium text-nebula-100 transition hover:bg-white/[0.08] hover:text-white"
                  >
                    ✦ 探索可命名的星空
                  </motion.button>
                )}
                {/* 分享海报：纯欣赏动作，可命名与否都显示；坐标未就绪（卫星懒 chunk）时禁用 */}
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  transition={springs.chip}
                  onClick={() => void onSharePoster()}
                  disabled={posterBusy || !coords}
                  className="tap-96 mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.03] py-2.5 text-[13px] text-nebula-100/85 transition hover:bg-white/[0.08] disabled:opacity-50"
                >
                  {posterBusy ? '正在绘制海报…' : '⤓ 生成分享海报'}
                </motion.button>
                {posterError && (
                  <p className="mt-1.5 text-center text-[11px] text-red-300/80">
                    海报生成失败，请重试
                  </p>
                )}
                <p className="mt-3 text-center text-[11px] leading-relaxed text-nebula-200/45">
                  {isSatellite && '人造卫星位置由 TLE 推算，为近似演示；'}
                  {minorInfo && '小天体位置按 JPL 轨道根数以二体模型推算，演示精度约 ±0.5°；'}
                  {!obj.isNamable && '著名天体与太阳系天体不开放纪念命名，仅供探索欣赏。'}
                  私人纪念命名登记，不代表 IAU 或任何官方天文机构命名
                </p>
              </motion.div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
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
