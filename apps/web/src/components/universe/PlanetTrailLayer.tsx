'use client';

import { raDecToVector3 } from '@star/astro-core';
import { getEquatorial, isEphemerisUid, uidToBodyId, type EphemerisBodyId } from '@star/astro-ephem';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ephem } from '@/lib/ephemRegistry';
import { useUniverse } from '@/lib/store';
import { SPHERE_RADIUS } from '@/lib/universe';

/**
 * 行星轨迹层（Phase 6B 目标 6）：选中行星/月亮时画其过去与未来的视轨迹折线。
 *
 * - 地心 J2000，直接采样现有 getEquatorial（绝不手算坐标）；火星 ±120 天
 *   可看到完整逆行环。太阳无条目不画（太阳的路 = 黄道，已有开关）。
 * - 重算键 = (uid, observeTime 量化到 3h)：时间机器播放（4Hz 写 observeTime）
 *   不会每 tick 重算；~150 次采样 <10ms，useMemo 同步算。
 * - 预分配 buffer + setDrawRange，更新走 needsUpdate 不重建 geometry。
 *   顶点色 = 行星主色 × 两端渐隐权重（Additive 下暗顶点自然消失，等效
 *   per-vertex alpha——LineBasicMaterial 不支持顶点 alpha 的标准替代）。
 * - 合计 ≤2 draw：轨迹线 1 + 时间刻度点 1。
 */

/** 各天体的轨迹窗口/步长（自适应 110–170 采样点）。 */
const TRAIL_SPEC: Partial<Record<EphemerisBodyId, { spanDays: number; stepDays: number }>> = {
  moon: { spanDays: 14, stepDays: 0.125 }, // ±14d，3h 步长（月亮走得快）
  mercury: { spanDays: 40, stepDays: 0.5 },
  venus: { spanDays: 60, stepDays: 1 },
  mars: { spanDays: 120, stepDays: 1.5 }, // 完整逆行环
  jupiter: { spanDays: 365, stepDays: 5 },
  saturn: { spanDays: 365, stepDays: 5 },
  uranus: { spanDays: 365, stepDays: 5 },
  neptune: { spanDays: 365, stepDays: 5 },
}; // sun 无条目 → 不画

const MAX_POINTS = 512;
const MAX_TICKS = 32;
/** observeTime 量化粒度：3 小时。 */
const QUANT_MS = 3 * 3600 * 1000;
const DAY_MS = 86400000;
const TRAIL_RADIUS = SPHERE_RADIUS * 0.995;

export function PlanetTrailLayer() {
  const selectedUid = useUniverse((s) => s.selectedUid);
  const showPlanetTrails = useUniverse((s) => s.showPlanetTrails);
  const observeTime = useUniverse((s) => s.observeTime);

  // 预分配几何/材质（一次构建，组件卸载统一 dispose）
  const built = useMemo(() => {
    const lineGeom = new THREE.BufferGeometry();
    const linePos = new Float32Array(MAX_POINTS * 3);
    const lineCol = new Float32Array(MAX_POINTS * 3);
    lineGeom.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    lineGeom.setAttribute('color', new THREE.BufferAttribute(lineCol, 3));
    lineGeom.setDrawRange(0, 0);
    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    const line = new THREE.Line(lineGeom, lineMat);
    line.renderOrder = 7; // 行星 sprite（8）之下
    line.frustumCulled = false;

    const tickGeom = new THREE.BufferGeometry();
    const tickPos = new Float32Array(MAX_TICKS * 3);
    tickGeom.setAttribute('position', new THREE.BufferAttribute(tickPos, 3));
    tickGeom.setDrawRange(0, 0);
    const tickMat = new THREE.PointsMaterial({
      size: 3,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.55,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ticks = new THREE.Points(tickGeom, tickMat);
    ticks.renderOrder = 7;
    ticks.frustumCulled = false;

    return { line, lineGeom, linePos, lineCol, lineMat, ticks, tickGeom, tickPos, tickMat };
  }, []);

  useEffect(() => {
    return () => {
      built.lineGeom.dispose();
      built.lineMat.dispose();
      built.tickGeom.dispose();
      built.tickMat.dispose();
    };
  }, [built]);

  // 目标解析：选中的 EPH- 天体（太阳除外）
  const bodyId = useMemo(() => {
    if (!selectedUid || !isEphemerisUid(selectedUid)) return null;
    try {
      const id = uidToBodyId(selectedUid);
      return TRAIL_SPEC[id] ? id : null;
    } catch {
      return null;
    }
  }, [selectedUid]);

  // 重算键：observeTime 量化到 3h（播放时不逐 tick 重算）
  const quantTime = Math.round((observeTime ?? Date.now()) / QUANT_MS);

  const active = Boolean(bodyId && showPlanetTrails);

  useMemo(() => {
    if (!bodyId || !active) {
      built.lineGeom.setDrawRange(0, 0);
      built.tickGeom.setDrawRange(0, 0);
      return;
    }
    const spec = TRAIL_SPEC[bodyId]!;
    const t0 = quantTime * QUANT_MS;
    const spanMs = spec.spanDays * DAY_MS;
    const stepMs = spec.stepDays * DAY_MS;
    const color = new THREE.Color(ephem.bodies.get(`EPH-${bodyId.toUpperCase()}`)?.colorHex ?? '#ffffff');

    let n = 0;
    for (let t = t0 - spanMs; t <= t0 + spanMs + 1 && n < MAX_POINTS; t += stepMs) {
      const eq = getEquatorial(bodyId, new Date(t));
      const v = raDecToVector3({ raDeg: eq.raDeg, decDeg: eq.decDeg }, TRAIL_RADIUS);
      built.linePos[n * 3] = v.x;
      built.linePos[n * 3 + 1] = v.y;
      built.linePos[n * 3 + 2] = v.z;
      // 两端渐隐：w = 0.18 + 0.82·(1 − |t−t0|/span)
      const w = 0.18 + 0.82 * (1 - Math.abs(t - t0) / spanMs);
      built.lineCol[n * 3] = color.r * w;
      built.lineCol[n * 3 + 1] = color.g * w;
      built.lineCol[n * 3 + 2] = color.b * w;
      n++;
    }
    built.lineGeom.setDrawRange(0, n);
    built.lineGeom.attributes.position!.needsUpdate = true;
    built.lineGeom.attributes.color!.needsUpdate = true;

    // 时间刻度点：把窗口 12 等分（±6 个刻度），标注时间流向
    const tickStepMs = spanMs / 6;
    let m = 0;
    for (let k = -6; k <= 6 && m < MAX_TICKS; k++) {
      if (k === 0) continue; // 当前时刻处有行星本体，不加点
      const eq = getEquatorial(bodyId, new Date(t0 + k * tickStepMs));
      const v = raDecToVector3({ raDeg: eq.raDeg, decDeg: eq.decDeg }, TRAIL_RADIUS);
      built.tickPos[m * 3] = v.x;
      built.tickPos[m * 3 + 1] = v.y;
      built.tickPos[m * 3 + 2] = v.z;
      m++;
    }
    built.tickGeom.setDrawRange(0, m);
    built.tickGeom.attributes.position!.needsUpdate = true;
    built.tickMat.color.set(color);
  }, [built, bodyId, active, quantTime]);

  if (!active) return null;
  return (
    <>
      <primitive object={built.line} />
      <primitive object={built.ticks} />
    </>
  );
}
