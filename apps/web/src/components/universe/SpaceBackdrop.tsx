'use client';

import { useMemo } from 'react';
import * as THREE from 'three';

const SKY_VERTEX = /* glsl */ `
  varying float vY;
  void main() {
    vY = normalize(position).y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  varying float vY;
  void main() {
    float t = clamp(vY * 0.5 + 0.5, 0.0, 1.0);
    vec3 top = vec3(0.006, 0.008, 0.024);
    vec3 mid = vec3(0.018, 0.024, 0.062);
    vec3 bottom = vec3(0.010, 0.014, 0.036);
    vec3 col = mix(bottom, mid, smoothstep(0.0, 0.5, t));
    col = mix(col, top, smoothstep(0.5, 1.0, t));
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
  const grad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
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

  return (
    <group>
      <mesh scale={[-1, 1, 1]}>
        <sphereGeometry args={[1800, 48, 32]} />
        <shaderMaterial
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
