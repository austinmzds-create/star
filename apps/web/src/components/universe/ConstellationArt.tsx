'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { raDecToVector3 } from '@star/astro-core';
import { constellationArtUrl, type ConstellationArtMeta } from '@/lib/constellation-art';
import { ART_RADIUS, type ConstellationRenderInfo } from '@/lib/constellation-render';

/**
 * 星座艺术图（Phase 10 §2 提亮升级）：自绘 SVG 发光线稿 → CanvasTexture →
 * 切平面 Mesh，锚死在天球姿态上随视角转动不漂移。
 *
 * 核心修复：旧版 peak opacity 仅 0.28–0.35 且纯加色，贴亮星区≈隐形（等于没画）。
 * 现依赖 §3 全局压暗腾出空间，提亮到 0.5/0.62，并叠：
 * - facet shimmer（琉璃流光）；聚焦一发 sheen sweep（亮带横扫一次）；
 * - 桌面额外一层 NormalBlending 深色底（renderOrder 1.45），压出形体「实体感」。
 * reduced-motion 关 shimmer/sheen；coarse（移动）只留加色单层。
 * 形象为原创 CC0 SVG（意象叠加，非影像），归「非真实影像」类，不触合规红线。
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

// ── 发光层 shader：加色 + facet shimmer + 聚焦 sheen sweep ──

const GLOW_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GLOW_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uFocusIn;    // 聚焦以来秒数（sheen 用；>~1.2 消失）
  uniform float uShimmer;    // 闪面开关（reduced-motion 为 0）
  varying vec2 vUv;
  void main() {
    vec4 t = texture2D(uMap, vUv);
    float shimmer = 1.0 + uShimmer * (-0.15 + 0.15 * sin(uTime * 0.6 + vUv.x * 8.0));
    // 聚焦一发 sheen：一道亮带横扫（0.1 宽），focusIn 推进后消失。
    float dd = vUv.x - uFocusIn * 1.3;
    float sheen = smoothstep(0.0, 0.1, dd) * smoothstep(0.2, 0.1, dd) * step(uFocusIn, 1.2);
    vec3 col = t.rgb + vec3(0.9, 0.95, 1.0) * sheen * t.a;
    float a = t.a * uOpacity * shimmer + sheen * t.a * 0.5;
    gl_FragColor = vec4(col, a);
  }
`;

// ── 底层 shader：NormalBlending 深色填充，压出形体轮廓（桌面专属） ──

const BODY_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    vec4 t = texture2D(uMap, vUv);
    gl_FragColor = vec4(vec3(0.04, 0.06, 0.12), t.a * uOpacity);
  }
`;

interface ConstellationArtPlaneProps {
  info: ConstellationRenderInfo;
  meta: ConstellationArtMeta;
  progressRef: React.MutableRefObject<Float32Array>;
  /** 粗指针（移动端）：512² 纹理、透明度上限 0.5、缓存上限 2、无底层。 */
  coarse: boolean;
  /** reduced-motion：冻结 shimmer/sheen。 */
  reducedMotion: boolean;
}

export function ConstellationArtPlane({
  info,
  meta,
  progressRef,
  coarse,
  reducedMotion,
}: ConstellationArtPlaneProps) {
  const glowRef = useRef<THREE.ShaderMaterial>(null);
  const bodyRef = useRef<THREE.ShaderMaterial>(null);
  const groupRef = useRef<THREE.Group>(null);
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const focusInSec = useRef(0);

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

  // 天球锚定：优先手调 meta（已校准 20 座），缺失回退 §2.2 包围盒自动锚点。
  const { position, quaternion, scale } = useMemo(() => {
    const hasMeta = Number.isFinite(meta.raDeg) && Number.isFinite(meta.sizeDeg);
    const anchor = hasMeta
      ? raDecToVector3({ raDeg: meta.raDeg, decDeg: meta.decDeg }, ART_RADIUS)
      : {
          x: info.artAnchor.x * ART_RADIUS,
          y: info.artAnchor.y * ART_RADIUS,
          z: info.artAnchor.z * ART_RADIUS,
        };
    const sizeDeg = hasMeta ? meta.sizeDeg : info.artSizeDeg;
    const rollDeg = hasMeta ? meta.rollDeg : info.artRollDeg;
    const dummy = new THREE.Object3D();
    dummy.position.set(anchor.x, anchor.y, anchor.z);
    dummy.lookAt(0, 0, 0);
    dummy.rotateZ(THREE.MathUtils.degToRad(rollDeg));
    const w = 2 * ART_RADIUS * Math.tan(THREE.MathUtils.degToRad(sizeDeg / 2));
    return {
      position: dummy.position.clone(),
      quaternion: dummy.quaternion.clone(),
      scale: new THREE.Vector3(w, w / meta.aspect, 1),
    };
  }, [meta, info]);

  const maxOpacity = coarse ? 0.5 : 0.62;

  const uniforms = useMemo(
    () => ({
      glow: {
        uMap: { value: null as THREE.Texture | null },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
        uFocusIn: { value: 99 },
        uShimmer: { value: reducedMotion ? 0 : 1 },
      },
      body: {
        uMap: { value: null as THREE.Texture | null },
        uOpacity: { value: 0 },
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // 纹理就绪后写进两个材质的 uMap（避免 texture 变化重建 uniforms 对象）。
  useEffect(() => {
    uniforms.glow.uMap.value = texture;
    uniforms.body.uMap.value = texture;
  }, [texture, uniforms]);

  useFrame((_, delta) => {
    const p = progressRef.current[info.index] ?? 0;
    // 比连线慢半拍淡入（p>0.25 起），失活随 p 回落。
    const ease = THREE.MathUtils.smoothstep(p, 0.25, 1.0);
    if (glowRef.current) {
      const gu = glowRef.current.uniforms;
      gu.uOpacity!.value = ease * maxOpacity;
      if (!reducedMotion) gu.uTime!.value += delta;
      gu.uFocusIn!.value = focusInSec.current;
    }
    if (bodyRef.current) bodyRef.current.uniforms.uOpacity!.value = ease * 0.2;
    // 聚焦计时（sheen 用）：进度过 0.25 累加，回落复位。
    if (p > 0.25) focusInSec.current += delta;
    else if (p < 0.05) focusInSec.current = 0;
    // 缩放渐显：随进度从 90% 缓推到全尺寸（绕自身中心，天球锚定不变）。
    const g = groupRef.current;
    if (g) {
      const s = 0.9 + 0.1 * ease;
      g.scale.set(scale.x * s, scale.y * s, 1);
    }
  });

  if (!texture) return null;

  return (
    <group ref={groupRef} position={position} quaternion={quaternion} scale={scale}>
      {!coarse && (
        <mesh renderOrder={1.45} frustumCulled={false}>
          <planeGeometry args={[1, 1]} />
          <shaderMaterial
            ref={bodyRef}
            uniforms={uniforms.body}
            vertexShader={GLOW_VERTEX}
            fragmentShader={BODY_FRAGMENT}
            transparent
            depthWrite={false}
            blending={THREE.NormalBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      <mesh renderOrder={1.5} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial
          ref={glowRef}
          uniforms={uniforms.glow}
          vertexShader={GLOW_VERTEX}
          fragmentShader={GLOW_FRAGMENT}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
