'use client';

import {
  getEquatorial,
  getMoonPhase,
  isEphemerisUid,
  moonPhaseName,
  uidToBodyId,
} from '@star/astro-ephem';
import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { formatDistanceAu, primaryBadgeZh } from '@/lib/objectPresenter';
import { PLANET_ASSETS } from '@/lib/planetAssets';
import { getObjectByUid } from '@/lib/solarSystem';
import { useUniverse } from '@/lib/store';
import { PlanetViewer3D } from './PlanetViewer3D';

/** 1 AU（km），月地距离换算用。 */
const KM_PER_AU = 149597870.7;

/**
 * 行星 3D 全屏查看器模态（宇宙 V3-C）。
 *
 * 布局：桌面左侧大 Canvas（OrbitControls 拖拽/缩放）+ 右侧 320px 玻璃
 * 参数侧栏；移动端 Canvas 上 60vh、参数下滑区。关闭（✕ / Esc / 点遮罩）
 * 即卸载，R3F 自动释放 renderer/GL，纹理留在模块级 LRU 缓存。
 *
 * 切换选中到另一星历天体时保持打开、内容随 selectedUid 切换
 * （Canvas 无 key 不重挂，仅换纹理/材质）。
 *
 * 署名义务：底部小字「行星贴图 © Solar System Scope，CC-BY-4.0」。
 */
export function PlanetViewerModal() {
  const uid = useUniverse((s) => s.selectedUid);
  const observeTime = useUniverse((s) => s.observeTime);
  const close = useUniverse((s) => s.closePlanetViewer);
  const [hintVisible, setHintVisible] = useState(true);

  const obj = uid ? getObjectByUid(uid) : undefined;
  const asset = uid ? PLANET_ASSETS[uid] : undefined;

  // 实时星历（地心距离 + 月相）：低频（uid/observeTime 变化）计算
  const eph = useMemo(() => {
    if (!uid || !isEphemerisUid(uid)) return null;
    const date = new Date(observeTime ?? Date.now());
    const bodyId = uidToBodyId(uid);
    const eq = getEquatorial(bodyId, date);
    const moon = bodyId === 'moon' ? getMoonPhase(date) : null;
    return { bodyId, eq, moon };
  }, [uid, observeTime]);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  // 操作提示 3s 后淡出
  useEffect(() => {
    const id = window.setTimeout(() => setHintVisible(false), 3000);
    return () => window.clearTimeout(id);
  }, []);

  if (!uid || !obj || !asset || !eph) return null;

  // 月地距离用 km 更直观（AU 下只剩 0.00）
  const distText =
    eph.bodyId === 'moon'
      ? `${((eph.eq.distanceAu * KM_PER_AU) / 10000).toFixed(1)} 万 km`
      : formatDistanceAu(eph.eq.distanceAu);
  const badge = primaryBadgeZh(obj);

  return (
    <motion.div
      className="fixed inset-0 z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* 遮罩：点空白关闭 */}
      <div className="absolute inset-0 bg-void/80 backdrop-blur-md" onClick={close} />

      <div className="relative z-10 flex h-full w-full flex-col md:flex-row">
        {/* Canvas 区 */}
        <div className="relative h-[60vh] w-full md:h-full md:min-w-0 md:flex-1">
          <PlanetViewer3D uid={uid} variant="modal" observeTimeMs={observeTime} />

          {/* 操作提示（3s 淡出） */}
          <div
            className={`pointer-events-none absolute bottom-4 left-5 text-[12px] tracking-wide text-nebula-200/60 transition-opacity duration-700 ${
              hintVisible ? 'opacity-100' : 'opacity-0'
            }`}
          >
            拖拽旋转 · 滚轮缩放
          </div>
        </div>

        {/* 参数侧栏 */}
        <aside className="glass-strong relative min-h-0 flex-1 overflow-y-auto p-6 md:h-full md:w-[320px] md:flex-none md:rounded-none">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-white">{obj.nameZh}</h2>
              <div className="mt-1 text-[13px] tracking-wide text-nebula-200/70">{obj.nameEn}</div>
            </div>
            <button
              onClick={close}
              className="rounded-full border border-white/10 px-2 py-0.5 text-nebula-200/60 transition hover:bg-white/10 hover:text-white"
              aria-label="关闭 3D 查看器"
            >
              ✕
            </button>
          </div>

          {badge && (
            <div className="mt-3">
              <span className="rounded-full border border-nebula-400/25 bg-white/5 px-2.5 py-0.5 text-[12px] text-nebula-100">
                {badge}
              </span>
            </div>
          )}

          {obj.descriptionZh && (
            <p className="mt-4 text-[13.5px] leading-relaxed text-nebula-100/85">
              {obj.descriptionZh}
            </p>
          )}

          <div className="mt-5 grid grid-cols-2 gap-3">
            <FactCell label="赤道直径" value={`${asset.facts.diameterKm.toLocaleString('zh-CN')} km`} />
            <FactCell label="地心距离" value={distText} />
            <FactCell label="自转周期" value={asset.facts.rotationZh} />
            <FactCell label="公转周期" value={asset.facts.orbitZh} />
            {eph.moon && (
              <div className="col-span-2">
                <FactCell
                  label="当前月相"
                  value={`${moonPhaseName(eph.moon.phaseAngleDeg)} · 照亮 ${Math.round(eph.moon.illumination * 100)}%`}
                />
              </div>
            )}
          </div>

          <p className="mt-6 text-[11px] leading-relaxed text-nebula-200/45">
            行星贴图 © Solar System Scope（INOVE），CC-BY-4.0
            <br />
            太阳系天体不开放纪念命名，仅供探索欣赏。私人纪念命名登记，不代表 IAU
            或任何官方天文机构命名。
          </p>
        </aside>
      </div>
    </motion.div>
  );
}

function FactCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.03] px-3 py-2">
      <div className="text-[11px] text-nebula-200/50">{label}</div>
      <div className="mt-0.5 text-[14px] text-white">{value}</div>
    </div>
  );
}
