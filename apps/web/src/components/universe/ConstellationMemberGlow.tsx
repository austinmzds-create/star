'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { DeviceTier } from '@/lib/deviceTier';
import {
  getConstellationDeepTimeVersion,
  type ConstellationRenderInfo,
} from '@/lib/constellation-render';

/**
 * 星座成员星强调光环（Phase 10 §1.5 脉冲升级）：激活座连线端点上叠光环。
 * - 亮星心跳：最亮 3 颗（aRank<3）叠慢正弦「心跳」呼吸，作用于点尺寸与透明度；
 * - 首次聚焦 ping：α 星（rank 0）画一圈扩散空心环，focusInSec 0→1s 一发即熄；
 * - 稳态错相 twinkle 保留。全部并入同一 Points，零额外 draw。
 * mid 档保留心跳去掉 ping；low 档仅稳态环（无脉冲）；reduced-motion 冻结全部动效。
 */

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uProgress;   // 本座点亮进度映射（0..1）
  uniform float uTwinkle;    // 闪烁幅度（reduced-motion 时为 0）
  uniform float uBeat;       // 心跳幅度（mid/high；reduced-motion/low 为 0）
  attribute float aSize;
  attribute float aPhase;
  attribute float aRank;     // 0=最亮 α 星…
  varying float vAlpha;
  varying float vRank;
  void main() {
    float tw = 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * 2.6 + aPhase));
    // 最亮 3 颗叠慢心跳（1.4s 周期错相），其余为 1。
    float beat = aRank < 2.5 ? (1.0 + uBeat * (0.5 + 0.5 * sin(uTime * 4.5 - aRank * 0.9))) : 1.0;
    vAlpha = uProgress * tw;
    vRank = aRank;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio * (0.8 + 0.4 * uProgress * tw) * beat;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uFocusIn;    // 首帧聚焦以来秒数（ping 扩散用；>1 熄）
  uniform float uPing;       // ping 总开关（0=关，如 low/reduced-motion）
  varying float vAlpha;
  varying float vRank;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;
    if (d > 1.0) discard;
    // 空心光环（d≈0.55）+ 柔和内晕：强调恒星本体而不吞没它。
    float ring = exp(-pow((d - 0.55) * 3.2, 2.0)) * 0.5;
    float core = pow(max(1.0 - d, 0.0), 3.0) * 0.35;
    float a = (ring + core) * vAlpha;
    // α 星首次聚焦 ping：扩散空心环，focusIn 0→1 半径外扩、透明度衰减。
    if (uPing > 0.5 && vRank < 0.5 && uFocusIn < 1.0) {
      float pr = uFocusIn * 2.0;
      float pingRing = exp(-pow((d - clamp(pr, 0.0, 1.0)) * 4.0, 2.0));
      a += pingRing * (1.0 - uFocusIn) * 0.9 * vAlpha;
    }
    gl_FragColor = vec4(uColor, a);
  }
`;

interface ConstellationMemberGlowProps {
  info: ConstellationRenderInfo;
  /** 每座点亮进度（0..1），由 ConstellationLayer 每帧原地写入。 */
  progressRef: React.MutableRefObject<Float32Array>;
  /** reduced-motion：冻结闪烁/心跳/ping，仅保留稳态光环。 */
  reducedMotion: boolean;
  /** 设备档位：low 无脉冲；mid 心跳无 ping；high 全。 */
  tier: DeviceTier;
}

export function ConstellationMemberGlow({
  info,
  progressRef,
  reducedMotion,
  tier,
}: ConstellationMemberGlowProps) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const pixelRatio = useThree((s) => s.gl.getPixelRatio());
  const deepTimeVersion = useRef(getConstellationDeepTimeVersion());
  // 首次聚焦以来的秒数（ping 用）：progress 越过 0.15 起计，回落到 0 附近复位。
  const focusInSec = useRef(0);

  const beatOn = !reducedMotion && tier !== 'low';
  const pingOn = !reducedMotion && tier === 'high';

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(info.memberPositions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(info.memberSizes, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(info.memberPhases, 1));
    geo.setAttribute('aRank', new THREE.BufferAttribute(info.memberRanks, 1));
    return geo;
  }, [info]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPixelRatio: { value: pixelRatio },
      uProgress: { value: 0 },
      uTwinkle: { value: reducedMotion ? 0 : 0.45 },
      uBeat: { value: beatOn ? 0.35 : 0 },
      uFocusIn: { value: 99 },
      uPing: { value: pingOn ? 1 : 0 },
      uColor: { value: new THREE.Color(0.72, 0.86, 1.0) }, // 比连线略亮的青白
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((_, delta) => {
    const u = materialRef.current?.uniforms;
    if (!u) return;
    if (!reducedMotion) u.uTime!.value += delta;
    const p = progressRef.current[info.index] ?? 0;
    u.uProgress!.value = THREE.MathUtils.smoothstep(p, 0.15, 1.0) * 0.9;
    // 聚焦计时：进度过 0.15 才累加（先线后星），回落即复位以便下次重发 ping。
    if (p > 0.15) focusInSec.current += delta;
    else if (p < 0.05) focusInSec.current = 0;
    u.uFocusIn!.value = focusInSec.current;
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
