'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { getDeviceTier } from '@/lib/deviceTier';
import { useUniverse } from '@/lib/store';

/**
 * 真实银河全景层（宇宙 V3-A）。
 *
 * NASA SVS Deep Star Maps 2020（celestial/赤道坐标 equirectangular，
 * RA=0h 居中、RA 向左增；Gaia DR2 数据，署名见 public/credits.json）
 * 贴在半径 1600 的天球内壁：介于星点层（1000）与天穹渐变（1800）之间，
 * 单 mesh 单 draw call。
 *
 * 资产路径约定（fetch-assets 脚本落盘，本组件不 import 二进制）：
 *   /textures/milkyway/starmap-2020-4k.jpg（高档） / starmap-2020-2k.jpg（低档）
 * 加载失败 → 整层静默降级：generateAmbientField 的程序化银河带仍在。
 *
 * UV 朝向推导（详见宇宙 V3 设计 §2.3）：项目星点约定 x=cosδcosα, y=sinδ,
 * z=−cosδsinα 与 SphereGeometry 参数化联立解得 u_geo = 0.5 + α/360，而图像
 * u_img = 0.5 − α/360，二者互补 —— 只需一次水平翻转（wrapS=Repeat、
 * repeat.x=−1），无需 offset/旋转；v 方向 plate carrée 与 SphereGeometry
 * 天然一致。注意不要再叠 scale=[-1,1,1]（会二次镜像）。
 */

/** 银河天球半径：星点(1000) 与天穹渐变(1800) 之间。 */
const MILKY_RADIUS = 1600;
/** 淡入时长（秒）——首次加载完成后缓缓浮现。 */
const FADE_IN_SEC = 1.5;
/** 淡出时长（秒）——开关关闭时快速隐去。 */
const FADE_OUT_SEC = 0.25;

export function MilkyWayLayer() {
  const showMilkyWay = useUniverse((s) => s.showMilkyWay);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const failedRef = useRef(false);
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  // 低档设备：2k 纹理 + 略低目标透明度
  const tierRef = useRef(getDeviceTier());
  const targetOpacity = tierRef.current === 'low' ? 0.45 : 0.55;

  // 懒加载：首次开启（默认开）才 fetch 纹理；失败静默降级且不再重试。
  useEffect(() => {
    if (!showMilkyWay || texture || failedRef.current) return;
    let alive = true;
    const url =
      tierRef.current === 'low'
        ? '/textures/milkyway/starmap-2020-2k.jpg'
        : '/textures/milkyway/starmap-2020-4k.jpg';
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (tex) => {
        if (!alive) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        // 水平镜像：内壁观看 + 图像 RA 向左增（推导见组件头注释）
        tex.wrapS = THREE.RepeatWrapping;
        tex.repeat.x = -1;
        setTexture(tex);
      },
      undefined,
      () => {
        // 资产缺失/网络失败：无银河层，程序化银河带（AmbientField）仍在
        failedRef.current = true;
      },
    );
    return () => {
      alive = false;
    };
  }, [showMilkyWay, texture]);

  // 卸载时释放纹理
  useEffect(() => {
    return () => {
      texture?.dispose();
    };
  }, [texture]);

  // 透明度插值：开→缓缓淡入，关→快速淡出；淡到 0 后隐藏 mesh 省填充率。
  useFrame((_, delta) => {
    const mat = matRef.current;
    const mesh = meshRef.current;
    if (!mat || !mesh) return;
    const target = showMilkyWay ? targetOpacity : 0;
    const diff = target - mat.opacity;
    if (diff !== 0) {
      const step = delta / (diff > 0 ? FADE_IN_SEC : FADE_OUT_SEC);
      mat.opacity =
        Math.abs(diff) <= step * targetOpacity
          ? target
          : mat.opacity + Math.sign(diff) * step * targetOpacity;
    }
    mesh.visible = mat.opacity > 0.001;
  });

  if (!texture) return null;

  return (
    <mesh ref={meshRef} renderOrder={0.5} frustumCulled={false}>
      <sphereGeometry args={[MILKY_RADIUS, 64, 32]} />
      <meshBasicMaterial
        ref={matRef}
        map={texture}
        side={THREE.BackSide}
        transparent
        opacity={0}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}
