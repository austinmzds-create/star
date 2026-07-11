'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  LINE_BASE_ALPHA,
  type ConstellationRenderData,
} from '@/lib/constellation-render';

/**
 * 88 星座连线：单 LineSegments 单 draw call。
 * 「依次点亮」由每顶点 aT0/aT1 + 每座进度 uProgress[i] 在 shader 内合成；
 * CPU 每帧只上传一个 88 float 的 uniform 数组（<0.4KB）。
 * 原生 1px 线宽 + 加色混合 = 细发丝般的发光感，不喧宾夺主。
 */

function makeVertexShader(consCount: number): string {
  return /* glsl */ `
    uniform float uProgress[${consCount}];
    uniform float uTime;
    uniform float uBase;
    uniform float uBreathe;   // 呼吸幅度（reduced-motion 时为 0）
    attribute float aCon;
    attribute float aT0;
    attribute float aT1;
    attribute float aPhase;
    varying float vAlpha;
    void main() {
      float p = uProgress[int(aCon + 0.5)];
      float seg = smoothstep(aT0, aT1, p);                             // 本段依次亮起
      float breathe = 1.0 - uBreathe * (0.5 + 0.5 * sin(uTime * 2.2 + aPhase));
      vAlpha = uBase + seg * 0.72 * breathe;                           // 激活满亮 ≈0.8
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
}

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(uColor * (0.55 + 0.65 * vAlpha), vAlpha);
  }
`;

interface ConstellationLinesProps {
  data: ConstellationRenderData;
  /** 每座点亮进度（0..1），由 ConstellationLayer 每帧原地写入。 */
  progressRef: React.MutableRefObject<Float32Array>;
  /** reduced-motion：冻结呼吸。 */
  reducedMotion: boolean;
}

export function ConstellationLines({ data, progressRef, reducedMotion }: ConstellationLinesProps) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('aCon', new THREE.BufferAttribute(data.aCon, 1));
    geo.setAttribute('aT0', new THREE.BufferAttribute(data.aT0, 1));
    geo.setAttribute('aT1', new THREE.BufferAttribute(data.aT1, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(data.aPhase, 1));
    return geo;
  }, [data]);

  const uniforms = useMemo(
    () => ({
      uProgress: { value: progressRef.current },
      uTime: { value: 0 },
      uBase: { value: LINE_BASE_ALPHA },
      uBreathe: { value: reducedMotion ? 0 : 0.12 },
      uColor: { value: new THREE.Color(0.62, 0.815, 1.0) }, // 青白 #9fd0ff
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // 开关即 unmount：几何显式释放（材质由 r3f 处置）。
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((_, delta) => {
    const u = materialRef.current?.uniforms;
    if (!u) return;
    if (!reducedMotion) u.uTime!.value += delta;
    // uProgress.value 与 progressRef 同一引用，three 侧数组比较后按需上传。
    u.uProgress!.value = progressRef.current;
  });

  return (
    <lineSegments geometry={geometry} renderOrder={2} frustumCulled={false}>
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={makeVertexShader(data.cons.length)}
        fragmentShader={FRAGMENT}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </lineSegments>
  );
}
