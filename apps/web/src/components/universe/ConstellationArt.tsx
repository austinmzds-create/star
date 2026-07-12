'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { raDecToVector3 } from '@star/astro-core';
import { constellationArtUrl, type ConstellationArtMeta } from '@/lib/constellation-art';
import { ART_RADIUS, type ConstellationRenderInfo } from '@/lib/constellation-render';

/**
 * 星座艺术图：自绘 SVG 发光线稿 → CanvasTexture → 切平面 Mesh。
 * 不用 billboard Sprite——切平面 lookAt 球心 + rollDeg 把形象「锚死」在
 * 天球姿态上，随视角转动不漂移。renderOrder=1.5 画在恒星层之下，
 * 加色混合下星点永远压过艺术图。
 */

// ── SVG 栅格化 + LRU 纹理缓存 ──

interface ArtCacheEntry {
  texture: THREE.CanvasTexture;
}

const artCache = new Map<string, Promise<ArtCacheEntry>>();

function loadArtTexture(abbr: string, size: number, cacheLimit: number): Promise<ArtCacheEntry> {
  const key = `${abbr}@${size}`;
  const hit = artCache.get(key);
  if (hit) {
    artCache.delete(key);
    artCache.set(key, hit); // LRU：命中移到队尾
    return hit;
  }

  const promise = new Promise<ArtCacheEntry>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // 必须经 canvas：直接用 SVG img 建纹理在部分浏览器尺寸解析不稳。
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      // 水平翻转：切平面 lookAt 球心后其正面朝外，球心内的相机看到的是
      // 背面（左右镜像）；此处预翻一次，让 SVG 以作画方向（RA+ 向左、
      // Dec+ 向上的观星视角）呈现，星点对位才成立。
      ctx.translate(size, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, size, size);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      resolve({ texture });
    };
    img.onerror = () => reject(new Error(`constellation art load failed: ${abbr}`));
    img.src = constellationArtUrl(abbr);
  });

  artCache.set(key, promise);
  // 逐出最旧（仅当加载成功后 dispose，避免撕裂在途 Promise 的消费者）。
  if (artCache.size > cacheLimit) {
    const oldestKey = artCache.keys().next().value as string | undefined;
    if (oldestKey !== undefined && oldestKey !== key) {
      const evicted = artCache.get(oldestKey);
      artCache.delete(oldestKey);
      evicted?.then((e) => e.texture.dispose()).catch(() => undefined);
    }
  }
  // 加载失败从缓存移除，允许下次重试。
  promise.catch(() => artCache.delete(key));
  return promise;
}

interface ConstellationArtPlaneProps {
  info: ConstellationRenderInfo;
  meta: ConstellationArtMeta;
  progressRef: React.MutableRefObject<Float32Array>;
  /** 粗指针（移动端）：512² 纹理、透明度上限 0.28、缓存上限 2。 */
  coarse: boolean;
}

export function ConstellationArtPlane({ info, meta, progressRef, coarse }: ConstellationArtPlaneProps) {
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  // 懒加载：本组件仅在该座激活（progress>0）时被挂载，即「首次激活才 fetch」。
  useEffect(() => {
    let alive = true;
    loadArtTexture(meta.con, coarse ? 512 : 1024, coarse ? 2 : 6)
      .then((entry) => {
        if (alive) setTexture(entry.texture);
      })
      .catch(() => undefined); // 加载失败静默降级为「只有连线 + 名称」
    return () => {
      alive = false;
    };
  }, [meta, coarse]);

  // 天球锚定：切平面朝向球心（相机），rollDeg 对齐星点走向。
  const { position, quaternion, scale } = useMemo(() => {
    const v = raDecToVector3({ raDeg: meta.raDeg, decDeg: meta.decDeg }, ART_RADIUS);
    const dummy = new THREE.Object3D();
    dummy.position.set(v.x, v.y, v.z);
    dummy.lookAt(0, 0, 0);
    dummy.rotateZ(THREE.MathUtils.degToRad(meta.rollDeg));
    const w = 2 * ART_RADIUS * Math.tan(THREE.MathUtils.degToRad(meta.sizeDeg / 2));
    return {
      position: dummy.position.clone(),
      quaternion: dummy.quaternion.clone(),
      scale: new THREE.Vector3(w, w / meta.aspect, 1),
    };
  }, [meta]);

  const maxOpacity = coarse ? 0.28 : 0.35;

  useFrame(() => {
    const mat = materialRef.current;
    if (!mat) return;
    const p = progressRef.current[info.index] ?? 0;
    // 比连线慢半拍淡入（p>0.25 起），失活随 p 回落。
    const ease = THREE.MathUtils.smoothstep(p, 0.25, 1.0);
    mat.opacity = ease * maxOpacity;
    // 缩放渐显：随进度从 90% 缓推到全尺寸（绕自身中心，天球锚定不变）。
    const mesh = meshRef.current;
    if (mesh) {
      const s = 0.9 + 0.1 * ease;
      mesh.scale.set(scale.x * s, scale.y * s, 1);
    }
  });

  if (!texture) return null;

  return (
    <mesh
      ref={meshRef}
      position={position}
      quaternion={quaternion}
      scale={scale}
      renderOrder={1.5}
      frustumCulled={false}
    >
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        ref={materialRef}
        map={texture}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        side={THREE.DoubleSide}
        opacity={0}
      />
    </mesh>
  );
}
