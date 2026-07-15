'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  getConstellationDeepTimeVersion,
  LINE_BASE_ALPHA,
  type ConstellationRenderData,
} from '@/lib/constellation-render';

/**
 * 88 星座连线：单 LineSegments 单 draw call（Star Walk 式描线升级）。
 * 「依次点亮」由每顶点 aT0/aT1 + 每座进度 uProgress[i] 在 shader 内合成；
 * aEnd（段起点 0 / 终点 1）经片元插值给出沿段坐标，据此实现真正的
 * 「逐段描线」（笔尖羽化推进 + 尖端光斑）与点亮后的沿线流光，
 * CPU 每帧仍只上传一个 88 float 的 uniform 数组（<0.4KB）。
 * 原生 1px 线宽 + 加色混合 = 细发丝般的发光感，不喧宾夺主。
 */

function makeVertexShader(consCount: number): string {
  return /* glsl */ `
    uniform float uProgress[${consCount}];
    uniform float uTime;
    uniform float uBreathe;   // 呼吸幅度（reduced-motion 时为 0）
    attribute float aCon;
    attribute float aT0;
    attribute float aT1;
    attribute float aPhase;
    attribute float aEnd;
    varying float vSeg;       // 本段描线进度（0..1，两顶点同值，段内常量）
    varying float vEnd;       // 沿段坐标（片元插值 0→1）
    varying float vPhase;
    varying float vBreathe;
    void main() {
      float p = uProgress[int(aCon + 0.5)];
      vSeg = clamp((p - aT0) / max(aT1 - aT0, 1e-4), 0.0, 1.0);       // 本段依次描出
      vEnd = aEnd;
      vPhase = aPhase;
      vBreathe = 1.0 - uBreathe * (0.5 + 0.5 * sin(uTime * 2.2 + aPhase));
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
}

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uBase;
  uniform float uFlow;        // 流光幅度（reduced-motion 时为 0）
  varying float vSeg;
  varying float vEnd;
  varying float vPhase;
  varying float vBreathe;
  void main() {
    // 描线：笔尖（vSeg）之前的片元可见，尖端 0.12 段羽化——「画出来」而非整段淡入。
    float draw = 1.0 - smoothstep(vSeg - 0.12, vSeg + 0.002, vEnd);
    // 笔尖光斑：描线进行中在推进沿上叠一粒亮点，收笔即熄。
    float drawing = step(0.001, vSeg) * (1.0 - step(0.999, vSeg));
    float tip = drawing * exp(-pow((vEnd - vSeg) * 9.0, 2.0));
    // 沿线流光：本段描完后一缕微光循环流过（相位按段散布，避免整座同步）。
    float lit = smoothstep(0.85, 1.0, vSeg);
    float flow = uFlow * lit * pow(0.5 + 0.5 * sin(6.28318 * (vEnd - uTime * 0.22) + vPhase), 10.0);
    float a = uBase + draw * vSeg * 0.72 * vBreathe + tip * 0.5 + flow;   // 激活满亮 ≈0.8
    // 笔尖与流光偏白，主体保持青白。
    vec3 col = mix(uColor, vec3(0.93, 0.97, 1.0), clamp(tip + flow * 2.0, 0.0, 1.0));
    gl_FragColor = vec4(col * (0.55 + 0.65 * a), min(a, 1.0));
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
  // 深时形变版本（9B）：挂载时取现值——geometry 从 data.positions 新建，
  // 上传的本就是最新形变结果，不需要补一次 needsUpdate。
  const deepTimeVersion = useRef(getConstellationDeepTimeVersion());

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('aCon', new THREE.BufferAttribute(data.aCon, 1));
    geo.setAttribute('aT0', new THREE.BufferAttribute(data.aT0, 1));
    geo.setAttribute('aT1', new THREE.BufferAttribute(data.aT1, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(data.aPhase, 1));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(data.aEnd, 1));
    return geo;
  }, [data]);

  const uniforms = useMemo(
    () => ({
      uProgress: { value: progressRef.current },
      uTime: { value: 0 },
      uBase: { value: LINE_BASE_ALPHA },
      uBreathe: { value: reducedMotion ? 0 : 0.12 },
      uFlow: { value: reducedMotion ? 0 : 0.35 },
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
    // 深时形变（9B）：applyConstellationDeepTime 原地覆写了 data.positions，
    // 版本号变化才置 needsUpdate（≤10Hz 节流上传 ~25KB，常态零成本）。
    const v = getConstellationDeepTimeVersion();
    if (v !== deepTimeVersion.current) {
      deepTimeVersion.current = v;
      (geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
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
