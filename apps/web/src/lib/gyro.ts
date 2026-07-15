/**
 * 陀螺仪指星控制器（Phase 6B 目标 9，移动端 web 版 AR 平替）。
 *
 * 管线（每个 deviceorientation 事件 ~60Hz，全程 <0.05ms 无需节流）：
 *   α/β/γ → deviceOrientationToLookDirection（设备姿态 → 地平 alt/az）
 *        → horizontalToEquatorial（按 store 城市 + 观测时刻 → RA/Dec）
 *        → 天球方向向量 → yaw/pitch（与 CameraRig/directionToYawPitch 同约定）
 *        → 低通平滑 → cameraBus.driveCamera
 *
 * 时间语义：时间机器状态下举手机看到的是「模拟时刻」的星空，行为自洽。
 * 绝对方位：优先 deviceorientationabsolute（Chrome Android）；iOS 用
 * webkitCompassHeading 换算 alpha；两者皆无时退回相对 alpha——指向会有
 * 固定偏差，产品可接受（演示级体验）。
 */
'use client';

import { deviceOrientationToLookDirection, horizontalToEquatorial, raDecToVector3 } from '@star/astro-core';
import { releaseCamera, driveCamera, subscribeCameraRelease } from './cameraBus';
import { isCoarsePointer } from './device';
import { useUniverse } from './store';

export type GyroStartResult = 'ok' | 'denied' | 'unsupported';

/** 与 CameraRig 的 PITCH_LIMIT 一致（±85°）。 */
const PITCH_LIMIT = (85 * Math.PI) / 180;
/** 低通平滑系数。 */
const SMOOTH = 0.15;

/**
 * 模块级单例 Date（GC 纪律：deviceorientation ~60Hz 帧率级触发，禁 new Date）。
 * setTime 后传入 horizontalToEquatorial——内部仅读时刻算恒星时、不持引用，复用安全。
 */
const scratchDate = new Date(0);

/** 是否值得展示「指向天空」入口：粗指针（触屏）且有方向事件 API。桌面自然隐藏。 */
export function isGyroCandidate(): boolean {
  return (
    typeof window !== 'undefined' && isCoarsePointer() && 'DeviceOrientationEvent' in window
  );
}

/** 把角差归一到 (−π, π]，yaw 平滑走最短路径。 */
function wrapPi(x: number): number {
  return ((((x + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
}

// ── 模块级会话状态（同一时刻至多一个陀螺仪会话） ──
let active = false;
let gotEvent = false;
let sawAbsolute = false;
let smInit = false;
let smYaw = 0;
let smPitch = 0;
let noDataTimer: number | undefined;
let unsubRelease: (() => void) | undefined;
let handlerAbs: ((e: DeviceOrientationEvent) => void) | undefined;
let handlerRel: ((e: DeviceOrientationEvent) => void) | undefined;

function handleOrientation(e: DeviceOrientationEvent, absolute: boolean): void {
  if (e.alpha == null || e.beta == null || e.gamma == null) return;
  gotEvent = true;
  if (absolute) sawAbsolute = true;
  else if (sawAbsolute) return; // 已有绝对方位源时忽略相对事件

  // iOS：deviceorientation 的 alpha 为相对原点，用罗盘航向换算成绝对方位。
  let alpha = e.alpha;
  const compass = (e as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
  if (typeof compass === 'number' && Number.isFinite(compass)) alpha = 360 - compass;

  const look = deviceOrientationToLookDirection(alpha, e.beta, e.gamma);

  const s = useUniverse.getState();
  scratchDate.setTime(s.timeFollowsNow ? Date.now() : (s.observeTime ?? Date.now()));
  const eq = horizontalToEquatorial(
    look,
    { latitudeDeg: s.city.latitudeDeg, longitudeDeg: s.city.longitudeDeg },
    scratchDate,
  );

  // 与 lib/universe.directionToYawPitch 同约定：pitch=asin(y)、yaw=atan2(−x,−z)。
  const v = raDecToVector3(eq, 1);
  const targetPitch = Math.asin(Math.max(-1, Math.min(1, v.y)));
  const targetYaw = Math.atan2(-v.x, -v.z);

  if (!smInit) {
    smInit = true;
    smYaw = targetYaw;
    smPitch = targetPitch;
  } else {
    smYaw += SMOOTH * wrapPi(targetYaw - smYaw);
    smPitch += SMOOTH * (targetPitch - smPitch);
  }
  smPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, smPitch));
  driveCamera(smYaw, smPitch);
}

/** 移除监听 / 定时器 / 订阅，不广播（内部用）。 */
function detach(): void {
  if (handlerAbs) window.removeEventListener('deviceorientationabsolute', handlerAbs as EventListener);
  if (handlerRel) window.removeEventListener('deviceorientation', handlerRel);
  handlerAbs = undefined;
  handlerRel = undefined;
  if (noDataTimer !== undefined) {
    window.clearTimeout(noDataTimer);
    noDataTimer = undefined;
  }
  unsubRelease?.();
  unsubRelease = undefined;
  active = false;
}

/**
 * 启动指星模式。必须在用户点击的调用栈内调用（iOS 权限请求约束）。
 * onNoData：监听已挂上但 3 秒无任何传感器事件（部分设备/WebView），
 * 此时已自动退出，回调方按「设备不支持」提示。
 */
export async function startGyro(onNoData?: () => void): Promise<GyroStartResult> {
  if (!isGyroCandidate()) return 'unsupported';

  // iOS 13+：需要在用户手势内请求方向传感器权限。
  const DOE = DeviceOrientationEvent as unknown as {
    requestPermission?: () => Promise<string>;
  };
  if (typeof DOE.requestPermission === 'function') {
    try {
      if ((await DOE.requestPermission()) !== 'granted') return 'denied';
    } catch {
      return 'denied';
    }
  }

  if (active) stopGyro(); // 幂等：清掉上一个会话
  active = true;
  gotEvent = false;
  sawAbsolute = false;
  smInit = false;

  handlerAbs = (e) => handleOrientation(e, true);
  handlerRel = (e) => handleOrientation(e, false);
  // Chrome Android 提供带绝对方位的 deviceorientationabsolute；两个都挂，
  // 收到绝对事件后自动忽略相对事件。
  window.addEventListener('deviceorientationabsolute', handlerAbs as EventListener);
  window.addEventListener('deviceorientation', handlerRel);

  noDataTimer = window.setTimeout(() => {
    noDataTimer = undefined;
    if (!gotEvent && active) {
      stopGyro();
      onNoData?.();
    }
  }, 3000);

  // 拖拽 / 镜头飞行抢占相机（CameraRig 调 releaseCamera）→ 自动退出状态。
  unsubRelease = subscribeCameraRelease(() => {
    detach();
    useUniverse.getState().setGyroActive(false);
  });

  // setGyroActive(true) 内联关闭 autoRotate（见 store）。
  useUniverse.getState().setGyroActive(true);
  return 'ok';
}

/** 退出指星模式：移除监听并释放相机（相机停留在当前朝向）。 */
export function stopGyro(): void {
  if (!active) return;
  detach();
  useUniverse.getState().setGyroActive(false);
  releaseCamera();
}
