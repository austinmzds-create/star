'use client';

import { getMoonPhase } from '@star/astro-ephem';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { PLANET_ASSETS } from '@/lib/planetAssets';

/**
 * 行星球体（3D 查看器内核）：球 + 贴图/纯色降级 + 恒速自转 + 光照。
 *
 *  - 太阳：MeshBasicMaterial 自发光 + 辉光 sprite（径向渐变 canvas，
 *    AdditiveBlending，透明度随时间正弦微脉动，useFrame 直写材质零 React 更新）。
 *  - 月球：方向光按当前月相角摆位（§光照约定见下），环境光压到 0.06
 *    让明暗界线锐利——初始视角亮面方向与信息卡月相文案一致。
 *  - 土星：真实内外径比例的环（RingGeometry 1.24–2.27），SSS 环贴图为
 *    径向条带 → UV 重映射为「距离 → u」；环挂倾轴组内、自转 mesh 外。
 *
 * 光照坐标约定：相机初始在 +Z 看向原点。月相角 φ（0 新月 / 90 上弦右亮 /
 * 180 满月 / 270 下弦），太阳方向 L = (sin φ, 0, −cos φ)：φ=0 光从背后
 * （全暗）、φ=90 光从右侧（右亮=盈，与 PlanetsLayer.drawMoonPhase 一致）、
 * φ=180 光从相机方向（全亮）。光摆世界系：modal 拖转可绕到明暗界线。
 */

/** 土星环内半径（球半径=1）。 */
const RING_INNER = 1.24;
/** 土星环外半径。 */
const RING_OUTER = 2.27;

/** 太阳辉光纹理：径向渐变（复用 PlanetsLayer 手法）。 */
function makeSunGlowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,244,214,0.9)');
  g.addColorStop(0.35, 'rgba(255,232,180,0.35)');
  g.addColorStop(0.7, 'rgba(255,220,150,0.1)');
  g.addColorStop(1, 'rgba(255,215,140,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 土星环几何：RingGeometry + UV 重映射（u = 归一化半径，v = 0.5）。 */
function makeRingGeometry(): THREE.RingGeometry {
  const geo = new THREE.RingGeometry(RING_INNER, RING_OUTER, 128);
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    uv.setXY(i, (v.length() - RING_INNER) / (RING_OUTER - RING_INNER), 0.5);
  }
  return geo;
}

export interface PlanetMeshProps {
  /** 星历 uid（EPH-*）。 */
  uid: string;
  /** 形态：inline 低分段 / modal 高分段。 */
  variant: 'inline' | 'modal';
  /** 观测时刻（月相光照方向用）；null → Date.now()。 */
  observeTimeMs: number | null;
  /** 球面贴图（null = 加载中/失败 → fallbackColor 纯色球）。 */
  tex: THREE.Texture | null;
  /** 土星环贴图（null → 不渲染环，球体照常）。 */
  ringTex: THREE.Texture | null;
}

export function PlanetMesh({ uid, variant, observeTimeMs, tex, ringTex }: PlanetMeshProps) {
  const asset = PLANET_ASSETS[uid];
  const isSun = uid === 'EPH-SUN';
  const isMoon = uid === 'EPH-MOON';
  const spinRef = useRef<THREE.Mesh>(null);
  const glowMatRef = useRef<THREE.SpriteMaterial>(null);

  // 太阳辉光纹理（仅太阳创建，卸载释放；不进 LRU——canvas 生成非下载资产）
  const glowTex = useMemo(() => (isSun ? makeSunGlowTexture() : null), [isSun]);
  useEffect(() => {
    return () => {
      glowTex?.dispose();
    };
  }, [glowTex]);

  // 土星环几何（自定义 UV，手动管理生命周期）
  const ringGeo = useMemo(() => (uid === 'EPH-SATURN' ? makeRingGeometry() : null), [uid]);
  useEffect(() => {
    return () => {
      ringGeo?.dispose();
    };
  }, [ringGeo]);

  // 光照：低频 useMemo（observeTime 变化才重算月光方向），不触碰每帧 React
  const light = useMemo<{
    ambient: number;
    dir: [number, number, number] | null;
    intensity: number;
  }>(() => {
    if (isSun) return { ambient: 0.9, dir: null, intensity: 0 };
    if (isMoon) {
      const phi =
        (getMoonPhase(new Date(observeTimeMs ?? Date.now())).phaseAngleDeg * Math.PI) / 180;
      return {
        ambient: 0.06,
        dir: [Math.sin(phi) * 10, 0, -Math.cos(phi) * 10],
        intensity: 2.2,
      };
    }
    // 行星：不追真实相位，固定美观光（初始视角约 3/4 受光）
    return { ambient: 0.12, dir: [3, 1, 2.5], intensity: 1.8 };
  }, [isSun, isMoon, observeTimeMs]);

  // 恒速自转 + 太阳辉光脉动：直写 three 对象，零 React 更新
  useFrame((state, delta) => {
    if (spinRef.current && asset) {
      spinRef.current.rotation.y += delta * 0.15 * asset.spinPeriodSign;
    }
    if (glowMatRef.current) {
      glowMatRef.current.opacity = 0.72 + Math.sin(state.clock.elapsedTime * 1.6) * 0.05;
    }
  });

  if (!asset) return null;

  const widthSegs = variant === 'modal' ? 64 : 48;
  const heightSegs = variant === 'modal' ? 48 : 32;
  const tiltRad = (asset.axialTiltDeg * Math.PI) / 180;
  // 贴图就绪 → 白色不染色；未就绪/失败 → 降级纯色球（无闪白）
  const color = tex ? '#ffffff' : asset.fallbackColor;

  return (
    <>
      <ambientLight intensity={light.ambient} />
      {light.dir && <directionalLight position={light.dir} intensity={light.intensity} />}
      <group rotation-z={tiltRad}>
        <mesh ref={spinRef}>
          <sphereGeometry args={[1, widthSegs, heightSegs]} />
          {isSun ? (
            // key 强制在「有图/无图」间重建材质，规避 map 增删的 needsUpdate 坑
            <meshBasicMaterial key={tex ? 'map' : 'flat'} map={tex ?? undefined} color={color} />
          ) : (
            <meshStandardMaterial
              key={tex ? 'map' : 'flat'}
              map={tex ?? undefined}
              color={color}
              roughness={1}
              metalness={0}
            />
          )}
        </mesh>
        {ringGeo && ringTex && (
          // Basic 而非 Standard：避免环背光面全黑；环不随球面自转
          <mesh geometry={ringGeo} rotation-x={-Math.PI / 2}>
            <meshBasicMaterial
              map={ringTex}
              transparent
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        )}
      </group>
      {isSun && glowTex && (
        <sprite scale={[2.6, 2.6, 1]}>
          <spriteMaterial
            ref={glowMatRef}
            map={glowTex}
            color="#ffe9b8"
            transparent
            opacity={0.72}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      )}
    </>
  );
}
