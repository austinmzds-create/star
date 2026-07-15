'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { NAME_RADIUS, type ConstellationRenderInfo } from '@/lib/constellation-render';

/**
 * 星座中文名 CanvasTexture Sprite（不用 DOM——与加色场景合成更融洽，
 * 且无重投影迟滞）。透明度随该座点亮进度 p 淡入：p>0.35 起浮现（先线后名）。
 */

// ── 纹理工厂 + LRU 缓存（上限 8，超出 dispose 最旧） ──

const TEX_W = 1024;
const TEX_H = 288;
const CACHE_LIMIT = 8;
const textureCache = new Map<string, THREE.CanvasTexture>();

function makeNameTexture(zh: string, en: string): THREE.CanvasTexture {
  const cached = textureCache.get(zh);
  if (cached) {
    // LRU：命中移到队尾。
    textureCache.delete(zh);
    textureCache.set(zh, cached);
    return cached;
  }

  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 中文名：先带辉光画 2 遍，再画实体。
  ctx.font = '600 150px "Noto Sans SC", system-ui, sans-serif';
  ctx.shadowColor = 'rgba(140, 200, 255, 0.9)';
  ctx.shadowBlur = 28;
  ctx.fillStyle = '#eaf4ff';
  ctx.fillText(zh, TEX_W / 2, 118);
  ctx.fillText(zh, TEX_W / 2, 118);
  ctx.shadowBlur = 0;
  ctx.fillText(zh, TEX_W / 2, 118);

  // 拉丁名：小号、疏排、半透明。
  ctx.font = '300 52px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(214, 230, 255, 0.55)';
  try {
    // letterSpacing 为较新的 Canvas 属性，不支持的浏览器静默跳过。
    (ctx as unknown as { letterSpacing?: string }).letterSpacing = '0.3em';
  } catch {
    /* noop */
  }
  ctx.fillText(en.toUpperCase(), TEX_W / 2, 236);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  textureCache.set(zh, texture);
  if (textureCache.size > CACHE_LIMIT) {
    const oldest = textureCache.keys().next().value as string | undefined;
    if (oldest !== undefined) {
      textureCache.get(oldest)?.dispose();
      textureCache.delete(oldest);
    }
  }
  return texture;
}

interface ConstellationNameProps {
  info: ConstellationRenderInfo;
  progressRef: React.MutableRefObject<Float32Array>;
}

export function ConstellationName({ info, progressRef }: ConstellationNameProps) {
  const materialRef = useRef<THREE.SpriteMaterial>(null);
  const texture = useMemo(() => makeNameTexture(info.nameZh, info.nameEn), [info]);

  // 固定角尺寸 ≈10° 宽：随 FOV 自然缩放，无需逐帧调整。
  const { position, scale } = useMemo(() => {
    const pos = info.centroid.clone().multiplyScalar(NAME_RADIUS);
    const width = 2 * NAME_RADIUS * Math.tan(THREE.MathUtils.degToRad(5));
    const height = width * (TEX_H / TEX_W);
    return { position: pos, scale: new THREE.Vector3(width, height, 1) };
  }, [info]);

  useFrame(() => {
    const mat = materialRef.current;
    if (!mat) return;
    const p = progressRef.current[info.index] ?? 0;
    // 线亮到 1/3 后名字才浮现（层次感）；淡出随 p 回落。
    mat.opacity = THREE.MathUtils.smoothstep(p, 0.35, 1.0) * 0.9;
  });

  return (
    <sprite position={position} scale={scale} renderOrder={4} frustumCulled={false}>
      <spriteMaterial
        ref={materialRef}
        map={texture}
        transparent
        depthWrite={false}
        opacity={0}
      />
    </sprite>
  );
}
