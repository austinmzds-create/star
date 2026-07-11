'use client';

import { Canvas } from '@react-three/fiber';
import { Suspense, useMemo } from 'react';
import { getDeviceTier } from '@/lib/deviceTier';
import { ensureStaticEntries } from '@/lib/pickRegistry';
import { buildCatalogRenderData, generateAmbientField } from '@/lib/universe';
import { CameraRig } from './CameraRig';
import { ConstellationLayer } from './ConstellationLayer';
import { DeepSkyLayer } from './DeepSkyLayer';
import { EphemDriver } from './EphemDriver';
import { ExtendedStars } from './ExtendedStars';
import { PlanetsLayer } from './PlanetsLayer';
import { SpaceBackdrop } from './SpaceBackdrop';
import { TargetHighlight } from './TargetHighlight';
import { TwinkleStars } from './TwinkleStars';

/**
 * 全屏沉浸式宇宙场景（宇宙 V2 分层渲染）。
 *
 * 层级（renderOrder 由低到高）：
 *  0 天穹渐变 + 假星云氛围（SpaceBackdrop，已下调让位真实 DSO）
 *  0 程序化环境星场（背景 3000 + 银河带 5000）
 *  1 核心真实星场（mag≤6.5，≈9000 颗，单 draw call）
 *  1 扩展星场（mag 6.5–7.5，≈1.7 万，空闲懒加载，不参与拾取）
 *  1.5/2/4 星座层（艺术图切平面 / 88 座连线单 draw call / 名称 Sprite，开关整层卸载）
 *  2 深空天体（OpenNGC 574 个，按类型 3 组 Points）
 *  8 行星日月（星历实时位置，9 体 sprite）
 *  9 选中高亮
 *
 * 帧循环纪律：useFrame 内无 zustand set、无 Vector3 分配、无 attribute 重建；
 * 行星位置只在 ephemRegistry.version 变化时搬运。
 */
export function UniverseScene() {
  const tier = useMemo(() => getDeviceTier(), []);
  const catalog = useMemo(() => buildCatalogRenderData(), []);
  const ambient = useMemo(
    // 低端设备环境星场减半（1500 + 2500）
    () => (tier === 'low' ? generateAmbientField(1500, 2500) : generateAmbientField()),
    [tier],
  );
  // 统一拾取表（恒星 + DSO + 行星）：启动时构建一次
  useMemo(() => ensureStaticEntries(), []);

  return (
    <Canvas
      flat
      dpr={tier === 'low' ? [1, 1.5] : [1, 2]}
      gl={{ antialias: tier !== 'low', alpha: false, powerPreference: 'high-performance' }}
      camera={{ position: [0, 0, 0], fov: 60, near: 0.1, far: 4000 }}
      style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
    >
      <color attach="background" args={['#03040a']} />
      <Suspense fallback={null}>
        <SpaceBackdrop blobCount={tier === 'low' ? 2 : undefined} />
        {/* 程序化环境星场：营造铺满宇宙的氛围 */}
        <TwinkleStars attributes={ambient} twinkle={0.85} sizeScale={1} renderOrder={0} />
        {/* 核心真实星表（mag≤6.5）：可搜索、可点击、可命名 */}
        <TwinkleStars attributes={catalog} twinkle={0.35} sizeScale={1.15} renderOrder={1} />
        {/* 扩展星场（mag 6.5–7.5）：空闲懒加载，纯渲染层 */}
        <ExtendedStars tier={tier} />
        {/* 深空天体：Messier 全量 + 亮 NGC/IC */}
        <DeepSkyLayer />
        {/* 星座层：88 座连线依次点亮 + 中文名淡入 + 20 幅自绘艺术图 */}
        <ConstellationLayer />
        {/* 行星日月：observeTime 驱动的星历实时位置 */}
        <PlanetsLayer tier={tier} />
        <TargetHighlight />
      </Suspense>
      <EphemDriver />
      <CameraRig />
    </Canvas>
  );
}
