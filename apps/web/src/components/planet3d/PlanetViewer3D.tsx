'use client';

import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { Component, useEffect, useRef, type ComponentRef, type ReactNode } from 'react';
import { PLANET_ASSETS, usePlanetTexture } from '@/lib/planetAssets';
import { PlanetMesh } from './PlanetMesh';

/**
 * 行星 3D 查看器核心：独立 R3F Canvas，inline / modal 双形态。
 *
 * 性能矩阵（红线：主场景 60fps 不受影响，GL 上下文任意时刻 ≤2）：
 *  - inline：dpr=1、demand + 24fps 定时 invalidate、48×32 段、无抗锯齿、
 *    low-power、无控制器（纯自转，整块点击展开由上层负责）。
 *  - modal：dpr [1,2]、always、64×48 段、抗锯齿、high-performance、
 *    OrbitControls（拖拽/缩放/阻尼，用户接管后停自动旋转）。
 *
 * uid 切换不重挂 Canvas（Canvas 无 key），PlanetMesh 依 uid 换纹理/材质，
 * 避免频繁创建 GL 上下文。贴图加载失败 → 纯色球 + 卡内小字提示。
 */

export interface PlanetViewer3DProps {
  /** 星历 uid（调用方已保证 isEphemeris）。 */
  uid: string;
  variant: 'inline' | 'modal';
  /** store.observeTime 透传（月相光照）。 */
  observeTimeMs: number | null;
  /** WebGL 上下文创建失败/渲染树抛错时回调（上层换占位块）。 */
  onGlError?: () => void;
}

/** inline 低帧驱动：demand 模式下按固定 fps 定时 invalidate。 */
function DemandInvalidator({ fps }: { fps: number }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const id = window.setInterval(() => invalidate(), 1000 / fps);
    return () => window.clearInterval(id);
  }, [invalidate, fps]);
  return null;
}

/** Canvas 渲染错误边界：WebGL 创建失败等 → 静默降级，不白屏。 */
class CanvasErrorBoundary extends Component<
  { onError?: () => void; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(): void {
    this.props.onError?.();
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="flex h-full w-full items-center justify-center text-[12px] text-nebula-200/50">
          无法创建 3D 视图
        </div>
      );
    }
    return this.props.children;
  }
}

export function PlanetViewer3D({ uid, variant, observeTimeMs, onGlError }: PlanetViewer3DProps) {
  const asset = PLANET_ASSETS[uid];
  const { tex, status } = usePlanetTexture(asset?.textureUrl);
  // 非土星 ringTextureUrl 为 undefined → 恒 null，不渲染环
  const { tex: ringTex } = usePlanetTexture(asset?.ringTextureUrl);
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const isModal = variant === 'modal';

  return (
    <div className="relative h-full w-full">
      <CanvasErrorBoundary onError={onGlError}>
        <Canvas
          dpr={isModal ? [1, 2] : 1}
          frameloop={isModal ? 'always' : 'demand'}
          camera={{ fov: 40, position: [0, 0, 3.2] }}
          gl={{
            antialias: isModal,
            powerPreference: isModal ? 'high-performance' : 'low-power',
            alpha: true,
          }}
        >
          {!isModal && <DemandInvalidator fps={24} />}
          <PlanetMesh
            uid={uid}
            variant={variant}
            observeTimeMs={observeTimeMs}
            tex={status === 'ready' ? tex : null}
            ringTex={ringTex}
          />
          {isModal && (
            <OrbitControls
              ref={controlsRef}
              enablePan={false}
              enableDamping
              minDistance={1.6}
              maxDistance={6}
              autoRotate
              autoRotateSpeed={0.6}
              onStart={() => {
                // 用户接管后不再抢镜头
                const c = controlsRef.current;
                if (c) c.autoRotate = false;
              }}
            />
          )}
        </Canvas>
      </CanvasErrorBoundary>

      {/* 加载中：CSS spinner（球体此时为纯色，无闪白） */}
      {status === 'loading' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-nebula-300/30 border-t-nebula-200/90" />
        </div>
      )}

      {/* 贴图失败：降级提示小字 */}
      {status === 'error' && (
        <div className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-nebula-200/45">
          贴图加载失败，展示示意色
        </div>
      )}
    </div>
  );
}
