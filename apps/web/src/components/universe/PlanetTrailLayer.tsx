'use client';

import { raDecToVector3 } from '@star/astro-core';
import { getEquatorial, isEphemerisUid, uidToBodyId, type EphemerisBodyId } from '@star/astro-ephem';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ephem } from '@/lib/ephemRegistry';
import { getSkyQuaternion } from '@/lib/skyFrame';
import { useUniverse } from '@/lib/store';
import { SPHERE_RADIUS } from '@/lib/universe';

/**
 * 行星轨迹层（Phase 6B 目标 6 → Phase 9B §3b 升级）：选中行星/月亮时画其
 * 过去与未来的视轨迹折线 + 日期标签 + 未来端方向箭头。
 *
 * - 地心 J2000，直接采样现有 getEquatorial（绝不手算坐标）；火星 ±120 天
 *   可看到完整逆行环。太阳无条目不画（太阳的路 = 黄道，已有开关）。
 * - 重算键 = (uid, observeTime 量化到 3h)：时间机器播放（4Hz 写 observeTime）
 *   不会每 tick 重算；~150 次采样 <10ms，useMemo 同步算。
 * - 预分配 buffer + setDrawRange，更新走 needsUpdate 不重建 geometry。
 *   顶点色 = 行星主色 × 两端渐隐权重（Additive 下暗顶点自然消失，等效
 *   per-vertex alpha——LineBasicMaterial 不支持顶点 alpha 的标准替代）。
 *
 * 【日期标签（9B）】12 个时间刻度点各配一枚「7/15」短格式日期（北京时区）：
 * 单张 atlas canvas（512×256 = 4×8 格，每格 128×32）+ 单 THREE.Points
 * shader sprite 合 1 draw——点精灵取中央 1/4 高度横带采样对应格，带外
 * discard；标签渲染在刻度点下方 ~10px。atlas 仅在轨迹重算键变化时重画。
 *
 * 【方向箭头（9B）】轨迹未来端 1 枚三角 sprite，指示时间流向；朝向 =
 * 末两采样点在屏幕面的投影角（含天旋 group 四元数，只读 skyFrame 契约），
 * 写 sprite.material.rotation，120ms 节流的低频更新（零分配）。
 *
 * 【深时淡出（9B 跨域契约 §3）】deepTimeYears 非 null 时随 PlanetsLayer
 * 同节奏整层渐隐——轨迹与行星本体同进退。
 *
 * 合计 ≤4 draw：轨迹线 1 + 刻度点 1 + 日期标签 1 + 箭头 1。
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

// ── 日期标签 atlas 常量（4 列 × 8 行 = 32 格，与 MAX_TICKS 对应） ──
const ATLAS_COLS = 4;
const ATLAS_ROWS = 8;
const CELL_W = 128;
const CELL_H = 32;

/** 箭头三角纹理（指向 +Y，即 material.rotation=0 时朝屏幕上方）。 */
function makeArrowTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  ctx.moveTo(32, 6);
  ctx.lineTo(54, 54);
  ctx.lineTo(32, 42);
  ctx.lineTo(10, 54);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.shadowColor = 'rgba(160,180,255,0.9)';
  ctx.shadowBlur = 6;
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 箭头朝向计算 scratch（useFrame 节流路径；零分配）
const arrowScratchA = new THREE.Vector3();
const arrowScratchB = new THREE.Vector3();
/** 日期格式化 scratch（重算键路径，避免每刻度 new Date）。 */
const labelScratchDate = new Date(0);

export function PlanetTrailLayer() {
  const selectedUid = useUniverse((s) => s.selectedUid);
  const showPlanetTrails = useUniverse((s) => s.showPlanetTrails);
  const observeTime = useUniverse((s) => s.observeTime);
  // 跨域契约 §3：deepTimeYears 归「地平锁定」域写入，本层只读判 null
  const deepTimeActive = useUniverse((s) => s.deepTimeYears !== null);
  const fadeRef = useRef(1);
  const lastArrowUpdateRef = useRef(0);

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

    // ── 日期标签：atlas canvas + 单 Points shader sprite（合 1 draw） ──
    const atlasCanvas = document.createElement('canvas');
    atlasCanvas.width = ATLAS_COLS * CELL_W;
    atlasCanvas.height = ATLAS_ROWS * CELL_H;
    const atlasCtx = atlasCanvas.getContext('2d')!;
    const atlasTex = new THREE.CanvasTexture(atlasCanvas);
    atlasTex.colorSpace = THREE.SRGBColorSpace;

    const labelGeom = new THREE.BufferGeometry();
    const labelPos = new Float32Array(MAX_TICKS * 3);
    const labelCell = new Float32Array(MAX_TICKS);
    labelGeom.setAttribute('position', new THREE.BufferAttribute(labelPos, 3));
    labelGeom.setAttribute('aCell', new THREE.BufferAttribute(labelCell, 1));
    labelGeom.setDrawRange(0, 0);
    const labelMat = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: atlasTex },
        uOpacity: { value: 0.85 },
        uColor: { value: new THREE.Color('#ffffff') },
        uPixelRatio: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float aCell;
        uniform float uPixelRatio;
        varying float vCell;
        void main() {
          vCell = aCell;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = 56.0 * uPixelRatio;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas;
        uniform float uOpacity;
        uniform vec3 uColor;
        varying float vCell;
        void main() {
          // 点精灵为方形（56px），atlas 格是 4:1 横条——只取偏下方 1/4 高度
          // 横带采样（带中心 y=0.68，标签自然落在刻度点下方），带外丢弃。
          vec2 pc = gl_PointCoord; // 原点左上、y 向下
          if (abs(pc.y - 0.68) > 0.125) discard;
          float cu = pc.x;
          float cv = (0.805 - pc.y) * 4.0; // 带内 0(下) → 1(上)
          float col = mod(vCell, ${ATLAS_COLS}.0);
          float row = floor(vCell / ${ATLAS_COLS}.0);
          // CanvasTexture flipY：v=0 为 canvas 底部 → v = 1 − (row+1−cv)/rows
          vec2 uv = vec2(
            (col + cu) / ${ATLAS_COLS}.0,
            1.0 - (row + 1.0 - cv) / ${ATLAS_ROWS}.0
          );
          vec4 tex = texture2D(uAtlas, uv);
          float a = tex.a * uOpacity;
          if (a < 0.01) discard;
          gl_FragColor = vec4(tex.rgb * uColor, a);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const labels = new THREE.Points(labelGeom, labelMat);
    labels.renderOrder = 7.2;
    labels.frustumCulled = false;

    // ── 方向箭头：未来端三角 sprite，rotation 由 useFrame 低频更新 ──
    const arrowTex = makeArrowTexture();
    const arrowMat = new THREE.SpriteMaterial({
      map: arrowTex,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
    });
    const arrow = new THREE.Sprite(arrowMat);
    arrow.scale.set(14, 14, 1);
    arrow.renderOrder = 7.3;
    arrow.frustumCulled = false;
    // 箭头朝向所需的末两采样点（本地天球坐标，重算键路径写入）
    const arrowEnd = new THREE.Vector3();
    const arrowPrev = new THREE.Vector3();

    return {
      line, lineGeom, linePos, lineCol, lineMat,
      ticks, tickGeom, tickPos, tickMat,
      atlasCtx, atlasTex, labels, labelGeom, labelPos, labelCell, labelMat,
      arrow, arrowMat, arrowTex, arrowEnd, arrowPrev,
    };
  }, []);

  useEffect(() => {
    return () => {
      built.lineGeom.dispose();
      built.lineMat.dispose();
      built.tickGeom.dispose();
      built.tickMat.dispose();
      built.labelGeom.dispose();
      built.labelMat.dispose();
      built.atlasTex.dispose();
      built.arrowMat.dispose();
      built.arrowTex.dispose();
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
      built.labelGeom.setDrawRange(0, 0);
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

    // 方向箭头锚点：未来端末两采样点（箭头画在最末点，朝向沿末段切向）
    if (n >= 2) {
      built.arrowEnd.set(
        built.linePos[(n - 1) * 3]!,
        built.linePos[(n - 1) * 3 + 1]!,
        built.linePos[(n - 1) * 3 + 2]!,
      );
      built.arrowPrev.set(
        built.linePos[(n - 2) * 3]!,
        built.linePos[(n - 2) * 3 + 1]!,
        built.linePos[(n - 2) * 3 + 2]!,
      );
      built.arrow.position.copy(built.arrowEnd);
    }

    // 时间刻度点 + 日期标签：把窗口 12 等分（±6 个刻度），标注时间流向。
    // atlas 与刻度同键重画（低频）：每格「7/15」短格式，北京时区（UTC+8）。
    const ctx = built.atlasCtx;
    ctx.clearRect(0, 0, ATLAS_COLS * CELL_W, ATLAS_ROWS * CELL_H);
    ctx.font = '600 22px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(20,30,80,0.9)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    const tickStepMs = spanMs / 6;
    let m = 0;
    for (let k = -6; k <= 6 && m < MAX_TICKS; k++) {
      if (k === 0) continue; // 当前时刻处有行星本体，不加点
      const tk = t0 + k * tickStepMs;
      const eq = getEquatorial(bodyId, new Date(tk));
      const v = raDecToVector3({ raDeg: eq.raDeg, decDeg: eq.decDeg }, TRAIL_RADIUS);
      built.tickPos[m * 3] = v.x;
      built.tickPos[m * 3 + 1] = v.y;
      built.tickPos[m * 3 + 2] = v.z;
      built.labelPos[m * 3] = v.x;
      built.labelPos[m * 3 + 1] = v.y;
      built.labelPos[m * 3 + 2] = v.z;
      built.labelCell[m] = m;
      // 「7/15」= 北京时区月/日（全站时间展示统一北京时间）
      labelScratchDate.setTime(tk + 8 * 3600_000);
      const text = `${labelScratchDate.getUTCMonth() + 1}/${labelScratchDate.getUTCDate()}`;
      const col = m % ATLAS_COLS;
      const row = Math.floor(m / ATLAS_COLS);
      ctx.fillText(text, col * CELL_W + CELL_W / 2, row * CELL_H + CELL_H / 2 + 1);
      m++;
    }
    built.tickGeom.setDrawRange(0, m);
    built.tickGeom.attributes.position!.needsUpdate = true;
    built.tickMat.color.set(color);
    built.labelGeom.setDrawRange(0, m);
    built.labelGeom.attributes.position!.needsUpdate = true;
    built.labelGeom.attributes.aCell!.needsUpdate = true;
    built.atlasTex.needsUpdate = true;
    // 标签着色：行星主色向白提亮一半（保证暗色行星的日期可读）
    (built.labelMat.uniforms.uColor!.value as THREE.Color).copy(color).lerp(
      new THREE.Color('#ffffff'),
      0.55,
    );
    built.arrowMat.color.set(color).lerp(new THREE.Color('#ffffff'), 0.4);
  }, [built, bodyId, active, quantTime]);

  useFrame((state, delta) => {
    // 深时淡出（跨域契约 §3）：与 PlanetsLayer 同节奏渐隐
    fadeRef.current = THREE.MathUtils.damp(fadeRef.current, deepTimeActive ? 0 : 1, 6, delta);
    const fade = fadeRef.current;
    const shown = fade > 0.005;
    built.line.visible = shown;
    built.ticks.visible = shown;
    built.labels.visible = shown;
    built.arrow.visible = shown;
    if (!shown) return;
    built.lineMat.opacity = fade;
    built.tickMat.opacity = 0.55 * fade;
    built.labelMat.uniforms.uOpacity!.value = 0.85 * fade;
    built.arrowMat.opacity = 0.9 * fade;
    // AdaptiveDpr 交互期会动 DPR：像素尺寸标签同步（单 uniform 写，零成本）
    built.labelMat.uniforms.uPixelRatio!.value = state.gl.getPixelRatio();

    // 方向箭头朝向：末两点世界坐标（含天旋四元数，只读 skyFrame）投影到
    // 屏幕取切向角；120ms 节流的低频更新，scratch 零分配
    const nowWall = performance.now();
    if (nowWall - lastArrowUpdateRef.current > 120) {
      lastArrowUpdateRef.current = nowWall;
      const q = getSkyQuaternion();
      arrowScratchA.copy(built.arrowPrev).applyQuaternion(q).project(state.camera);
      arrowScratchB.copy(built.arrowEnd).applyQuaternion(q).project(state.camera);
      const dx = (arrowScratchB.x - arrowScratchA.x) * state.size.width;
      const dy = (arrowScratchB.y - arrowScratchA.y) * state.size.height;
      if (dx * dx + dy * dy > 1e-10) {
        // 纹理三角指向 +Y（rotation=0 朝上）：屏幕切向角 − 90°
        built.arrowMat.rotation = Math.atan2(dy, dx) - Math.PI / 2;
      }
    }
  });

  if (!active) return null;
  return (
    <>
      <primitive object={built.line} />
      <primitive object={built.ticks} />
      <primitive object={built.labels} />
      <primitive object={built.arrow} />
    </>
  );
}
