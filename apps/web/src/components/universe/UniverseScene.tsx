'use client';

import { Canvas } from '@react-three/fiber';
import { lazy, Suspense, useMemo } from 'react';
import * as THREE from 'three';
import { getDeviceTier } from '@/lib/deviceTier';
import { ensureStaticEntries } from '@/lib/pickRegistry';
import { useUniverse } from '@/lib/store';
import { buildCatalogRenderData, generateAmbientField } from '@/lib/universe';
import { CameraRig } from './CameraRig';
import { ClusterSprinkleLayer } from './ClusterLayer';
import { ConstellationLayer } from './ConstellationLayer';
import { DeepSkyLayer } from './DeepSkyLayer';
import { DsoPhotoLayer } from './DsoPhotoLayer';
import { EphemDriver } from './EphemDriver';
import { ExtendedStars } from './ExtendedStars';
import { GridLayer } from './GridLayer';
import { HorizonLayer } from './HorizonLayer';
import { MilkyWayLayer } from './MilkyWayLayer';
import { PlanetsLayer } from './PlanetsLayer';
import { PlanetTrailLayer } from './PlanetTrailLayer';
import { SpaceBackdrop } from './SpaceBackdrop';
import { TargetHighlight } from './TargetHighlight';
import { TwinkleStars } from './TwinkleStars';

// 动态天体层（Phase 6B 目标 7/8）：默认关，首次开启开关才下载对应异步 chunk。
// satellite.js 只被 SatellitesLayer 的 chunk 引用——首屏 bundle 零增量。
const SatellitesLayer = lazy(() =>
  import('./SatellitesLayer').then((m) => ({ default: m.SatellitesLayer })),
);
const MinorBodiesLayer = lazy(() =>
  import('./MinorBodiesLayer').then((m) => ({ default: m.MinorBodiesLayer })),
);

/**
 * 全屏沉浸式宇宙场景（宇宙 V2 分层渲染）。
 *
 * 层级（renderOrder 由低到高）：
 *  0 天穹渐变 + 假星云氛围（SpaceBackdrop，V3 已降至几不可察）
 *  0.5 真实银河全景（MilkyWayLayer，NASA SVS Starmap 2020，懒加载；V4 起
 *      高档另挂程序化薄雾辉光带，1–2 draw call）
 *  0 程序化环境星场（背景 3000 + 银河带 5000）
 *  1 核心真实星场（mag≤6.5，≈9000 颗，单 draw call）
 *  1 扩展星场（mag 6.5–7.5，≈1.7 万，空闲懒加载，不参与拾取）
 *  1.5/2/4 星座层（艺术图切平面 / 88 座连线单 draw call / 名称 Sprite，开关整层卸载）
 *  1.9 著名 DSO 真实照片（≤16 张切平面，空闲错峰懒加载，程序 sprite 对应淡出）
 *  1 星团星屑（ClusterSprinkleLayer，V4：cluster DSO 显性化，单 Points 不拾取）
 *  2 深空天体（OpenNGC 574 个，按类型 3 组 Points）
 *  0.5 坐标线/地平线（GridLayer/HorizonLayer 线与方位标，默认关、懒构建）
 *  8 行星日月（星历实时位置，9 体 sprite）
 *  8.5 地平线下半球压暗 + 晨昏色调（HorizonLayer shader 球，showHorizon 开关）
 *  9 选中高亮
 *
 * 帧循环纪律：useFrame 内无 zustand set、无 Vector3 分配、无 attribute 重建；
 * 行星位置只在 ephemRegistry.version 变化时搬运。
 */

/**
 * 星等→像素（宇宙 V4 §1.3 深邃版）：线性 15−2.3m 改指数曲线——亮星更突出、
 * 暗星更收敛（mag0≈15.7px、mag3≈8.0、mag6≈4.7）。
 * 定义在此而非 lib/universe.ts：只重写核心星场的渲染尺寸；ExtendedStars 的
 * 3px 封顶与 lib 侧其它消费方（数值域相近）不受影响。
 */
function magnitudeToSizeDeep(mag: number): number {
  return THREE.MathUtils.clamp(13.5 * Math.exp(-0.28 * mag) + 2.2, 2.6, 21);
}

export function UniverseScene() {
  const tier = useMemo(() => getDeviceTier(), []);
  // 动态天体层开关（低频布尔；层组件本身再做各自的懒加载/注册）
  const showSatellites = useUniverse((s) => s.showSatellites);
  const showMinorBodies = useUniverse((s) => s.showMinorBodies);
  const catalog = useMemo(() => {
    const data = buildCatalogRenderData();
    // V4 深邃：渲染尺寸换指数曲线（objects 与 sizes 同序；一次性重写，非帧循环）
    for (let i = 0; i < data.count; i++) {
      const obj = data.objects[i];
      if (obj) data.sizes[i] = magnitudeToSizeDeep(obj.magnitude);
    }
    return data;
  }, []);
  const ambient = useMemo(
    // 低端设备环境星场减半（1500 + 2500）
    () => (tier === 'low' ? generateAmbientField(1500, 2500) : generateAmbientField()),
    [tier],
  );
  // 统一拾取表（恒星 + DSO + 行星）：启动时构建一次
  useMemo(() => ensureStaticEntries(), []);

  return (
    <>
      <Canvas
        flat
        dpr={tier === 'low' ? [1, 1.5] : [1, 2]}
        gl={{ antialias: tier !== 'low', alpha: false, powerPreference: 'high-performance' }}
        camera={{ position: [0, 0, 0], fov: 60, near: 0.1, far: 4000 }}
        style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
      >
        {/* V4 深邃：底色再压一档（#03040a → #010207），星点对比全靠底黑 */}
        <color attach="background" args={['#010207']} />
        <Suspense fallback={null}>
          <SpaceBackdrop blobCount={tier === 'low' ? 2 : undefined} />
          {/* 真实银河全景：NASA SVS Deep Star Maps 2020（懒加载，失败静默降级） */}
          <MilkyWayLayer />
          {/* 程序化环境星场：营造铺满宇宙的氛围 */}
          <TwinkleStars attributes={ambient} twinkle={0.85} sizeScale={1} renderOrder={0} />
          {/* 核心真实星表（mag≤6.5）：可搜索、可点击、可命名 */}
          <TwinkleStars attributes={catalog} twinkle={0.35} sizeScale={1.15} renderOrder={1} />
          {/* 扩展星场（mag 6.5–7.5）：空闲懒加载，纯渲染层 */}
          <ExtendedStars tier={tier} />
          {/* 深空天体：Messier 全量 + 亮 NGC/IC */}
          <DeepSkyLayer />
          {/* 星团星屑（V4）：cluster DSO 显性化为一小撮星屑，单 Points、不拾取 */}
          <ClusterSprinkleLayer tier={tier} />
          {/* 著名 DSO 真实照片：≤16 张（NASA/ESO/Commons，空闲错峰懒加载） */}
          <DsoPhotoLayer />
          {/* 星座层：88 座连线依次点亮 + 中文名淡入 + 20 幅自绘艺术图 */}
          <ConstellationLayer />
          {/* 行星日月：observeTime 驱动的星历实时位置 */}
          <PlanetsLayer tier={tier} />
          {/* 行星轨迹（6B-6）：选中行星/月亮时的 ±N 天视轨迹（≤2 draw，无选中零几何） */}
          <PlanetTrailLayer />
          {/* 人造卫星（6B-7）：ISS/天宫/哈勃，SGP4 站心实时位置 + 尾迹（懒 chunk，2 draw） */}
          {showSatellites && <SatellitesLayer />}
          {/* 小行星与彗星（6B-8）：谷神/灶神/智神/哈雷，JPL 根数开普勒轨道（懒 chunk，1 draw） */}
          {showMinorBodies && <MinorBodiesLayer />}
          <TargetHighlight />
        </Suspense>
        <EphemDriver />
        {/* 坐标线（V3-F）：黄道 / 天赤道+网格，静态几何，默认关、懒构建 */}
        <GridLayer />
        {/* 观测辅助（V3-F/G）：地平线大圆+方位标+半球压暗+晨昏色调。
          刻意挂在 EphemDriver 之后——同一 commit 内 effect 先后有序，
          读 ephemRegistry 的太阳坐标一定是当次 observeTime 的新鲜值 */}
        <HorizonLayer />
        <CameraRig />
      </Canvas>
      {/* V4 §1.5 轻量 vignette：纯 CSS 覆盖层，零 GL 成本、不占 draw call，
        低端设备保留；pointer-events:none 不挡拾取与手势 */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse 120% 90% at 50% 45%, transparent 58%, rgba(0,1,6,0.30) 100%)',
        }}
      />
    </>
  );
}
