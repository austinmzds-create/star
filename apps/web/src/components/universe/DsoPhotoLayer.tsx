'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { raDecToVector3 } from '@star/astro-core';
import {
  DSO_PHOTOS,
  LOW_TIER_PHOTO_COUNT,
  loadDsoPhotoTexture,
  markDsoPhotoShown,
  type DsoPhotoMeta,
} from '@/lib/dso-photos';
import { getDeviceTier } from '@/lib/deviceTier';
import { SPHERE_RADIUS } from '@/lib/universe';

/**
 * 著名 DSO 真实照片层（宇宙 V3-B）：≤16 个 Messier 天体的真实天文照片，
 * 复用 ConstellationArtPlane 的「切平面锚死天球」管线 —— lookAt 球心 +
 * rollDeg，随视角转动不漂移（billboard Sprite 会漂）。
 *
 * 加载策略：首帧后 requestIdleCallback 启动，每张再按序错峰 ~180ms，
 * 避免 16 个解码/上传挤在同一帧。单张加载成功 → markDsoPhotoShown(uid)，
 * DeepSkyLayer 收到后把该天体的程序 sprite 淡出（aPhotoHide）；加载失败
 * → 该天体静默保持程序 sprite，互不阻塞。
 *
 * 拾取/高亮零改动：拾取仍走 pickRegistry（M31 等本就是 dso-featured 条目），
 * TargetHighlight 照常在同一坐标画选中环。
 */

/** 照片切平面半径：略在 DSO 程序点(990)与恒星(1000)之间靠内。 */
const PHOTO_RADIUS = SPHERE_RADIUS * 0.992;
/** 单张淡入时长（秒）。 */
const FADE_IN_SEC = 1.2;
/** 目标透明度：加色混合下暗背景近乎无贡献，0.88 保住亮部细节。 */
const MAX_OPACITY = 0.88;
/** 相邻两张开始加载的错峰间隔（ms）。 */
const LOAD_STAGGER_MS = 180;

export function DsoPhotoLayer() {
  const tier = useMemo(() => getDeviceTier(), []);
  const metas = useMemo(
    () => (tier === 'low' ? DSO_PHOTOS.slice(0, LOW_TIER_PHOTO_COUNT) : DSO_PHOTOS),
    [tier],
  );
  const [started, setStarted] = useState(false);

  // 首帧后的空闲时机再开始（fallback 2s 定时器），不与首屏抢主线程。
  useEffect(() => {
    let idleId: number | null = null;
    let timerId: number | null = null;
    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(() => setStarted(true), { timeout: 4000 });
    } else {
      timerId = window.setTimeout(() => setStarted(true), 2000);
    }
    return () => {
      if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, []);

  if (!started) return null;

  return (
    <group>
      {metas.map((m, i) => (
        <DsoPhotoPlane key={m.uid} meta={m} delayMs={i * LOAD_STAGGER_MS} />
      ))}
    </group>
  );
}

function DsoPhotoPlane({ meta, delayMs }: { meta: DsoPhotoMeta; delayMs: number }) {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      loadDsoPhotoTexture(meta.imageKey)
        .then((tex) => {
          if (!alive) return;
          setTexture(tex);
          // 通知 DeepSkyLayer：照片可展示，淡出对应程序 sprite
          markDsoPhotoShown(meta.uid);
        })
        .catch(() => undefined); // 资产缺失：静默保持程序 sprite
    }, delayMs);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [meta.uid, meta.imageKey, delayMs]);

  // 天球锚定：切平面朝向球心，rollDeg 对齐照片拍摄方向（未标定为 0）。
  const { position, quaternion, scale } = useMemo(() => {
    const v = raDecToVector3({ raDeg: meta.raDeg, decDeg: meta.decDeg }, PHOTO_RADIUS);
    const dummy = new THREE.Object3D();
    dummy.position.set(v.x, v.y, v.z);
    dummy.lookAt(0, 0, 0);
    dummy.rotateZ(THREE.MathUtils.degToRad(meta.rollDeg));
    const w = 2 * PHOTO_RADIUS * Math.tan(THREE.MathUtils.degToRad(meta.sizeDeg / 2));
    return {
      position: dummy.position.clone(),
      quaternion: dummy.quaternion.clone(),
      scale: new THREE.Vector3(w, w, 1), // canvas 已 cover 裁成正方形
    };
  }, [meta]);

  // 淡入（与程序 sprite 的淡出同步发生，视觉上是「照片浮现替换光斑」）
  useFrame((_, delta) => {
    const mat = matRef.current;
    if (!mat || mat.opacity >= MAX_OPACITY) return;
    mat.opacity = Math.min(MAX_OPACITY, mat.opacity + (delta / FADE_IN_SEC) * MAX_OPACITY);
  });

  if (!texture) return null;

  return (
    <mesh
      position={position}
      quaternion={quaternion}
      scale={scale}
      renderOrder={1.9}
      frustumCulled={false}
    >
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        ref={matRef}
        map={texture}
        transparent
        opacity={0}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
