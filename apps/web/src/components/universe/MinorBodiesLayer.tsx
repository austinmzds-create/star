'use client';

import { raDecToVector3 } from '@star/astro-core';
import { getMinorBodyEquatorial } from '@star/astro-ephem';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { minor, recomputeMinorBodies, type MinorBodyState } from '@/lib/minorRegistry';
import { registerDynamicEntry, unregisterEntry } from '@/lib/pickRegistry';
import { useUniverse } from '@/lib/store';
import { SPHERE_RADIUS } from '@/lib/universe';

/**
 * 小天体层（Phase 6B 目标 8，Phase 8 默认开 + 轨迹尾线）：
 * 谷神星/灶神星/智神星/哈雷彗星。
 *
 * React.lazy 挂载（同 SatellitesLayer），不进首包。
 * 位置更新纪律与 PlanetsLayer 相同：effect 订阅 observeTime（低频）→
 * recomputeMinorBodies（实时模式另有 EphemDriver 30s 心跳直驱注册表）；
 * useFrame 只比较 version（O(1)）搬坐标——小天体日运动角分级，绝不逐帧计算。
 *
 * 渲染 2 draw：单 THREE.Points（4 点，菱形点形纹理区分于恒星圆点）+
 * 单 THREE.LineSegments（4 条常显短尾，运动方向可辨识）。
 * 不加常驻标签——hover tooltip + 搜索 + 信息卡足够（与卫星层一致）。
 */

/** 轨迹窗口/步长：彗星窗口放大（哈雷远日点走得慢，短窗看不出弧）。 */
const TRAIL_SPEC: Record<MinorBodyState['kind'], { spanDays: number; stepDays: number }> = {
  asteroid: { spanDays: 45, stepDays: 3 }, // ±45d，31 采样点
  comet: { spanDays: 180, stepDays: 12 }, // ±180d，31 采样点
};
/** 每天体 64 采样点上限 × 每段 2 顶点（LineSegments）× 4 天体。 */
const TRAIL_MAX_VERTS = 4 * 64 * 2;
/** 尾线重算键的时间量化粒度：6h。30s 心跳不动 observeTime 亦无妨——
 *  尾线漂移量远小于量化粒度。 */
const TRAIL_QUANT_MS = 6 * 3600 * 1000;
const DAY_MS = 86400000;
/** 点位在 0.99，尾线压其下一层。 */
const TRAIL_RADIUS = SPHERE_RADIUS * 0.985;

/** 菱形点纹理（区分于恒星圆点）。 */
function makeDiamondTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(32, 32);
  ctx.rotate(Math.PI / 4);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 22);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-16, -16, 32, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function MinorBodiesLayer() {
  const observeTime = useUniverse((s) => s.observeTime);
  const versionRef = useRef(-1);
  const pendingFocusRef = useRef(true);

  const built = useMemo(() => {
    const states = [...minor.states.values()];
    const n = states.length;
    const tex = makeDiamondTexture();
    const geom = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    states.forEach((st, i) => {
      const c = new THREE.Color(st.colorHex);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    });
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      map: tex,
      size: 9,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geom, mat);
    points.renderOrder = 8;
    points.frustumCulled = false;

    // 尾线：预分配单 LineSegments，重算走 setDrawRange + needsUpdate 不重建
    //（仿 PlanetTrailLayer 纪律；顶点色两端渐隐 = Additive 暗顶点技法）。
    const trailGeom = new THREE.BufferGeometry();
    const trailPos = new Float32Array(TRAIL_MAX_VERTS * 3);
    const trailCol = new Float32Array(TRAIL_MAX_VERTS * 3);
    trailGeom.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    trailGeom.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
    trailGeom.setDrawRange(0, 0);
    const trailMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    const trail = new THREE.LineSegments(trailGeom, trailMat);
    trail.renderOrder = 7; // 小天体点（8）之下
    trail.frustumCulled = false;

    return { states, points, geom, pos, mat, tex, trail, trailGeom, trailPos, trailCol, trailMat };
  }, []);

  useEffect(() => {
    return () => {
      built.geom.dispose();
      built.mat.dispose();
      built.tex.dispose();
      built.trailGeom.dispose();
      built.trailMat.dispose();
    };
  }, [built]);

  // observeTime（低频）驱动重算；挂载即算一遍保证首帧有效
  useEffect(() => {
    recomputeMinorBodies(observeTime ?? Date.now());
  }, [observeTime]);

  // 尾线重算键：observeTime 量化 6h（≈128 次开普勒求解 <2ms，useMemo 同步算；
  // 时间机器播放 4Hz 写 observeTime 也只在跨 6h 格时重算一次）。
  const quantTime = Math.round((observeTime ?? Date.now()) / TRAIL_QUANT_MS);

  useMemo(() => {
    const t0 = quantTime * TRAIL_QUANT_MS;
    const color = new THREE.Color();
    let n = 0; // 已写顶点数（LineSegments：每段独立 2 顶点，4 条尾互不连通）
    for (const st of built.states) {
      const spec = TRAIL_SPEC[st.kind];
      const spanMs = spec.spanDays * DAY_MS;
      const stepMs = spec.stepDays * DAY_MS;
      color.set(st.colorHex);
      let px = 0;
      let py = 0;
      let pz = 0;
      let pw = 0;
      let hasPrev = false;
      for (let t = t0 - spanMs; t <= t0 + spanMs + 1 && n + 2 <= TRAIL_MAX_VERTS; t += stepMs) {
        const eq = getMinorBodyEquatorial(st.id, new Date(t));
        const v = raDecToVector3({ raDeg: eq.raDeg, decDeg: eq.decDeg }, TRAIL_RADIUS);
        // 两端渐隐：w = 0.18 + 0.82·(1 − |t−t0|/span)（Additive 下暗顶点自然消失）
        const w = 0.18 + 0.82 * (1 - Math.abs(t - t0) / spanMs);
        if (hasPrev) {
          built.trailPos[n * 3] = px;
          built.trailPos[n * 3 + 1] = py;
          built.trailPos[n * 3 + 2] = pz;
          built.trailCol[n * 3] = color.r * pw;
          built.trailCol[n * 3 + 1] = color.g * pw;
          built.trailCol[n * 3 + 2] = color.b * pw;
          n++;
          built.trailPos[n * 3] = v.x;
          built.trailPos[n * 3 + 1] = v.y;
          built.trailPos[n * 3 + 2] = v.z;
          built.trailCol[n * 3] = color.r * w;
          built.trailCol[n * 3 + 1] = color.g * w;
          built.trailCol[n * 3 + 2] = color.b * w;
          n++;
        }
        px = v.x;
        py = v.y;
        pz = v.z;
        pw = w;
        hasPrev = true;
      }
    }
    built.trailGeom.setDrawRange(0, n);
    built.trailGeom.attributes.position!.needsUpdate = true;
    built.trailGeom.attributes.color!.needsUpdate = true;
  }, [built, quantTime]);

  // 拾取注册 + 搜索联动补飞（recompute 在上面的 effect 同步完成，坐标已新鲜）
  useEffect(() => {
    for (const st of minor.states.values()) registerDynamicEntry(st.uid, 'minor', st.vec);
    const s = useUniverse.getState();
    if (pendingFocusRef.current && s.selectedUid?.startsWith('MB-')) {
      s.focusStar(s.selectedUid);
    }
    pendingFocusRef.current = false;
    return () => {
      for (const st of minor.states.values()) unregisterEntry(st.uid);
      // 防幽灵信息卡：层关闭时若选中的是小天体，取消选中
      const cur = useUniverse.getState();
      if (cur.selectedUid?.startsWith('MB-')) cur.selectStar(null);
    };
  }, []);

  useFrame(() => {
    built.points.visible = minor.version > 0;
    if (versionRef.current === minor.version) return;
    versionRef.current = minor.version;
    built.states.forEach((st, i) => {
      built.pos[i * 3] = st.vec.x;
      built.pos[i * 3 + 1] = st.vec.y;
      built.pos[i * 3 + 2] = st.vec.z;
    });
    built.geom.attributes.position!.needsUpdate = true;
  });

  return (
    <>
      <primitive object={built.points} />
      <primitive object={built.trail} />
    </>
  );
}
