'use client';

import { raDecToVector3 } from '@star/astro-core';
import { getMinorBodyEquatorial } from '@star/astro-ephem';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { EPHEM_SLERP_WINDOW_MS, slerpSphereVec } from '@/lib/ephemRegistry';
import {
  ensureMinorBodiesRoster,
  getMinorRosterVersion,
  minor,
  recomputeMinorBodies,
  subscribeMinorRoster,
  type MinorBodyState,
} from '@/lib/minorRegistry';
import { registerDynamicEntry, unregisterEntry } from '@/lib/pickRegistry';
import { useUniverse } from '@/lib/store';
import { SPHERE_RADIUS } from '@/lib/universe';
import { CometTailLayer } from './CometTailLayer';

/**
 * 小天体层（Phase 6B 目标 8，Phase 8 默认开 + 轨迹尾线，Phase 9B 六体 + 真彗尾）：
 * 谷神/灶神/智神 3 小行星 + 哈雷/恩克/庞斯-布鲁克斯 3 彗星。
 *
 * React.lazy 挂载（同 SatellitesLayer），不进首包。
 * 位置更新纪律与 PlanetsLayer 相同：effect 订阅 observeTime（低频）→
 * recomputeMinorBodies（实时模式另有 EphemDriver 30s 心跳直驱注册表）；
 * useFrame 只比较 version（O(1)）搬坐标——小天体日运动角分级，绝不逐帧计算。
 *
 * 渲染 3 draw：单 THREE.Points（6 点，菱形点形纹理区分于恒星圆点）+
 * 单 THREE.LineSegments（6 条常显短尾，运动方向可辨识）+
 * CometTailLayer 单 Points（Phase 9B 真彗尾，同 chunk 子组件，θ 超阈值才画）。
 * 不加常驻标签——hover tooltip + 搜索 + 信息卡足够（与卫星层一致）。
 *
 * deepTimeYears（跨域契约，Phase 9B）非 null 时整层淡出：开普勒/星历外推
 * 在万年尺度无效，「恒星自行时光机」只留恒星与连线。
 */

/** 轨迹窗口/步长：彗星窗口放大（哈雷远日点走得慢，短窗看不出弧）。 */
const TRAIL_SPEC: Record<MinorBodyState['kind'], { spanDays: number; stepDays: number }> = {
  asteroid: { spanDays: 45, stepDays: 3 }, // ±45d，31 采样点
  comet: { spanDays: 180, stepDays: 12 }, // ±180d，31 采样点
};
/** 每天体尾线采样点上限 × 每段 2 顶点（LineSegments）；总量随花名册在 built 内算。 */
const TRAIL_VERTS_PER_BODY = 64 * 2;
/** 尾线重算键的时间量化粒度：6h。30s 心跳不动 observeTime 亦无妨——
 *  尾线漂移量远小于量化粒度。 */
const TRAIL_QUANT_MS = 6 * 3600 * 1000;
const DAY_MS = 86400000;
/** 点位在 0.99，尾线压其下一层。 */
const TRAIL_RADIUS = SPHERE_RADIUS * 0.985;

/** 播放平滑 slerp 输出 scratch（useFrame 路径零分配纪律）。 */
const smoothScratch = new THREE.Vector3();

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
  // 跨域契约（Phase 9B 冻结）：deepTimeYears 归「地平锁定」域，本域只读；
  // 并行开发期字段可能尚未合入，读不到一律视为 null（= 不淡出）。
  const deepTimeActive = useUniverse(
    (s) => ((s as unknown as { deepTimeYears?: number | null }).deepTimeYears ?? null) !== null,
  );
  // 动态花名册（9C）：挂载即拉一次 /api/v1/minor-bodies（失败静默回退内置 6 体）；
  // 版本变化 → 重建几何缓冲（useMemo 依赖）。SSR 快照与客户端一致（初始 0）。
  const roster = useSyncExternalStore(
    subscribeMinorRoster,
    getMinorRosterVersion,
    getMinorRosterVersion,
  );
  useEffect(() => {
    void ensureMinorBodiesRoster();
  }, []);
  const versionRef = useRef(-1);
  const pendingFocusRef = useRef(true);
  const fadeRef = useRef(1);
  /** 播放平滑（§3b，复用 ephemRegistry 跨域共享工具）：version 变化墙钟时刻。 */
  const versionWallMsRef = useRef(0);
  /** 插值进行中标记（收敛后 useFrame 提前短路，恢复零逐帧成本）。 */
  const smoothingRef = useRef(false);

  const built = useMemo(() => {
    void roster; // 依赖显式化：花名册版本变化重建全部缓冲
    const states = [...minor.states.values()];
    const n = states.length;
    const trailMaxVerts = n * TRAIL_VERTS_PER_BODY;
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
    const trailPos = new Float32Array(trailMaxVerts * 3);
    const trailCol = new Float32Array(trailMaxVerts * 3);
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

    // 播放平滑插值起点（每天体一个，预分配；version 变化时记「当前显示位置」）
    const prevVecs = states.map(() => new THREE.Vector3());

    return { states, points, geom, pos, mat, tex, trail, trailGeom, trailPos, trailCol, trailMat, prevVecs, trailMaxVerts };
  }, [roster]);

  useEffect(() => {
    return () => {
      built.geom.dispose();
      built.mat.dispose();
      built.tex.dispose();
      built.trailGeom.dispose();
      built.trailMat.dispose();
    };
  }, [built]);

  // observeTime（低频）驱动重算；挂载即算一遍保证首帧有效；
  // 花名册扩容后（roster 变化，computedAtMs 已被置 0）立即补算新槽位坐标
  useEffect(() => {
    recomputeMinorBodies(observeTime ?? Date.now());
  }, [observeTime, roster]);

  // 尾线重算键：observeTime 量化 6h（6 体 ≈186 次开普勒求解 <2ms，useMemo 同步算；
  // 时间机器播放 4Hz 写 observeTime 也只在跨 6h 格时重算一次）。
  const quantTime = Math.round((observeTime ?? Date.now()) / TRAIL_QUANT_MS);

  useMemo(() => {
    const t0 = quantTime * TRAIL_QUANT_MS;
    const color = new THREE.Color();
    let n = 0; // 已写顶点数（LineSegments：每段独立 2 顶点，6 条尾互不连通）
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
      for (let t = t0 - spanMs; t <= t0 + spanMs + 1 && n + 2 <= built.trailMaxVerts; t += stepMs) {
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

  // 拾取注册 + 搜索联动补飞（recompute 在上面的 effect 同步完成，坐标已新鲜）。
  // roster 变化重跑：动态彗星的新槽位一并注册（vec 固定引用，重复 register 幂等覆盖）。
  useEffect(() => {
    for (const st of minor.states.values()) registerDynamicEntry(st.uid, 'minor', st.vec);
    const s = useUniverse.getState();
    if (pendingFocusRef.current && s.selectedUid?.startsWith('MB-')) {
      s.focusStar(s.selectedUid);
    }
    pendingFocusRef.current = false;
    return () => {
      for (const st of minor.states.values()) unregisterEntry(st.uid);
    };
  }, [roster]);

  // 卸载兜底（与 roster 重注册解耦）：防幽灵信息卡——层关闭时若选中的是小天体，取消选中
  useEffect(() => {
    return () => {
      const cur = useUniverse.getState();
      if (cur.selectedUid?.startsWith('MB-')) cur.selectStar(null);
    };
  }, []);

  useFrame((_, delta) => {
    // deepTime 淡出/回归（Phase 9B）：材质透明度整层渐隐，场景级节奏 ~0.5s；
    // 到位后 visible=false 彻底移出渲染队列（drawcall 也省掉）
    fadeRef.current = THREE.MathUtils.damp(fadeRef.current, deepTimeActive ? 0 : 1, 6, delta);
    const fade = fadeRef.current;
    built.mat.opacity = 0.95 * fade;
    built.trailMat.opacity = fade;
    const shown = minor.version > 0 && fade > 0.005;
    built.points.visible = shown;
    built.trail.visible = shown;

    // ── 播放平滑（§3b，复用 ephemRegistry.slerpSphereVec 跨域共享工具）──
    // 时间机器播放 4Hz 写 observeTime，直接搬 st.vec 会有台阶跳动（近日点段
    // 彗星在 1周/秒 档单步可达度级）。version 变化时记「当前显示位置」为插值
    // 起点，250ms 窗口内 slerp 到新目标；收敛后恢复零逐帧成本。
    // 注意：pickRegistry 持有的 st.vec 是插值终点，视觉滞后 ≤250ms（与
    // PlanetsLayer 同一取舍）；CometTailLayer 的彗核 uniform 走同窗口同步。
    const nowWall = performance.now();
    const versionChanged = versionRef.current !== minor.version;
    if (versionChanged) {
      versionRef.current = minor.version;
      versionWallMsRef.current = nowWall;
      smoothingRef.current = true;
      for (let i = 0; i < built.states.length; i++) {
        const p = built.prevVecs[i]!;
        p.set(built.pos[i * 3]!, built.pos[i * 3 + 1]!, built.pos[i * 3 + 2]!);
        // 首次搬运（缓冲区还是原点占位）直接 snap 到目标，不做入场滑移
        if (p.lengthSq() < 1) p.copy(built.states[i]!.vec);
      }
    }
    if (!smoothingRef.current) return;
    const t = (nowWall - versionWallMsRef.current) / EPHEM_SLERP_WINDOW_MS;
    const k = t >= 1 ? 1 : t;
    for (let i = 0; i < built.states.length; i++) {
      slerpSphereVec(built.prevVecs[i]!, built.states[i]!.vec, k, smoothScratch);
      built.pos[i * 3] = smoothScratch.x;
      built.pos[i * 3 + 1] = smoothScratch.y;
      built.pos[i * 3 + 2] = smoothScratch.z;
    }
    built.geom.attributes.position!.needsUpdate = true;
    if (t >= 1) smoothingRef.current = false;
  });

  return (
    <>
      <primitive object={built.points} />
      <primitive object={built.trail} />
      {/* 真彗尾（Phase 9B）：同懒 chunk 子组件，θ 超阈值才有粒子可见 */}
      <CometTailLayer />
    </>
  );
}
