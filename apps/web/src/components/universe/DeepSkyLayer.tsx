'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { raDecToVector3 } from '@star/astro-core';
import { DEEP_SKY_CATALOG, type CelestialObject } from '@star/astro-data';
import { shownDsoPhotos, subscribeDsoPhotoShown } from '@/lib/dso-photos';
import { SPHERE_RADIUS } from '@/lib/universe';

/**
 * 深空天体层（≈574 个：Messier 110 全量 + 亮 NGC/IC，OpenNGC）。
 *
 * 按类型分 3 组 THREE.Points（galaxy / nebula / cluster，双星等 star 类归入
 * cluster 组），每组一张 256² 程序化 canvas 灰度纹理 + 类型 tint —— 共 3 个
 * draw call、纹理内存 <1MB。
 *
 * 着色器复用 TwinkleStars 骨架：去掉闪烁、加 aRotation（每个天体随机固定
 * 转角旋转 gl_PointCoord，避免 500 个天体朝向一致的「贴纸感」）、加 uMap
 * 纹理采样；featured（Messier）带 ±0.06 的极缓呼吸 alpha（uTime，成本为零）。
 *
 * 【宇宙 V3-B】DsoPhotoLayer 为 ≤16 个最著名 Messier 挂真实照片切平面；
 * 某张照片真正可展示时（subscribeDsoPhotoShown），本层把对应点位经
 * aPhotoHide attribute 在 ~0.8s 内淡出 —— 照片浮现、光斑隐去，二者交叠。
 * 照片缺失/加载失败则事件不发生，程序 sprite 原样保留（零回退成本）。
 *
 * 拾取全部走 lib/pickRegistry（featured DSO 优先级高于亮星），本层只管画。
 */

const DSO_VERTEX = /* glsl */ `
  uniform float uPixelRatio;
  uniform float uTime;
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aRotation;
  attribute float aFeatured;
  attribute float aPhotoHide;
  varying vec3 vColor;
  varying float vRot;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vRot = aRotation;
    // featured 的极缓呼吸（±0.06），相位用固定转角错开；
    // aPhotoHide（0→1）：真实照片可展示后本点位淡出（宇宙 V3-B）
    vAlpha = (1.0 + aFeatured * 0.06 * sin(uTime * 0.7 + aRotation * 7.0)) * (1.0 - aPhotoHide);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio;
    gl_Position = projectionMatrix * mv;
  }
`;

const DSO_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vRot;
  varying float vAlpha;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float c = cos(vRot);
    float s = sin(vRot);
    uv = mat2(c, -s, s, c) * uv + 0.5;
    vec4 tex = texture2D(uMap, clamp(uv, 0.0, 1.0));
    float alpha = tex.a * vAlpha * 0.85;
    if (alpha < 0.012) discard;
    gl_FragColor = vec4(vColor * tex.rgb, alpha);
  }
`;

/** 确定性伪随机（种子式），保证纹理散点与旋转角在会话间稳定。 */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 星系纹理：椭圆核心亮斑 + 两条对数螺旋臂笔刷 + 外围冷色辉光（灰度）。 */
function makeGalaxyTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;

  // 外围辉光（椭圆压扁，模拟盘面倾角）
  ctx.save();
  ctx.translate(cx, cx);
  ctx.scale(1, 0.55);
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, 110);
  halo.addColorStop(0, 'rgba(255,255,255,0.5)');
  halo.addColorStop(0.4, 'rgba(230,235,255,0.18)');
  halo.addColorStop(1, 'rgba(210,220,255,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(-cx, -cx, size, size);
  ctx.restore();

  // 两条对数螺旋臂：逐段透明小圆描画
  const rand = seededRandom(31);
  for (let arm = 0; arm < 2; arm++) {
    const phase = arm * Math.PI;
    for (let t = 0; t < 1; t += 0.02) {
      const angle = phase + t * 3.6;
      const r = 12 + t * 88;
      const x = cx + r * Math.cos(angle);
      const y = cx + r * Math.sin(angle) * 0.55;
      const a = (1 - t) * 0.22 * (0.7 + rand() * 0.6);
      ctx.fillStyle = `rgba(235,240,255,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, 6 + t * 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 椭圆核心亮斑
  ctx.save();
  ctx.translate(cx, cx);
  ctx.scale(1, 0.62);
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 34);
  core.addColorStop(0, 'rgba(255,255,255,0.95)');
  core.addColorStop(0.5, 'rgba(255,250,240,0.4)');
  core.addColorStop(1, 'rgba(255,250,240,0)');
  ctx.fillStyle = core;
  ctx.fillRect(-cx, -cx / 0.62, size, size / 0.62);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 星云纹理：3–4 个错位径向渐变叠加的云斑 + 低频噪点边缘（灰度，tint 上色）。 */
function makeNebulaTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rand = seededRandom(97);

  const lobes: Array<[number, number, number, number]> = [
    [128, 118, 86, 0.5],
    [98, 148, 62, 0.42],
    [162, 142, 58, 0.4],
    [140, 92, 48, 0.34],
  ];
  for (const [x, y, r, a] of lobes) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.55, `rgba(255,244,244,${a * 0.4})`);
    g.addColorStop(1, 'rgba(255,240,240,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }

  // 低频噪点：稀疏透明小点，打散过于光滑的渐变边缘
  for (let i = 0; i < 260; i++) {
    const ang = rand() * Math.PI * 2;
    const rr = 40 + rand() * 74;
    const x = 128 + Math.cos(ang) * rr;
    const y = 122 + Math.sin(ang) * rr * 0.9;
    ctx.fillStyle = `rgba(255,250,250,${(rand() * 0.07).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, 2 + rand() * 5, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 星团纹理：中心密集、外围稀疏的小圆点散布（一张纹理内画好）。 */
function makeClusterTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rand = seededRandom(2049);

  // 极淡的整体辉光打底
  const halo = ctx.createRadialGradient(128, 128, 0, 128, 128, 104);
  halo.addColorStop(0, 'rgba(255,255,255,0.22)');
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);

  // 中心密集、外围稀疏：半径取两次随机的最小值（向心聚集）
  for (let i = 0; i < 18; i++) {
    const ang = rand() * Math.PI * 2;
    const rr = Math.min(rand(), rand()) * 86;
    const x = 128 + Math.cos(ang) * rr;
    const y = 128 + Math.sin(ang) * rr;
    const dot = 2.4 + rand() * 3.6;
    const g = ctx.createRadialGradient(x, y, 0, x, y, dot * 2.4);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, dot * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 渲染分组键：'star'（双星，如 M40）归入 cluster 组复用点状纹理。 */
type DsoGroupKey = 'galaxy' | 'nebula' | 'cluster';

function groupKeyOf(obj: CelestialObject): DsoGroupKey {
  if (obj.type === 'galaxy') return 'galaxy';
  if (obj.type === 'nebula') return 'nebula';
  return 'cluster';
}

/** 类型 tint（纹理是灰度，此处上淡色）：星系冷白 / 星云暖红 / 星团淡金。 */
const GROUP_TINT: Record<DsoGroupKey, [number, number, number]> = {
  galaxy: [0.84, 0.89, 1.0],
  nebula: [1.0, 0.74, 0.72],
  cluster: [1.0, 0.93, 0.74],
};

/** 点大小：featured（Messier）36–56px，普通 DSO 由星等映射 14–28px。 */
function dsoSize(obj: CelestialObject): number {
  if (obj.isFeatured) {
    return THREE.MathUtils.clamp(56 - obj.magnitude * 3, 36, 56);
  }
  return THREE.MathUtils.clamp(30 - obj.magnitude * 1.6, 14, 28);
}

interface DsoGroupData {
  key: DsoGroupKey;
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  rotations: Float32Array;
  featured: Float32Array;
  /** 与顶点同序的 objectUid（照片淡出时按 uid 定位顶点下标）。 */
  uids: string[];
  count: number;
}

/** 构建 3 组的 attributes（一次性 useMemo，<2ms）。 */
function buildDsoGroups(): DsoGroupData[] {
  const buckets = new Map<DsoGroupKey, CelestialObject[]>([
    ['galaxy', []],
    ['nebula', []],
    ['cluster', []],
  ]);
  for (const obj of DEEP_SKY_CATALOG) {
    buckets.get(groupKeyOf(obj))!.push(obj);
  }

  const groups: DsoGroupData[] = [];
  const rand = seededRandom(777);
  for (const [key, list] of buckets) {
    if (list.length === 0) continue;
    const count = list.length;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const rotations = new Float32Array(count);
    const featured = new Float32Array(count);
    const uids: string[] = [];
    const [tr, tg, tb] = GROUP_TINT[key];

    list.forEach((obj, i) => {
      uids.push(obj.objectUid);
      const v = raDecToVector3({ raDeg: obj.raDeg, decDeg: obj.decDeg }, SPHERE_RADIUS * 0.99);
      positions[i * 3] = v.x;
      positions[i * 3 + 1] = v.y;
      positions[i * 3 + 2] = v.z;
      // featured 略提亮
      const boost = obj.isFeatured ? 1.0 : 0.82;
      colors[i * 3] = tr * boost;
      colors[i * 3 + 1] = tg * boost;
      colors[i * 3 + 2] = tb * boost;
      sizes[i] = dsoSize(obj);
      rotations[i] = rand() * Math.PI * 2; // 每个天体随机固定转角，避免贴纸感
      featured[i] = obj.isFeatured ? 1 : 0;
    });

    groups.push({ key, positions, colors, sizes, rotations, featured, uids, count });
  }
  return groups;
}

export function DeepSkyLayer() {
  const pixelRatio = useThree((s) => s.gl.getPixelRatio());
  const materialsRef = useRef<THREE.ShaderMaterial[]>([]);

  const groups = useMemo(() => buildDsoGroups(), []);

  const resources = useMemo(() => {
    const textures: Record<DsoGroupKey, THREE.CanvasTexture> = {
      galaxy: makeGalaxyTexture(),
      nebula: makeNebulaTexture(),
      cluster: makeClusterTexture(),
    };
    return groups.map((g) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
      geometry.setAttribute('aColor', new THREE.BufferAttribute(g.colors, 3));
      geometry.setAttribute('aSize', new THREE.BufferAttribute(g.sizes, 1));
      geometry.setAttribute('aRotation', new THREE.BufferAttribute(g.rotations, 1));
      geometry.setAttribute('aFeatured', new THREE.BufferAttribute(g.featured, 1));
      // 照片淡出（0=正常显示，1=完全隐藏），由「照片可展示」事件驱动
      geometry.setAttribute('aPhotoHide', new THREE.BufferAttribute(new Float32Array(g.count), 1));
      const material = new THREE.ShaderMaterial({
        vertexShader: DSO_VERTEX,
        fragmentShader: DSO_FRAGMENT,
        uniforms: {
          uMap: { value: textures[g.key] },
          uTime: { value: 0 },
          uPixelRatio: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      return { key: g.key, geometry, material, texture: textures[g.key] };
    });
    // groups 为一次性 useMemo，资源同生命周期
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  materialsRef.current = resources.map((r) => r.material);

  // ── 照片淡出（宇宙 V3-B）：uid → (组下标, 顶点下标) 索引 ──
  const uidIndex = useMemo(() => {
    const map = new Map<string, { gi: number; idx: number }>();
    groups.forEach((g, gi) => {
      g.uids.forEach((uid, idx) => map.set(uid, { gi, idx }));
    });
    return map;
  }, [groups]);

  // 正在淡出的点位（帧循环推进，全部到 1 后清空 —— 平时零开销）
  const fadingRef = useRef<Array<{ gi: number; idx: number }>>([]);

  useEffect(() => {
    const hide = (uid: string, immediate: boolean) => {
      const loc = uidIndex.get(uid);
      if (!loc) return;
      const geometry = resources[loc.gi]?.geometry;
      if (!geometry) return;
      const attr = geometry.getAttribute('aPhotoHide') as THREE.BufferAttribute;
      if (immediate) {
        (attr.array as Float32Array)[loc.idx] = 1;
        attr.needsUpdate = true;
      } else if (!fadingRef.current.some((f) => f.gi === loc.gi && f.idx === loc.idx)) {
        fadingRef.current.push(loc);
      }
    };
    // 已可展示的照片（StrictMode 重挂载/晚订阅）直接置 1，避免二次淡出
    for (const uid of shownDsoPhotos) hide(uid, true);
    return subscribeDsoPhotoShown((uid) => hide(uid, false));
  }, [uidIndex, resources]);

  // 卸载时释放 GPU 资源
  useEffect(() => {
    return () => {
      for (const r of resources) {
        r.geometry.dispose();
        r.material.dispose();
        r.texture.dispose();
      }
    };
  }, [resources]);

  useFrame((_, delta) => {
    for (const mat of materialsRef.current) {
      mat.uniforms.uTime!.value += delta;
      mat.uniforms.uPixelRatio!.value = pixelRatio;
    }
    // 照片淡出推进（仅有照片刚就绪的 ~0.8s 内非空）
    const fading = fadingRef.current;
    if (fading.length > 0) {
      const step = delta / 0.8;
      for (let i = fading.length - 1; i >= 0; i--) {
        const loc = fading[i]!;
        const geometry = resources[loc.gi]?.geometry;
        if (!geometry) {
          fading.splice(i, 1);
          continue;
        }
        const attr = geometry.getAttribute('aPhotoHide') as THREE.BufferAttribute;
        const arr = attr.array as Float32Array;
        const next = Math.min(1, (arr[loc.idx] ?? 0) + step);
        arr[loc.idx] = next;
        attr.needsUpdate = true;
        if (next >= 1) fading.splice(i, 1);
      }
    }
  });

  return (
    <group>
      {resources.map((r) => (
        <points
          key={r.key}
          geometry={r.geometry}
          material={r.material}
          renderOrder={2}
          frustumCulled={false}
        />
      ))}
    </group>
  );
}
