'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { getExternalPose, releaseCamera } from '@/lib/cameraBus';
import { getConstellationRenderData } from '@/lib/constellation-render';
import { isCoarsePointer } from '@/lib/device';
import { getHover, setHover } from '@/lib/hoverBus';
import { ensureStaticEntries, pickEntries, resolveObjectPosition } from '@/lib/pickRegistry';
import { useUniverse } from '@/lib/store';
import { directionToYawPitch } from '@/lib/universe';

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
  /** 可选 FOV 同步插值（搜索星座时把视野缓回 60° 看全貌）。 */
  fromFov?: number;
  toFov?: number;
}

/**
 * 相机位于天球中心，向外环视。负责：
 * 拖拽环视、滚轮缩放（改 FOV）、自动缓慢旋转、点击拾取天体、以及镜头飞向目标。
 *
 * 拾取与飞行统一走 lib/pickRegistry：恒星 + 深空天体 + 行星日月一张表，
 * 行星坐标是星历注册表的同一 Vector3 引用——点击/飞行时刻读到的一定是
 * 当前 observeTime 的位置，无需现算。
 */
export function CameraRig() {
  const { camera, gl } = useThree();
  const selectedUid = useUniverse((s) => s.selectedUid);
  const focusNonce = useUniverse((s) => s.focusNonce);
  const resetNonce = useUniverse((s) => s.resetNonce);
  const autoRotate = useUniverse((s) => s.autoRotate);
  const selectStar = useUniverse((s) => s.selectStar);
  const constellationFocusNonce = useUniverse((s) => s.constellationFocusNonce);
  const clearPinnedConstellation = useUniverse((s) => s.clearPinnedConstellation);

  const yaw = useRef(0.7);
  const pitch = useRef(0.12);
  const dragging = useRef(false);
  const moved = useRef(false);
  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;
  /** 悬停拾取节流时间戳（V3-D：70ms 一次，与点击拾取同量级 <2ms）。 */
  const lastHoverPick = useRef(0);

  const fly = useRef<FlyState>({
    active: false,
    fromYaw: 0,
    fromPitch: 0,
    toYaw: 0,
    toPitch: 0,
    t: 0,
    dur: 1.25,
  });

  // 初始化相机 + 拾取表（幂等）
  useEffect(() => {
    ensureStaticEntries();
    const cam = camera as THREE.PerspectiveCamera;
    cam.rotation.order = 'YXZ';
    cam.position.set(0, 0, 0);
    cam.fov = 60;
    cam.near = 0.1;
    cam.far = 4000;
    cam.updateProjectionMatrix();
  }, [camera]);

  // 触发镜头飞行到选中天体（行星取星历实时坐标）
  useEffect(() => {
    if (!selectedUid) return;
    const vec = resolveObjectPosition(selectedUid);
    if (!vec) return;
    releaseCamera(); // 镜头飞行优先：抢占陀螺仪等外部驱动
    const target = directionToYawPitch(vec);
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
    setHover(null); // 镜头飞行期间屏幕投影失效，清掉悬停名牌
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce, selectedUid]);

  // 搜索星座 → 镜头飞向星座质心；FOV 缩得很小时同步缓回 60° 看全貌
  useEffect(() => {
    if (constellationFocusNonce === 0) return;
    const abbr = useUniverse.getState().activeConstellation;
    if (!abbr) return;
    const info = getConstellationRenderData().byAbbr.get(abbr);
    if (!info) return;
    releaseCamera(); // 搜索星座飞行同样抢占外部驱动
    const cam = camera as THREE.PerspectiveCamera;
    const target = directionToYawPitch(info.centroid);
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
      ...(cam.fov < 45 ? { fromFov: cam.fov, toFov: 60 } : {}),
    };
    setHover(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [constellationFocusNonce]);

  // 回到全景：复位 FOV，停止飞行（顺带退出陀螺仪等外部驱动）
  useEffect(() => {
    if (resetNonce === 0) return;
    releaseCamera();
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
    // 触屏（粗指针）设备：整条 hover 管线不启用（无悬停语义，省电省算）
    const coarse = isCoarsePointer();

    /**
     * 统一拾取（渲染设计 §2.3）：遍历 pickEntries 投影到屏幕，
     * 命中半径内 score = 像素距离 - 类型 bias（行星 > 著名 DSO > DSO >
     * 亮星 > 暗星），取最小者。≈9500 次 project 仅事件时刻执行，<2ms。
     * radiusScale：点击 1.0；悬停 0.75（半径略小，减少擦边误报）。
     */
    const pickAt = (clientX: number, clientY: number, radiusScale: number): string | null => {
      const rect = el.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const v = new THREE.Vector3();
      let bestUid: string | null = null;
      let bestScore = Infinity;
      for (const entry of pickEntries) {
        v.copy(entry.vec).project(cam);
        if (v.z > 1) continue; // 背面剔除
        const sx = (v.x * 0.5 + 0.5) * rect.width;
        const sy = (-v.y * 0.5 + 0.5) * rect.height;
        const d = Math.hypot(sx - px, sy - py);
        if (d >= entry.radiusPx * radiusScale) continue;
        const score = d - entry.bias;
        if (score < bestScore) {
          bestScore = score;
          bestUid = entry.uid;
        }
      }
      return bestUid;
    };

    /** 清空悬停名牌并复原光标。 */
    const clearHover = () => {
      setHover(null);
      el.style.cursor = '';
    };

    const onDown = (e: PointerEvent) => {
      releaseCamera(); // 手势互斥：用户一摸屏幕即退出陀螺仪指星，相机停留当前朝向
      dragging.current = true;
      moved.current = false;
      clearHover(); // 开始拖拽/点击即收起名牌
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) {
        // ── 悬停识别（V3-D）：70ms 节流拾取；节流间隙只挪坐标保持跟手 ──
        if (coarse) return;
        const now = performance.now();
        if (now - lastHoverPick.current >= 70 && !fly.current.active) {
          lastHoverPick.current = now;
          const uid = pickAt(e.clientX, e.clientY, 0.75);
          // 命中当前选中天体时不显示名牌（信息卡已在展示）
          const sel = useUniverse.getState().selectedUid;
          const shown = uid && uid !== sel ? uid : null;
          setHover(shown, e.clientX, e.clientY);
          el.style.cursor = uid ? 'pointer' : '';
        } else if (getHover().uid) {
          setHover(getHover().uid, e.clientX, e.clientY);
        }
        return;
      }
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2 && !moved.current) {
        moved.current = true;
        // 用户一拖动即解除星座钉住态，注视判定重新接管。
        clearPinnedConstellation();
      }
      fly.current.active = false;
      yaw.current -= e.movementX * sens();
      pitch.current -= e.movementY * sens();
      pitch.current = THREE.MathUtils.clamp(pitch.current, -PITCH_LIMIT, PITCH_LIMIT);
    };
    const onUp = (e: PointerEvent) => {
      if (dragging.current && !moved.current) selectStar(pickAt(e.clientX, e.clientY, 1));
      dragging.current = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      clearHover(); // FOV 变化后旧投影失效
      cam.fov = THREE.MathUtils.clamp(cam.fov + e.deltaY * 0.03, 22, 72);
      cam.updateProjectionMatrix();
    };
    const onLeave = () => clearHover();

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('wheel', onWheel);
      clearHover();
    };
  }, [gl, camera, selectStar, clearPinnedConstellation]);

  useFrame((_, delta) => {
    const cam = camera as THREE.PerspectiveCamera;
    if (fly.current.active) {
      fly.current.t += delta / fly.current.dur;
      const e = easeInOutCubic(Math.min(fly.current.t, 1));
      yaw.current = lerp(fly.current.fromYaw, fly.current.toYaw, e);
      pitch.current = lerp(fly.current.fromPitch, fly.current.toPitch, e);
      if (fly.current.fromFov !== undefined && fly.current.toFov !== undefined) {
        cam.fov = lerp(fly.current.fromFov, fly.current.toFov, e);
        cam.updateProjectionMatrix();
      }
      if (fly.current.t >= 1) fly.current.active = false;
    } else if (getExternalPose().active) {
      // 陀螺仪等外部驱动（gyro 模块已做低通平滑，直写）
      const ext = getExternalPose();
      yaw.current = ext.yaw;
      pitch.current = ext.pitch;
    } else if (autoRotateRef.current && !dragging.current) {
      yaw.current += delta * 0.018;
    }
    pitch.current = THREE.MathUtils.clamp(pitch.current, -PITCH_LIMIT, PITCH_LIMIT);
    cam.rotation.set(pitch.current, yaw.current, 0);
  });

  return null;
}
