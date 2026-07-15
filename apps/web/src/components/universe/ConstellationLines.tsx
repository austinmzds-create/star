'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { DeviceTier } from '@/lib/deviceTier';
import {
  getConstellationDeepTimeVersion,
  LINE_BASE_ALPHA,
  type ConstellationRenderData,
} from '@/lib/constellation-render';

/**
 * 88 星座连线（Phase 10 发光丝带升级）：仍单 draw call。
 *
 * high/mid：把每段线扩成屏幕空间四边形（6 顶点/段，非索引），顶点 shader
 * 沿「屏幕垂直于段方向」偏移半宽 → 有厚度的软边辉光 ribbon（中心亮芯 +
 * 两侧羽化晕，加色叠在真实星空上像霓虹）；半宽按较亮端星等分级（主干粗、
 * 支线细）。纵向沿用「依次描线（笔尖羽化推进 + 尖端光斑）+ 点亮后流光」。
 * low：回退原生 1px LineSegments（零回归），仅补聚焦压暗。
 *
 * 聚焦聚光灯（§3）：uActiveCon（激活座索引）+ uFocusDim（其余座压暗系数，
 * 由 ConstellationLayer 每帧写同一 ref）——激活座恒满亮，其余沉底。
 */

// ── 发光丝带（high/mid） ──

function makeRibbonVertexShader(consCount: number): string {
  return /* glsl */ `
    uniform float uProgress[${consCount}];
    uniform vec2  uResolution;   // 画布 CSS 像素（屏幕扩边用）
    uniform float uWidthScale;   // tier：high 1.0 / mid 0.7
    uniform float uTime;
    uniform float uBreathe;
    uniform float uActiveCon;    // 激活座索引（无激活 = -1）
    attribute vec3 aPosThis;     // 本顶点端点世界坐标
    attribute vec3 aPosOther;    // 同段另一端点（算屏幕方向）
    attribute float aSide;       // −1/+1 丝带上下沿
    attribute float aWidth;      // 本段基础像素半宽
    attribute float aCon;
    attribute float aT0;
    attribute float aT1;
    attribute float aPhase;
    attribute float aEnd;        // 本端点是段起 0 / 段终 1
    varying float vSeg;
    varying float vEnd;
    varying float vSide;
    varying float vPhase;
    varying float vBreathe;
    varying float vActive;
    void main() {
      float p = uProgress[int(aCon + 0.5)];
      vSeg = clamp((p - aT0) / max(aT1 - aT0, 1e-4), 0.0, 1.0);
      vEnd = aEnd;
      vSide = aSide;
      vPhase = aPhase;
      vBreathe = 1.0 - uBreathe * (0.5 + 0.5 * sin(uTime * 2.2 + aPhase));
      vActive = step(abs(aCon - uActiveCon), 0.5);

      vec4 clipT = projectionMatrix * modelViewMatrix * vec4(aPosThis, 1.0);
      vec4 clipO = projectionMatrix * modelViewMatrix * vec4(aPosOther, 1.0);
      vec2 sT = clipT.xy / clipT.w;
      vec2 sO = clipO.xy / clipO.w;
      vec2 d = (sO - sT) * uResolution;               // 屏幕方向（含宽高比）
      vec2 dir = length(d) > 1e-6 ? normalize(d) : vec2(1.0, 0.0);
      vec2 nrm = vec2(-dir.y, dir.x) / uResolution;    // 垂直法线，回 NDC
      // 描线未到本段时宽度收为 0（配合片元笔尖推进，「画出来」）
      float halfPx = aWidth * uWidthScale * (0.35 + 0.65 * smoothstep(0.0, 0.15, vSeg));
      clipT.xy += aSide * nrm * halfPx * 2.0 * clipT.w;
      gl_Position = clipT;
    }
  `;
}

const RIBBON_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uBase;
  uniform float uFlow;
  uniform float uFocusDim;      // 非激活座压暗（1=常态 / ~0.45=聚焦）
  varying float vSeg;
  varying float vEnd;
  varying float vSide;
  varying float vPhase;
  varying float vBreathe;
  varying float vActive;
  void main() {
    // 横截面辉光：中心亮芯（高斯）+ 外缘软晕 → 加色得霓虹感。
    float core = exp(-vSide * vSide * 3.4);
    float halo = exp(-vSide * vSide * 1.1) * 0.45;
    float body = core + halo;
    // 纵向描线（笔尖前可见，0.12 段羽化）+ 尖端光斑 + 点亮后流光。
    float draw = 1.0 - smoothstep(vSeg - 0.12, vSeg + 0.002, vEnd);
    float drawing = step(0.001, vSeg) * (1.0 - step(0.999, vSeg));
    float tip = drawing * exp(-pow((vEnd - vSeg) * 9.0, 2.0));
    float lit = smoothstep(0.85, 1.0, vSeg);
    float flow = uFlow * lit * pow(0.5 + 0.5 * sin(6.28318 * (vEnd - uTime * 0.22) + vPhase), 10.0);
    float aLine = uBase + draw * vSeg * 0.9 * vBreathe + tip * 0.6 + flow;   // 激活满亮 ≈1.0
    float dim = mix(uFocusDim, 1.0, vActive);
    vec3 col = mix(uColor, vec3(0.93, 0.97, 1.0), clamp(tip + flow * 2.0 + core * 0.25, 0.0, 1.0));
    float a = body * aLine * dim;
    gl_FragColor = vec4(col * (0.5 + 0.7 * aLine) * dim, a);
  }
`;

// ── 原生细线（low 回退，零回归 + 补聚焦压暗） ──

function makeLegacyVertexShader(consCount: number): string {
  return /* glsl */ `
    uniform float uProgress[${consCount}];
    uniform float uTime;
    uniform float uBreathe;
    uniform float uActiveCon;
    attribute float aCon;
    attribute float aT0;
    attribute float aT1;
    attribute float aPhase;
    attribute float aEnd;
    varying float vSeg;
    varying float vEnd;
    varying float vPhase;
    varying float vBreathe;
    varying float vActive;
    void main() {
      float p = uProgress[int(aCon + 0.5)];
      vSeg = clamp((p - aT0) / max(aT1 - aT0, 1e-4), 0.0, 1.0);
      vEnd = aEnd;
      vPhase = aPhase;
      vBreathe = 1.0 - uBreathe * (0.5 + 0.5 * sin(uTime * 2.2 + aPhase));
      vActive = step(abs(aCon - uActiveCon), 0.5);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
}

const LEGACY_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uBase;
  uniform float uFlow;
  uniform float uFocusDim;
  varying float vSeg;
  varying float vEnd;
  varying float vPhase;
  varying float vBreathe;
  varying float vActive;
  void main() {
    float draw = 1.0 - smoothstep(vSeg - 0.12, vSeg + 0.002, vEnd);
    float drawing = step(0.001, vSeg) * (1.0 - step(0.999, vSeg));
    float tip = drawing * exp(-pow((vEnd - vSeg) * 9.0, 2.0));
    float lit = smoothstep(0.85, 1.0, vSeg);
    float flow = uFlow * lit * pow(0.5 + 0.5 * sin(6.28318 * (vEnd - uTime * 0.22) + vPhase), 10.0);
    float a = uBase + draw * vSeg * 0.72 * vBreathe + tip * 0.5 + flow;
    float dim = mix(uFocusDim, 1.0, vActive);
    vec3 col = mix(uColor, vec3(0.93, 0.97, 1.0), clamp(tip + flow * 2.0, 0.0, 1.0));
    gl_FragColor = vec4(col * (0.55 + 0.65 * a) * dim, min(a, 1.0) * dim);
  }
`;

interface ConstellationLinesProps {
  data: ConstellationRenderData;
  /** 每座点亮进度（0..1），由 ConstellationLayer 每帧原地写入。 */
  progressRef: React.MutableRefObject<Float32Array>;
  /** reduced-motion：冻结呼吸/流光。 */
  reducedMotion: boolean;
  /** 设备档位：low → 原生细线回退；否则发光 ribbon。 */
  tier: DeviceTier;
  /** 聚焦聚光灯：非激活座压暗系数（1↔~0.45，ConstellationLayer damp）。 */
  focusDimRef: React.MutableRefObject<number>;
  /** 当前激活座索引（-1=无），ConstellationLayer 每帧写。 */
  activeIndexRef: React.MutableRefObject<number>;
}

export function ConstellationLines({
  data,
  progressRef,
  reducedMotion,
  tier,
  focusDimRef,
  activeIndexRef,
}: ConstellationLinesProps) {
  const ribbon = tier !== 'low';
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const size = useThree((s) => s.size);
  const deepTimeVersion = useRef(getConstellationDeepTimeVersion());

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    if (ribbon) {
      geo.setAttribute('aPosThis', new THREE.BufferAttribute(data.ribbonPos, 3));
      geo.setAttribute('aPosOther', new THREE.BufferAttribute(data.ribbonOther, 3));
      geo.setAttribute('aSide', new THREE.BufferAttribute(data.ribbonSide, 1));
      geo.setAttribute('aWidth', new THREE.BufferAttribute(data.ribbonWidth, 1));
      geo.setAttribute('aCon', new THREE.BufferAttribute(data.ribbonCon, 1));
      geo.setAttribute('aT0', new THREE.BufferAttribute(data.ribbonT0, 1));
      geo.setAttribute('aT1', new THREE.BufferAttribute(data.ribbonT1, 1));
      geo.setAttribute('aPhase', new THREE.BufferAttribute(data.ribbonPhase, 1));
      geo.setAttribute('aEnd', new THREE.BufferAttribute(data.ribbonEnd, 1));
      // 顶点着色器不引用 position，但 three 需要一个 position 属性存在——
      // 用 aPosThis 同一 buffer 充当（不参与运算，仅满足 draw 顶点数推断）。
      geo.setAttribute('position', new THREE.BufferAttribute(data.ribbonPos, 3));
    } else {
      geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      geo.setAttribute('aCon', new THREE.BufferAttribute(data.aCon, 1));
      geo.setAttribute('aT0', new THREE.BufferAttribute(data.aT0, 1));
      geo.setAttribute('aT1', new THREE.BufferAttribute(data.aT1, 1));
      geo.setAttribute('aPhase', new THREE.BufferAttribute(data.aPhase, 1));
      geo.setAttribute('aEnd', new THREE.BufferAttribute(data.aEnd, 1));
    }
    return geo;
  }, [data, ribbon]);

  const uniforms = useMemo(
    () => ({
      uProgress: { value: progressRef.current },
      uTime: { value: 0 },
      uBase: { value: LINE_BASE_ALPHA },
      uBreathe: { value: reducedMotion ? 0 : 0.12 },
      uFlow: { value: reducedMotion ? 0 : 0.35 },
      uColor: { value: new THREE.Color(0.62, 0.815, 1.0) }, // 青白 #9fd0ff
      uResolution: { value: new THREE.Vector2(size.width, size.height) },
      uWidthScale: { value: tier === 'mid' ? 0.7 : 1.0 },
      uFocusDim: { value: 1 },
      uActiveCon: { value: -1 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((_, delta) => {
    const u = materialRef.current?.uniforms;
    if (!u) return;
    if (!reducedMotion) u.uTime!.value += delta;
    u.uProgress!.value = progressRef.current;
    u.uFocusDim!.value = focusDimRef.current;
    u.uActiveCon!.value = activeIndexRef.current;
    if (ribbon) {
      (u.uResolution!.value as THREE.Vector2).set(size.width, size.height);
    }
    // 深时形变（9B）：base 与 ribbon 端点均被原地覆写，版本变化才置 needsUpdate。
    const ver = getConstellationDeepTimeVersion();
    if (ver !== deepTimeVersion.current) {
      deepTimeVersion.current = ver;
      if (ribbon) {
        (geometry.attributes.aPosThis as THREE.BufferAttribute).needsUpdate = true;
        (geometry.attributes.aPosOther as THREE.BufferAttribute).needsUpdate = true;
      } else {
        (geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      }
    }
  });

  const material = (
    <shaderMaterial
      ref={materialRef}
      uniforms={uniforms}
      vertexShader={
        ribbon ? makeRibbonVertexShader(data.cons.length) : makeLegacyVertexShader(data.cons.length)
      }
      fragmentShader={ribbon ? RIBBON_FRAGMENT : LEGACY_FRAGMENT}
      transparent
      depthWrite={false}
      blending={THREE.AdditiveBlending}
    />
  );

  return ribbon ? (
    <mesh geometry={geometry} renderOrder={2} frustumCulled={false}>
      {material}
    </mesh>
  ) : (
    <lineSegments geometry={geometry} renderOrder={2} frustumCulled={false}>
      {material}
    </lineSegments>
  );
}
