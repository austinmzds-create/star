'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { fx } from '@/lib/fxBus';

const SKY_VERTEX = /* glsl */ `
  varying float vY;
  void main() {
    vY = normalize(position).y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  uniform float uPipe;
  varying float vY;
  void main() {
    float t = clamp(vY * 0.5 + 0.5, 0.0, 1.0);
    // 宇宙 V4 深邃版：三档色整体下调约 1/3（结构不变），底越黑星越亮
    vec3 top = vec3(0.004, 0.005, 0.016);
    vec3 mid = vec3(0.012, 0.016, 0.044);
    vec3 bottom = vec3(0.006, 0.009, 0.024);
    vec3 col = mix(bottom, mid, smoothstep(0.0, 0.5, t));
    col = mix(col, top, smoothstep(0.5, 1.0, t));
    // 线性管线适配（Phase 9A 后处理域，同 TwinkleStars.tsx）：上面三档色是
    // 「显示参考」调校值；composer 激活时（uPipe=1）链尾会统一 linear→sRGB
    // 编码，不先反解回线性域，0.044 的档色会被编码抬到 ~0.23——整片天穹
    // 变灰蓝，深邃底黑直接失守（实测踩坑）。行内为 sRGB EOTF 精确式。
    if (uPipe > 0.5) {
      col = mix(
        pow((col + 0.055) / 1.055, vec3(2.4)),
        col / 12.92,
        vec3(lessThanEqual(col, vec3(0.04045)))
      );
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** 生成一张柔和的径向渐变贴图，用作星云光斑。 */
function makeNebulaTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.08)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface NebulaBlob {
  position: [number, number, number];
  scale: number;
  color: string;
  opacity: number;
}

/**
 * 程序化假星云（氛围团）。
 *
 * 【宇宙 V2 下调】真实 DSO 层（DeepSkyLayer，OpenNGC 574 个）上线后，
 * 此层仅作极淡氛围，禁止与真实星云混淆：透明度全部 ×0.5，颜色从高饱和
 * 紫/蓝收敛为冷灰蓝。位置已用 raDecToVector3 校验：4 团与著名 DSO 密集区
 * （仙女 M31 / 猎户 M42 / 人马 M8 一带）角距均 > 30°，不会叠在真实天体上。
 * 不整层删除——非 DSO 区域的天空需要一点氛围，否则过于空洞。
 *
 * 【宇宙 V3 再降】真实银河全景（MilkyWayLayer，NASA SVS Starmap 2020 含
 * Gaia 微星场底噪）+ 16 张真实 DSO 照片上线后，氛围主角让位真实影像：
 * 透明度再 ×0.5 收敛为「几不可察」的深空底色。仍不删层 —— 银河贴图加载
 * 失败 / 用户关闭银河开关时，它是唯一的氛围兜底。
 */
const BLOBS: NebulaBlob[] = [
  { position: [-620, 240, -560], scale: 720, color: '#3a4a8a', opacity: 0.04 },
  { position: [540, -180, -600], scale: 640, color: '#3d3a6e', opacity: 0.032 },
  { position: [140, 420, 640], scale: 560, color: '#2f4a78', opacity: 0.03 },
  { position: [-460, -340, 520], scale: 600, color: '#2a5a68', opacity: 0.025 },
];

/** 渐变天穹 + 数团极淡氛围光斑（低端设备只留前 2 团）。 */
export function SpaceBackdrop({ blobCount = BLOBS.length }: { blobCount?: number }) {
  const nebulaTex = useMemo(() => makeNebulaTexture(), []);
  const skyUniforms = useMemo(() => ({ uPipe: { value: 0 } }), []);
  const skyMatRef = useRef<THREE.ShaderMaterial>(null);

  // 氛围 blob 是内建 SpriteMaterial（three 自带色彩管理，两条管线一致），
  // 只有手写天穹 shader 需要跟随后处理管线标志（模块总线直读，零 React）
  useFrame(() => {
    const u = skyMatRef.current?.uniforms;
    if (u) u.uPipe!.value = fx.linearPipe;
  });

  return (
    <group>
      <mesh scale={[-1, 1, 1]}>
        <sphereGeometry args={[1800, 48, 32]} />
        <shaderMaterial
          ref={skyMatRef}
          uniforms={skyUniforms}
          vertexShader={SKY_VERTEX}
          fragmentShader={SKY_FRAGMENT}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>

      {BLOBS.slice(0, blobCount).map((blob, i) => (
        <sprite key={i} position={blob.position} scale={[blob.scale, blob.scale, 1]}>
          <spriteMaterial
            map={nebulaTex}
            color={blob.color}
            transparent
            opacity={blob.opacity}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
    </group>
  );
}
