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

const BLOBS: NebulaBlob[] = [
  { position: [-620, 240, -560], scale: 720, color: '#5b4bff', opacity: 0.16 },
  { position: [540, -180, -600], scale: 640, color: '#7a3bd6', opacity: 0.13 },
  { position: [140, 420, 640], scale: 560, color: '#2f6bd6', opacity: 0.12 },
  { position: [-460, -340, 520], scale: 600, color: '#1f8fa8', opacity: 0.1 },
];

/** 渐变天穹 + 数团柔和星云光斑。 */
export function SpaceBackdrop() {
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

      {BLOBS.map((blob, i) => (
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
