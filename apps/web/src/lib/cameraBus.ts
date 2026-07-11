/**
 * 相机外部驱动总线（Phase 6B 陀螺仪指星）。
 *
 * 沿用 hoverBus 的「模块单例 + 回调」纪律：陀螺仪姿态 ~60Hz 高频更新，
 * 走模块变量零 React；CameraRig 在 useFrame 里每帧读取。
 * 低频的「模式开/关」状态另走 store.gyroActive 供 UI 渲染。
 */

export interface ExternalPose {
  /** 是否有外部驱动者（陀螺仪等）正在接管相机。 */
  active: boolean;
  /** 目标偏航（弧度，与 CameraRig yaw 同约定）。 */
  yaw: number;
  /** 目标俯仰（弧度，调用方需自行钳制 ±85°）。 */
  pitch: number;
}

const pose: ExternalPose = { active: false, yaw: 0, pitch: 0 };
const exitListeners = new Set<() => void>();

/** 外部驱动者写入目标姿态（首次写入即接管相机）。 */
export function driveCamera(yaw: number, pitch: number): void {
  pose.active = true;
  pose.yaw = yaw;
  pose.pitch = pitch;
}

/** CameraRig useFrame 每帧读。 */
export function getExternalPose(): Readonly<ExternalPose> {
  return pose;
}

/**
 * 停止外部驱动并广播。由陀螺仪模块退出、或 CameraRig 在用户拖拽 / 镜头
 * 飞行抢占相机时调用；相机停留在当前朝向，自然衔接。
 */
export function releaseCamera(): void {
  if (!pose.active) return;
  pose.active = false;
  for (const l of exitListeners) l();
}

/** 订阅「外部驱动被释放」（陀螺仪模块借此自动退出状态）。返回退订函数。 */
export function subscribeCameraRelease(l: () => void): () => void {
  exitListeners.add(l);
  return () => {
    exitListeners.delete(l);
  };
}
