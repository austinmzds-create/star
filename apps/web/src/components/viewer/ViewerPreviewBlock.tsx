'use client';

import { useEffect, useRef, useState } from 'react';
import { getObjectByUid } from '@/lib/solarSystem';
import { deriveStarVisual, rgbToCss, type RGB } from '@/lib/starVisual';
import { useUniverse } from '@/lib/store';

/**
 * 卡内预览缩略块（跨域契约组件，另名 ObjectVisualThumb 导出）：
 * 对任何 uid 都渲染出内容，整块可点 → openObjectViewer(uid)。
 *
 * 分派（全 2D，零 GL、零新增常驻纹理）：
 *  - imageKey → 真实照片 <img>（失败降级程序化艺术图）；
 *  - 恒星 → 2D canvas 一次性绘制（kelvinToRGB 色三层光晕 + 4 芒，
 *    posterGenerator.drawStarGlow 缩版）；
 *  - 其余（DSO / 目录外 uid）→ 程序化艺术图 dataURL（2x retina 320px）。
 * 星历天体在信息卡走现有 PlanetPreviewCard，通常不到此；误传也能渲染
 * （艺术图兜底），点击经 openObjectViewer 转发到行星查看器。
 *
 * dsoArt 触 DOM：URL 生成放 useEffect（本组件可能被静态 import，须 SSR 安全）。
 */

/**
 * 照片大图 URL（与 dso-photos.ts / dso-lore.ts 同一资产路径；独立内联，
 * 不 import dso-lore——那边携带 ~12KB 长文，本组件进 StarInfoCard 同步 chunk）。
 */
function dsoPhotoUrl(imageKey: string): string {
  return `/dso-photos/${imageKey}.jpg`;
}
export function ViewerPreviewBlock({ uid }: { uid: string }) {
  const openObjectViewer = useUniverse((s) => s.openObjectViewer);
  const obj = getObjectByUid(uid);
  const [photoFailed, setPhotoFailed] = useState(false);
  // 换 uid 重置照片失败标记（避免上一张失败连带屏蔽下一张）
  useEffect(() => setPhotoFailed(false), [uid]);

  const isStar = obj?.type === 'star';
  const imageKey = !photoFailed ? obj?.imageKey : undefined;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openObjectViewer(uid)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') openObjectViewer(uid);
      }}
      className="group relative h-[150px] w-full cursor-pointer overflow-hidden rounded-2xl border border-white/10 bg-black/40 transition hover:border-nebula-400/40"
      aria-label="打开查看器看大图"
    >
      {imageKey ? (
        <img
          src={dsoPhotoUrl(imageKey)}
          alt={obj?.nameZh ?? uid}
          onError={() => setPhotoFailed(true)}
          draggable={false}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
        />
      ) : isStar && obj ? (
        <StarThumbCanvas uid={uid} />
      ) : (
        <DsoArtThumb uid={uid} alt={obj?.nameZh ?? uid} />
      )}

      {/* 角标（视觉引导；整块本就可点） */}
      <span className="pointer-events-none absolute bottom-2.5 right-3 rounded-full border border-white/15 bg-void/60 px-2.5 py-1 text-[12px] text-nebula-100/85 backdrop-blur-sm transition group-hover:bg-nebula-500/30 group-hover:text-white">
        查看大图 ⤢
      </span>
    </div>
  );
}

/** 程序化艺术图缩略：dataURL 在客户端 effect 生成（模块级缓存，同 uid 同图）。 */
function DsoArtThumb({ uid, alt }: { uid: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    // 懒 import：dsoArt（含 deriveDsoProfile 分类逻辑）不进卡片同步 chunk
    void import('@/lib/dsoArt').then((m) => {
      if (alive) setUrl(m.getDsoArtURL(uid, 320)); // 2x retina（显示 ~160px 高）
    });
    return () => {
      alive = false;
    };
  }, [uid]);

  if (!url) return <div className="h-full w-full bg-[#0a0d1f]" />;
  return <img src={url} alt={alt} draggable={false} className="h-full w-full object-cover" />;
}

/** 恒星缩略：2D canvas 一次性绘制三层光晕 + 4 芒星（零 GL）。 */
function StarThumbCanvas({ uid }: { uid: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const obj = getObjectByUid(uid);
    if (!obj) return;
    const visual = deriveStarVisual(obj);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 320;
    const h = canvas.clientHeight || 150;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    drawStarThumb(ctx, w, h, visual.rgb, visual.scale, uid);
  }, [uid]);

  return <canvas ref={ref} className="h-full w-full" />;
}

/** FNV-1a + mulberry32：缩略图星野的确定性种子（同 uid 同图）。 */
function mulberry32FromUid(uid: string): () => number {
  let hsh = 0x811c9dc5;
  for (let i = 0; i < uid.length; i++) {
    hsh ^= uid.charCodeAt(i);
    hsh = Math.imul(hsh, 0x01000193);
  }
  let a = hsh >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 深空底 + 缩量星野 + 三层光晕 + 4 芒（posterGenerator.drawStarGlow 缩版）。 */
function drawStarThumb(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rgb: RGB,
  scale: number,
  uid: string,
): void {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#05060f');
  bg.addColorStop(0.5, '#0a0d1f');
  bg.addColorStop(1, '#05060f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const rnd = mulberry32FromUid(uid);
  for (let i = 0; i < 50; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    ctx.fillStyle = `rgba(255,255,255,${(0.2 + rnd() * 0.5).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.3 + rnd() * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }

  const cx = w / 2;
  const cy = h / 2;
  // 光晕半径随恒星尺寸档位微调（0.4–1.8 → 0.62–1.0 倍基准）
  const R = Math.min(w, h) * 0.52 * (0.5 + scale * 0.28);

  // 4 芒（先画，压在光晕之下）
  ctx.save();
  ctx.translate(cx, cy);
  for (let i = 0; i < 2; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI) / 2 + Math.PI / 4);
    const len = R * 1.7;
    const g = ctx.createLinearGradient(-len, 0, len, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, rgbToCss(rgb, 0.5));
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-len, -1, len * 2, 2);
    ctx.restore();
  }
  ctx.restore();

  // 三层光晕：核心白 → 恒星色晕 → 透明
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  glow.addColorStop(0, 'rgba(255,255,255,0.98)');
  glow.addColorStop(0.18, 'rgba(255,255,255,0.9)');
  glow.addColorStop(0.75, rgbToCss(rgb, 0.22));
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
}
