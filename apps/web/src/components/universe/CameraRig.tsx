'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useUniverse } from '@/lib/store';
import { directionToYawPitch, type CatalogRenderData } from '@/lib/universe';

const PITCH_LIMIT = THREE.MathUtils.degToRad(85);

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

interface FlyState {
  active: boolean;
  fromYaw: number;
  fromPitch: number;
  toYaw: number;
  toPitch: number;
  t: number;
  dur: number;
}

/**
 * 相机位于天球中心，向外环视。负责：
 * 拖拽环视、滚轮缩放（改 FOV）、自动缓慢旋转、点击拾取星体、以及镜头飞向目标星。
 */
export function CameraRig({ catalog }: { catalog: CatalogRenderData }) {
  const { camera, gl } = useThree();
  const selectedUid = useUniverse((s) => s.selectedUid);
  const focusNonce = useUniverse((s) => s.focusNonce);
  const resetNonce = useUniverse((s) => s.resetNonce);
  const autoRotate = useUniverse((s) => s.autoRotate);
  const selectStar = useUniverse((s) => s.selectStar);

  const yaw = useRef(0.7);
  const pitch = useRef(0.12);
  const dragging = useRef(false);
  const moved = useRef(false);
  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;

  const fly = useRef<FlyState>({
    active: false,
    fromYaw: 0,
    fromPitch: 0,
    toYaw: 0,
    toPitch: 0,
    t: 0,
    dur: 1.25,
  });

  // 初始化相机
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.rotation.order = 'YXZ';
    cam.position.set(0, 0, 0);
    cam.fov = 60;
    cam.near = 0.1;
    cam.far = 4000;
    cam.updateProjectionMatrix();
  }, [camera]);

  // 触发镜头飞行到选中的星
  useEffect(() => {
    if (!selectedUid) return;
    const idx = catalog.objects.findIndex((o) => o.objectUid === selectedUid);
    if (idx < 0) return;
    const target = directionToYawPitch(catalog.vectors[idx]!);
    let toYaw = target.yaw;
    while (toYaw - yaw.current > Math.PI) toYaw -= Math.PI * 2;
    while (toYaw - yaw.current < -Math.PI) toYaw += Math.PI * 2;
    fly.current = {
      active: true,
      fromYaw: yaw.current,
      fromPitch: pitch.current,
      toYaw,
      toPitch: target.pitch,
      t: 0,
      dur: 1.25,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce, selectedUid]);

  // 回到全景：复位 FOV，停止飞行
  useEffect(() => {
    if (resetNonce === 0) return;
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = 60;
    cam.updateProjectionMatrix();
    fly.current.active = false;
    pitch.current = 0.12;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce]);

  // 指针与滚轮交互
  useEffect(() => {
    const el = gl.domElement;
    const cam = camera as THREE.PerspectiveCamera;
    const sens = () => 0.0023 * (cam.fov / 60);

    const pick = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const v = new THREE.Vector3();
      let bestIdx = -1;
      let bestDist = 30;
      for (let i = 0; i < catalog.vectors.length; i++) {
        v.copy(catalog.vectors[i]!).project(cam);
        if (v.z > 1) continue;
        const sx = (v.x * 0.5 + 0.5) * rect.width;
        const sy = (-v.y * 0.5 + 0.5) * rect.height;
        const d = Math.hypot(sx - px, sy - py);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) selectStar(catalog.objects[bestIdx]!.objectUid);
      else selectStar(null);
    };

    const onDown = (e: PointerEvent) => {
      dragging.current = true;
      moved.current = false;
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) moved.current = true;
      fly.current.active = false;
      yaw.current -= e.movementX * sens();
      pitch.current -= e.movementY * sens();
      pitch.current = THREE.MathUtils.clamp(pitch.current, -PITCH_LIMIT, PITCH_LIMIT);
    };
    const onUp = (e: PointerEvent) => {
      if (dragging.current && !moved.current) pick(e.clientX, e.clientY);
      dragging.current = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cam.fov = THREE.MathUtils.clamp(cam.fov + e.deltaY * 0.03, 22, 72);
      cam.updateProjectionMatrix();
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
    };
  }, [gl, camera, catalog, selectStar]);

  useFrame((_, delta) => {
    const cam = camera as THREE.PerspectiveCamera;
    if (fly.current.active) {
      fly.current.t += delta / fly.current.dur;
      const e = easeInOutCubic(Math.min(fly.current.t, 1));
      yaw.current = lerp(fly.current.fromYaw, fly.current.toYaw, e);
      pitch.current = lerp(fly.current.fromPitch, fly.current.toPitch, e);
      if (fly.current.t >= 1) fly.current.active = false;
    } else if (autoRotateRef.current && !dragging.current) {
      yaw.current += delta * 0.018;
    }
    pitch.current = THREE.MathUtils.clamp(pitch.current, -PITCH_LIMIT, PITCH_LIMIT);
    cam.rotation.set(pitch.current, yaw.current, 0);
  });

  return null;
}
