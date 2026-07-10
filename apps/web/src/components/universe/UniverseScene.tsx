'use client';

import { Canvas } from '@react-three/fiber';
import { Suspense, useMemo } from 'react';
import { buildCatalogRenderData, generateAmbientField } from '@/lib/universe';
import { CameraRig } from './CameraRig';
import { SpaceBackdrop } from './SpaceBackdrop';
import { TargetHighlight } from './TargetHighlight';
import { TwinkleStars } from './TwinkleStars';

/** 全屏沉浸式宇宙场景。 */
export function UniverseScene() {
  const catalog = useMemo(() => buildCatalogRenderData(), []);
  const ambient = useMemo(() => generateAmbientField(), []);

  return (
    <Canvas
      flat
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      camera={{ position: [0, 0, 0], fov: 60, near: 0.1, far: 4000 }}
      style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
    >
      <color attach="background" args={['#03040a']} />
      <Suspense fallback={null}>
        <SpaceBackdrop />
        {/* 程序化环境星场：营造铺满宇宙的氛围 */}
        <TwinkleStars attributes={ambient} twinkle={0.85} sizeScale={1} renderOrder={0} />
        {/* 精选真实星表：可搜索、可点击、可命名 */}
        <TwinkleStars attributes={catalog} twinkle={0.35} sizeScale={1.15} renderOrder={1} />
        <TargetHighlight />
      </Suspense>
      <CameraRig catalog={catalog} />
    </Canvas>
  );
}
