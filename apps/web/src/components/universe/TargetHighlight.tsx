'use client';

import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { getObjectByUid } from '@/lib/solarSystem';
import { kindLabelZh } from '@/lib/objectPresenter';
import { getPickEntry, resolveObjectPosition } from '@/lib/pickRegistry';
import { useUniverse } from '@/lib/store';
import { spectralColor } from '@/lib/universe';
import type { PickKind } from '@/lib/pickRegistry';

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

/** 高亮环/光晕的尺寸分档：行星与著名 DSO 更大，普通 DSO 次之，恒星现规格。 */
function kindScale(kind: PickKind | undefined): number {
  switch (kind) {
    case 'planet':
    case 'dso-featured':
      return 1.6;
    case 'dso':
    case 'satellite':
    case 'minor':
      return 1.3;
    default:
      return 1;
  }
}

/** 高亮主色：恒星按光谱，深空按类型 tint，行星日月按元数据主色近似（冷白兜底）。 */
function highlightColor(uid: string): THREE.Color {
  const obj = getObjectByUid(uid);
  if (!obj) return new THREE.Color('#ffffff');
  switch (obj.type) {
    case 'star': {
      const [r, g, b] = spectralColor(obj.spectralType);
      return new THREE.Color(r, g, b);
    }
    case 'galaxy':
      return new THREE.Color('#d6e2ff');
    case 'nebula':
      return new THREE.Color('#ffbdb8');
    case 'cluster':
      return new THREE.Color('#ffedbd');
    default:
      // 行星/日月：柔和金白（具体主色由 PlanetsLayer 盘面呈现，这里不抢戏）
      return new THREE.Color('#fff0d6');
  }
}

export function TargetHighlight() {
  const selectedUid = useUniverse((s) => s.selectedUid);
  const showLabels = useUniverse((s) => s.showLabels);
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Sprite>(null);
  const ringRef = useRef<THREE.Sprite>(null);
  const labelRef = useRef<HTMLDivElement>(null);

  const glowTex = useMemo(() => makeGlowTexture(), []);
  const ringTex = useMemo(() => makeRingTexture(), []);

  const target = selectedUid ? getObjectByUid(selectedUid) : undefined;
  const entry = selectedUid ? getPickEntry(selectedUid) : undefined;
  const scale = kindScale(entry?.kind);

  const { position, color } = useMemo(() => {
    if (!target) {
      return { position: new THREE.Vector3(), color: new THREE.Color('#ffffff') };
    }
    // 统一位置解析：星/DSO 静态坐标，行星为星历实时坐标（同一引用）
    const vec = resolveObjectPosition(target.objectUid);
    return {
      position: vec ? vec.clone() : new THREE.Vector3(),
      color: highlightColor(target.objectUid),
    };
  }, [target]);

  const forward = useMemo(() => new THREE.Vector3(), []);
  const dir = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    if (!target) return;
    const t = state.clock.elapsedTime;
    const breathe = 1 + 0.12 * Math.sin(t * 2.0);
    // 行星坐标随 observeTime 变化：每帧从注册表引用同步（静态天体为零成本 copy）
    if (groupRef.current && entry) {
      groupRef.current.position.copy(entry.vec);
    }
    if (glowRef.current) {
      const s = 62 * scale * breathe;
      glowRef.current.scale.set(s, s, 1);
      (glowRef.current.material as THREE.SpriteMaterial).opacity =
        0.45 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2.0));
    }
    if (ringRef.current) {
      const s = 46 * scale * (2 - breathe);
      ringRef.current.scale.set(s, s, 1);
      (ringRef.current.material as THREE.SpriteMaterial).opacity =
        0.35 + 0.4 * (0.5 + 0.5 * Math.sin(t * 2.0 + 1));
    }
    // 目标在相机背后时隐藏名牌
    if (labelRef.current && groupRef.current) {
      forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
      dir.copy(groupRef.current.position).normalize();
      const facing = dir.dot(forward);
      labelRef.current.style.opacity = showLabels && facing > 0.15 ? '1' : '0';
    }
  });

  if (!target) return null;

  // 名牌副标题：恒星沿用英文名；非恒星追加类型中文（行星/星系/星云/星团…）
  const subtitle =
    target.type === 'star' ? target.nameEn : `${target.nameEn} · ${kindLabelZh(target)}`;

  return (
    <group ref={groupRef} position={position}>
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
          style={{ transform: `translateY(${-54 * scale}px)` }}
        >
          <div className="text-[15px] font-medium tracking-wide text-white drop-shadow-[0_0_10px_rgba(120,140,255,0.9)]">
            {target.nameZh}
          </div>
          <div className="text-[11px] uppercase tracking-[0.28em] text-nebula-200/80">
            {subtitle}
          </div>
        </div>
      </Html>
    </group>
  );
}
