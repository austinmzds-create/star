'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  getConstellationDeepTimeVersion,
  type ConstellationRenderInfo,
} from '@/lib/constellation-render';

/**
 * 星座成员星强调光环：激活座的连线端点（去重后 ≈10–30 颗）上叠一圈
 * 呼吸光环 + 错相闪烁，把「这一座由哪几颗星组成」点出来（Star Walk 式）。
 * 仅在该座 progress>0 时由 ConstellationLayer 挂载（同屏 ≤2 个 Points，
 * 常态零成本）；透明度整体跟随座进度，与连线/名称同步淡入淡出。
 */

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uProgress;   // 本座点亮进度映射（0..1）
  uniform float uTwinkle;    // 闪烁幅度（reduced-motion 时为 0）
  attribute float aSize;
  attribute float aPhase;
  varying float vAlpha;
  void main() {
    float tw = 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * 2.6 + aPhase));
    vAlpha = uProgress * tw;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio * (0.8 + 0.4 * uProgress * tw);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;
    if (d > 1.0) discard;
    // 空心光环（d≈0.55）+ 柔和内晕：强调恒星本体而不吞没它（加色混合下星点仍最亮）。
    float ring = exp(-pow((d - 0.55) * 3.2, 2.0)) * 0.5;
    float core = pow(max(1.0 - d, 0.0), 3.0) * 0.35;
    gl_FragColor = vec4(uColor, (ring + core) * vAlpha);
  }
`;

interface ConstellationMemberGlowProps {
  info: ConstellationRenderInfo;
  /** 每座点亮进度（0..1），由 ConstellationLayer 每帧原地写入。 */
  progressRef: React.MutableRefObject<Float32Array>;
  /** reduced-motion：冻结闪烁，仅保留稳态光环。 */
  reducedMotion: boolean;
}

export function ConstellationMemberGlow({
  info,
  progressRef,
  reducedMotion,
}: ConstellationMemberGlowProps) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const pixelRatio = useThree((s) => s.gl.getPixelRatio());
  // 深时形变版本（9B）：挂载时几何从最新 memberPositions 新建，取现值即可。
  const deepTimeVersion = useRef(getConstellationDeepTimeVersion());

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(info.memberPositions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(info.memberSizes, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(info.memberPhases, 1));
    return geo;
  }, [info]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPixelRatio: { value: pixelRatio },
      uProgress: { value: 0 },
      uTwinkle: { value: reducedMotion ? 0 : 0.45 },
      uColor: { value: new THREE.Color(0.72, 0.86, 1.0) }, // 比连线略亮的青白
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // 进度淡出到 0 后组件即被卸载：几何显式释放（材质由 r3f 处置）。
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((_, delta) => {
    const u = materialRef.current?.uniforms;
    if (!u) return;
    if (!reducedMotion) u.uTime!.value += delta;
    const p = progressRef.current[info.index] ?? 0;
    // 线亮到 15% 后光环开始浮现（先线后星的层次感），满亮 0.9。
    u.uProgress!.value = THREE.MathUtils.smoothstep(p, 0.15, 1.0) * 0.9;
    // 深时形变（9B）：memberPositions 被原地覆写，版本变化才重传（点数 ≤ 数十）。
    const v = getConstellationDeepTimeVersion();
    if (v !== deepTimeVersion.current) {
      deepTimeVersion.current = v;
      (geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  });

  return (
    <points geometry={geometry} renderOrder={3} frustumCulled={false}>
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
