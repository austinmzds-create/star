'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { getPerfTier } from '@/lib/perfBus';
import { registerDynamicEntry, unregisterEntry } from '@/lib/pickRegistry';
import {
  clearStarlink,
  injectStarlink,
  recomputeSatellites,
  sats,
} from '@/lib/satellites/satRegistry';
import { useUniverse } from '@/lib/store';

/**
 * 星链层（Phase 10「星链」域）：Celestrak STARLINK 组的近地过境光点。
 *
 * 与 SatellitesLayer（3 颗著名卫星 + 尾迹）刻意分离——星链数量大、无尾迹：
 *  - 单 THREE.Points（≤cap 顶点，1 draw call，sizeAttenuation=false + Additive）；
 *  - 逐帧 recomputeSatellites 批量算全部 states，遍历 group==='starlink' 写点位；
 *  - 颜色按可见性分档：不可见 = 暗蓝、valid 且「现在可见」= 亮白青；
 *  - 仅 earth 模式渲染（站心过境只在「站在地球上看」有意义；free 模式隐藏）；
 *  - 深时（恒星自行时光机）淡出——SGP4 只在 TLE 历元附近有效。
 *
 * 经 React.lazy 挂载（satellite.js/satRegistry 只进异步 chunk）；挂载条件由
 * UniverseScene 用 showStarlink && deviceTier≠low 把关，cap 按档传入（high 120 / mid 60）。
 */

/** 圆形光点纹理（与 SatellitesLayer 同款，独立一份避免跨组件耦合）。 */
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

/** 暗态（未过境）冷暗蓝 RGB（0–1）。 */
const DIM_RGB: [number, number, number] = [0.1, 0.16, 0.3];
/** 「现在可见」亮白青 RGB（0–1）。 */
const BRIGHT_RGB: [number, number, number] = [0.81, 0.89, 1];

export function StarlinkLayer({ cap }: { cap: number }) {
  /**
   * 可见淡入淡出系数：初始 0（free 模式挂载时隐藏，不闪）；进入 earth 淡入，
   * 退出 earth / 深时淡出。兼任 9B 深时门控（契约 §3）与 earth 模式门控。
   */
  const deepFadeRef = useRef(0);
  /** 已向 pickRegistry 注册的 uid（earth 进入时登记、离开时撤销，避免拾取隐藏点）。 */
  const registered = useRef<Set<string>>(new Set());

  const built = useMemo(() => {
    const dotTex = makeDotTexture();
    const pGeom = new THREE.BufferGeometry();
    const pPos = new Float32Array(cap * 3);
    const pCol = new Float32Array(cap * 3);
    pGeom.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeom.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
    pGeom.setDrawRange(0, 0);
    const pMat = new THREE.PointsMaterial({
      map: dotTex,
      size: 6,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    pMat.opacity = 0; // 初始隐藏（配合 deepFadeRef=0），进入 earth 才淡入
    const points = new THREE.Points(pGeom, pMat);
    points.renderOrder = 8;
    points.frustumCulled = false;
    points.visible = false; // 首帧默认隐藏（free 模式），earth 帧循环内再点亮
    return { dotTex, points, pGeom, pPos, pCol, pMat };
  }, [cap]);

  // 注入星链 TLE（拉自家 /api/v1/tle，按 cap 截断）；卸载时清理注册 + states/satrecs
  useEffect(() => {
    void injectStarlink(cap);
    return () => {
      for (const uid of registered.current) unregisterEntry(uid);
      registered.current.clear();
      clearStarlink();
      // 防幽灵信息卡：层卸载时若选中的是星链，取消选中
      const cur = useUniverse.getState();
      if (cur.selectedUid?.startsWith('SAT-STARLINK-')) cur.selectStar(null);
    };
  }, [cap]);

  useEffect(() => {
    return () => {
      built.pGeom.dispose();
      built.pMat.dispose();
      built.dotTex.dispose();
    };
  }, [built]);

  useFrame((_, delta) => {
    const s = useUniverse.getState(); // 非订阅：帧内零 React 更新
    const earth = s.viewMode === 'earth';
    // 目标可见 = earth 模式 && 非深时 && 运行时未熔断到 low（perfBus 先降星链层，
    // 契约/性能预算 §3.4）；指数逼近淡入淡出
    const fadeTarget = earth && s.deepTimeYears == null && getPerfTier() !== 'low' ? 1 : 0;
    let fade = deepFadeRef.current;
    if (fade !== fadeTarget) {
      fade += (fadeTarget - fade) * (1 - Math.exp(-6 * delta));
      if (Math.abs(fade - fadeTarget) < 0.01) fade = fadeTarget;
      deepFadeRef.current = fade;
      built.pMat.opacity = fade;
    }
    if (fade === 0) {
      // 完全隐藏（free/深时）：撤销拾取注册，SGP4 与写点位全歇脚
      if (registered.current.size > 0) {
        for (const uid of registered.current) unregisterEntry(uid);
        registered.current.clear();
      }
      built.points.visible = false;
      return;
    }
    built.points.visible = true;

    const simMs = s.timeFollowsNow ? Date.now() : (s.observeTime ?? Date.now());
    recomputeSatellites(simMs, s.city);

    let i = 0;
    for (const st of sats.states.values()) {
      if (st.group !== 'starlink') continue;
      if (i >= cap) break;
      if (!registered.current.has(st.uid)) {
        registerDynamicEntry(st.uid, 'satellite', st.vec); // vec 共享引用，每帧自动追星
        registered.current.add(st.uid);
      }
      const base = i * 3;
      if (st.valid) {
        built.pPos[base] = st.vec.x;
        built.pPos[base + 1] = st.vec.y;
        built.pPos[base + 2] = st.vec.z;
        const rgb = st.visiblePass ? BRIGHT_RGB : DIM_RGB;
        built.pCol[base] = rgb[0];
        built.pCol[base + 1] = rgb[1];
        built.pCol[base + 2] = rgb[2];
      } else {
        built.pPos[base] = 0;
        built.pPos[base + 1] = 0;
        built.pPos[base + 2] = 0;
        built.pCol[base] = 0;
        built.pCol[base + 1] = 0;
        built.pCol[base + 2] = 0;
      }
      i++;
    }
    built.pGeom.setDrawRange(0, i);
    built.pGeom.attributes.position!.needsUpdate = true;
    built.pGeom.attributes.color!.needsUpdate = true;
  });

  return <primitive object={built.points} />;
}
