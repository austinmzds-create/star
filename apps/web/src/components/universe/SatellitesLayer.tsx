'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { registerDynamicEntry, unregisterEntry } from '@/lib/pickRegistry';
import {
  recomputeSatellites,
  refreshTles,
  sats,
} from '@/lib/satellites/satRegistry';
import { SATELLITE_DEFS } from '@/lib/satellites/tles';
import { useUniverse } from '@/lib/store';

/**
 * 人造卫星层（Phase 6B 目标 7）：ISS/天宫/哈勃，TLE+SGP4 站心位置。
 *
 * 本组件经 React.lazy 挂载——satellite.js（satRegistry）只进本异步 chunk，
 * 首屏 bundle 零增量。首次开启「人造卫星」开关才下载。
 *
 * 【逐帧计算例外】与行星「version 比较」纪律不同：LEO 卫星角速度 ~1°/s，
 * useFrame 每帧 recomputeSatellites（3 体 propagate <0.3ms；simMs 不变时
 * registry 内部去重零成本）。时间源非订阅 getState()，帧内零 React 更新。
 *
 * 渲染合计 2 draw（红线内）：点（单 Points，3 顶点）+ 尾迹（单 LineSegments，
 * 全部卫星合并、环形缓冲、顶点色随 age 衰减）。无常驻名称标签——名字走
 * hover tooltip / 选中信息卡。
 */

/** 每星尾迹样点数（环形缓冲）。 */
const TRAIL_SAMPLES = 40;
/** 尾迹推进间隔（wall clock ms）。 */
const TRAIL_PUSH_MS = 400;
/** 时间跳变阈值（模拟 ms）：超过即清尾迹只跳点位。 */
const TIME_JUMP_MS = 10 * 60 * 1000;

const SAT_COUNT = SATELLITE_DEFS.length;

/** 尾迹环形缓冲容量（样点数上限 = TRAIL_SAMPLES + 1，与旧 push/shift 语义一致）。 */
const TRAIL_CAP = TRAIL_SAMPLES + 1;

/**
 * 每星尾迹环形缓冲（GC 纪律：Vector3 全部预分配，push 时 copy 原地覆盖最旧，
 * 替代旧版 st.vec.clone()——尾迹推进 400ms×3 星的稳态分配归零）。
 * head 指向最旧样点，逻辑序第 j 个样点 = buf[(head + j) % TRAIL_CAP]。
 */
interface TrailRing {
  buf: THREE.Vector3[];
  head: number;
  len: number;
}

function makeTrailRing(): TrailRing {
  return {
    buf: Array.from({ length: TRAIL_CAP }, () => new THREE.Vector3()),
    head: 0,
    len: 0,
  };
}

/** 圆形光点纹理（Points 默认方块难看）。 */
function makeDotTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function SatellitesLayer() {
  const lastPushRef = useRef(0);
  const lastSimMsRef = useRef<number | null>(null);
  const lastCityIdRef = useRef<string | null>(null);
  const pendingFocusRef = useRef(true);
  /**
   * 深时淡出系数（9B 跨域契约 §3）：deepTimeYears 非 null（恒星自行时光机
   * 开启）时目标 0，否则 1——SGP4 只在 TLE 历元附近有效，±10 万年尺度下
   * 卫星无意义。只调材质透明度与可见性，不动 SGP4 逻辑。
   */
  const deepFadeRef = useRef(1);
  // 每星尾迹历史（世界坐标环形缓冲，预分配 Vector3 池，最新在逻辑尾部）
  const trailRings = useMemo<TrailRing[]>(() => SATELLITE_DEFS.map(makeTrailRing), []);

  const built = useMemo(() => {
    const dotTex = makeDotTexture();

    // 点：单 Points（3 顶点，预分配）
    const pGeom = new THREE.BufferGeometry();
    const pPos = new Float32Array(SAT_COUNT * 3);
    const pCol = new Float32Array(SAT_COUNT * 3);
    pGeom.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeom.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
    const pMat = new THREE.PointsMaterial({
      map: dotTex,
      size: 7,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(pGeom, pMat);
    points.renderOrder = 8;
    points.frustumCulled = false;

    // 尾迹：全部卫星合并单 LineSegments（环形缓冲，预分配）
    const segFloats = SAT_COUNT * TRAIL_SAMPLES * 2 * 3;
    const tGeom = new THREE.BufferGeometry();
    const tPos = new Float32Array(segFloats);
    const tCol = new Float32Array(segFloats);
    tGeom.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
    tGeom.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
    tGeom.setDrawRange(0, 0);
    const tMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    const trails = new THREE.LineSegments(tGeom, tMat);
    trails.renderOrder = 7.5;
    trails.frustumCulled = false;

    const colors = SATELLITE_DEFS.map((d) => new THREE.Color(d.colorHex));
    return { dotTex, points, pGeom, pPos, pCol, pMat, trails, tGeom, tPos, tCol, tMat, colors };
  }, []);

  useEffect(() => {
    return () => {
      built.pGeom.dispose();
      built.pMat.dispose();
      built.tGeom.dispose();
      built.tMat.dispose();
      built.dotTex.dispose();
    };
  }, [built]);

  // 拾取注册（vec 共享 registry 同一引用，TargetHighlight 每帧 copy 自动追星）
  // + Celestrak 运行时刷新（fire-and-forget，失败静默用快照）
  useEffect(() => {
    for (const st of sats.states.values()) registerDynamicEntry(st.uid, 'satellite', st.vec);
    // 9C：改打自家 /api/v1/tle 服务端代理（fire-and-forget，失败静默用快照/缓存）
    void refreshTles();
    pendingFocusRef.current = true;
    return () => {
      for (const st of sats.states.values()) unregisterEntry(st.uid);
      // 防幽灵信息卡：层关闭时若选中的是卫星，取消选中
      const cur = useUniverse.getState();
      if (cur.selectedUid?.startsWith('SAT-')) cur.selectStar(null);
    };
  }, []);

  useFrame((_, delta) => {
    const s = useUniverse.getState(); // 非订阅：帧内零 React 更新
    // ── 深时淡出（9B 契约 §3）：指数逼近目标透明度，完全隐藏时跳过传播计算 ──
    const fadeTarget = s.deepTimeYears == null ? 1 : 0;
    let fade = deepFadeRef.current;
    if (fade !== fadeTarget) {
      fade += (fadeTarget - fade) * (1 - Math.exp(-6 * delta));
      if (Math.abs(fade - fadeTarget) < 0.01) fade = fadeTarget;
      deepFadeRef.current = fade;
      built.pMat.opacity = fade;
      built.tMat.opacity = fade;
      built.points.visible = fade > 0;
      built.trails.visible = fade > 0;
    }
    if (fade === 0) return; // 深时模式全隐：SGP4/尾迹全部歇脚（恢复即重算）
    const simMs = s.timeFollowsNow ? Date.now() : (s.observeTime ?? Date.now());
    // TODO(平滑)：时间机器播放时 observeTime 4Hz 更新有台阶感，v1 不做插值
    recomputeSatellites(simMs, s.city);

    // 时间跳变 / 城市切换 → 清空尾迹只跳点位
    const jumped =
      (lastSimMsRef.current !== null && Math.abs(simMs - lastSimMsRef.current) > TIME_JUMP_MS) ||
      (lastCityIdRef.current !== null && lastCityIdRef.current !== s.city.id);
    lastSimMsRef.current = simMs;
    lastCityIdRef.current = s.city.id;
    if (jumped) {
      for (const r of trailRings) {
        r.head = 0;
        r.len = 0;
      }
    }

    // 搜索联动：用户从搜索点进来时层可能刚挂载，首帧计算完成后补飞一次
    if (pendingFocusRef.current && sats.version > 0) {
      pendingFocusRef.current = false;
      if (s.selectedUid?.startsWith('SAT-')) s.focusStar(s.selectedUid);
    }

    // 点位与颜色（valid=false → 写零隐藏）
    let i = 0;
    for (const def of SATELLITE_DEFS) {
      const st = sats.states.get(def.uid);
      const color = built.colors[i]!;
      if (st && st.valid) {
        built.pPos[i * 3] = st.vec.x;
        built.pPos[i * 3 + 1] = st.vec.y;
        built.pPos[i * 3 + 2] = st.vec.z;
        built.pCol[i * 3] = color.r;
        built.pCol[i * 3 + 1] = color.g;
        built.pCol[i * 3 + 2] = color.b;
      } else {
        built.pPos[i * 3] = 0;
        built.pPos[i * 3 + 1] = 0;
        built.pPos[i * 3 + 2] = 0;
        built.pCol[i * 3] = 0;
        built.pCol[i * 3 + 1] = 0;
        built.pCol[i * 3 + 2] = 0;
      }
      i++;
    }
    built.pGeom.attributes.position!.needsUpdate = true;
    built.pGeom.attributes.color!.needsUpdate = true;

    // 尾迹推进（0.4s wall clock 一格）
    const now = performance.now();
    if (now - lastPushRef.current >= TRAIL_PUSH_MS) {
      lastPushRef.current = now;
      let k = 0;
      for (const def of SATELLITE_DEFS) {
        const st = sats.states.get(def.uid);
        const ring = trailRings[k]!;
        if (st && st.valid) {
          // 环形写入：满则覆盖最旧（head 前移），Vector3 原地 copy 零分配
          ring.buf[(ring.head + ring.len) % TRAIL_CAP]!.copy(st.vec);
          if (ring.len < TRAIL_CAP) ring.len++;
          else ring.head = (ring.head + 1) % TRAIL_CAP;
        } else {
          ring.head = 0;
          ring.len = 0;
        }
        k++;
      }
      // 重写全部尾迹段（≤240 顶点，顶点色随 age 衰减，Additive 下自然渐隐）
      let seg = 0;
      let sIdx = 0;
      for (const ring of trailRings) {
        const color = built.colors[sIdx]!;
        const segCount = Math.max(0, ring.len - 1);
        for (let j = 0; j < segCount; j++) {
          const a = ring.buf[(ring.head + j) % TRAIL_CAP]!;
          const b = ring.buf[(ring.head + j + 1) % TRAIL_CAP]!;
          const w = 0.5 * ((j + 1) / ring.len); // 越旧越暗
          const base = seg * 6;
          built.tPos[base] = a.x;
          built.tPos[base + 1] = a.y;
          built.tPos[base + 2] = a.z;
          built.tPos[base + 3] = b.x;
          built.tPos[base + 4] = b.y;
          built.tPos[base + 5] = b.z;
          built.tCol[base] = color.r * w;
          built.tCol[base + 1] = color.g * w;
          built.tCol[base + 2] = color.b * w;
          built.tCol[base + 3] = color.r * w;
          built.tCol[base + 4] = color.g * w;
          built.tCol[base + 5] = color.b * w;
          seg++;
        }
        sIdx++;
      }
      built.tGeom.setDrawRange(0, seg * 2);
      built.tGeom.attributes.position!.needsUpdate = true;
      built.tGeom.attributes.color!.needsUpdate = true;
    }
  });

  return (
    <>
      <primitive object={built.points} />
      <primitive object={built.trails} />
    </>
  );
}
