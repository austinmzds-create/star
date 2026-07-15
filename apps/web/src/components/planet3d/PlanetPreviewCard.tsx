'use client';

import { useMemo, useState } from 'react';
import { getDeviceTier } from '@/lib/deviceTier';
import { PLANET_ASSETS } from '@/lib/planetAssets';
import { useUniverse } from '@/lib/store';
import { PlanetViewer3D } from './PlanetViewer3D';

/**
 * 信息卡内嵌 220px 行星 3D 预览块（宇宙 V3-C）。
 *
 * 整块可点击 → openPlanetViewer() 打开全屏模态。以下情形不渲染 Canvas，
 * 退化为静态占位渐变（仍可点击打开模态）：
 *  1. deviceTier low —— 避免双 GL 上下文压低端机；
 *  2. planetViewerOpen —— modal 打开时卸载 inline，保证任意时刻 ≤2 个
 *     GL 上下文（主场景 + 一个查看器）；
 *  3. WebGL 上下文创建失败。
 *
 * 本组件由 StarInfoCard 经 next/dynamic(ssr:false) 懒加载：
 * 选中星历天体才拉取 three/R3F 代码块，不进主 bundle。
 */
export function PlanetPreviewCard({ uid }: { uid: string }) {
  const observeTime = useUniverse((s) => s.observeTime);
  const planetViewerOpen = useUniverse((s) => s.planetViewerOpen);
  const openPlanetViewer = useUniverse((s) => s.openPlanetViewer);
  const [glFailed, setGlFailed] = useState(false);
  // 分档一次性判定（会话内不变）
  const tier = useMemo(() => getDeviceTier(), []);

  const asset = PLANET_ASSETS[uid];
  if (!asset) return null;

  const showCanvas = tier !== 'low' && !planetViewerOpen && !glFailed;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openPlanetViewer}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') openPlanetViewer();
      }}
      className="group relative mt-4 h-[220px] cursor-pointer overflow-hidden rounded-2xl border border-white/10 bg-black/40 transition hover:border-nebula-400/40"
      aria-label="打开 3D 查看器"
    >
      {showCanvas ? (
        <PlanetViewer3D
          uid={uid}
          variant="inline"
          observeTimeMs={observeTime}
          onGlError={() => setGlFailed(true)}
        />
      ) : (
        // 静态占位：主色径向渐变示意球
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(circle at 50% 46%, ${asset.fallbackColor}aa 0%, ${asset.fallbackColor}33 34%, transparent 62%)`,
          }}
        />
      )}

      {/* 查看 3D 按钮（视觉引导；整块本就可点） */}
      <span className="pointer-events-none absolute bottom-2.5 right-3 rounded-full border border-white/15 bg-void/60 px-2.5 py-1 text-[12px] text-nebula-100/85 backdrop-blur-sm transition group-hover:bg-nebula-500/30 group-hover:text-white">
        查看 3D ⤢
      </span>
    </div>
  );
}
