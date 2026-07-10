'use client';

import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { getCelestialByUid } from '@star/astro-data';
import { useUniverse } from '@/lib/store';
import { SPHERE_RADIUS, spectralColor } from '@/lib/universe';
import { raDecToVector3 } from '@star/astro-core';

function makeGlowTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeRingTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(128, 128, 96, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(128, 128, 96, 0, Math.PI * 2);
  ctx.stroke();
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function TargetHighlight() {
  const selectedUid = useUniverse((s) => s.selectedUid);
  const showLabels = useUniverse((s) => s.showLabels);
  const { camera } = useThree();
  const glowRef = useRef<THREE.Sprite>(null);
  const ringRef = useRef<THREE.Sprite>(null);
  const labelRef = useRef<HTMLDivElement>(null);

  const glowTex = useMemo(() => makeGlowTexture(), []);
  const ringTex = useMemo(() => makeRingTexture(), []);

  const target = selectedUid ? getCelestialByUid(selectedUid) : undefined;

  const { position, color } = useMemo(() => {
    if (!target) {
      return { position: new THREE.Vector3(), color: new THREE.Color('#ffffff') };
    }
    const v = raDecToVector3({ raDeg: target.raDeg, decDeg: target.decDeg }, SPHERE_RADIUS);
    const [r, g, b] = spectralColor(target.spectralType);
    return {
      position: new THREE.Vector3(v.x, v.y, v.z),
      color: new THREE.Color(r, g, b),
    };
  }, [target]);

  const forward = useMemo(() => new THREE.Vector3(), []);
  const dir = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    if (!target) return;
    const t = state.clock.elapsedTime;
    const breathe = 1 + 0.12 * Math.sin(t * 2.0);
    if (glowRef.current) {
      const s = 62 * breathe;
      glowRef.current.scale.set(s, s, 1);
      (glowRef.current.material as THREE.SpriteMaterial).opacity =
        0.45 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2.0));
    }
    if (ringRef.current) {
      const s = 46 * (2 - breathe);
      ringRef.current.scale.set(s, s, 1);
      (ringRef.current.material as THREE.SpriteMaterial).opacity =
        0.35 + 0.4 * (0.5 + 0.5 * Math.sin(t * 2.0 + 1));
    }
    // 目标在相机背后时隐藏名牌
    if (labelRef.current) {
      forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
      dir.copy(position).normalize();
      const facing = dir.dot(forward);
      labelRef.current.style.opacity = showLabels && facing > 0.15 ? '1' : '0';
    }
  });

  if (!target) return null;

  return (
    <group position={position}>
      <sprite ref={glowRef}>
        <spriteMaterial
          map={glowTex}
          color={color}
          transparent
          opacity={0.6}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      <sprite ref={ringRef}>
        <spriteMaterial
          map={ringTex}
          color={'#dfe6ff'}
          transparent
          opacity={0.5}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      <Html center distanceFactor={undefined} zIndexRange={[20, 0]} pointerEvents="none">
        <div
          ref={labelRef}
          className="pointer-events-none select-none whitespace-nowrap text-center transition-opacity duration-300"
          style={{ transform: 'translateY(-54px)' }}
        >
          <div className="text-[15px] font-medium tracking-wide text-white drop-shadow-[0_0_10px_rgba(120,140,255,0.9)]">
            {target.nameZh}
          </div>
          <div className="text-[11px] uppercase tracking-[0.28em] text-nebula-200/80">
            {target.nameEn}
          </div>
        </div>
      </Html>
    </group>
  );
}
