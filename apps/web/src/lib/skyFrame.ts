import { localSiderealTime } from '@star/astro-core';
import * as THREE from 'three';

/**
 * 天球旋转参考系（Phase 9B「地平锁定」域；跨域契约 §2——本模块由该域独家
 * 维护，其它渲染层只读 getSkyQuaternion / worldToSkyLocal，不得写入）。
 *
 * 职责：由 observeTime + city 计算「赤道系天球 → 世界系」的旋转四元数。
 * UniverseScene 把全部天空层包进一个 root group，每帧把本四元数写给
 * group.quaternion——时间快进时整个天空绕天极旋转、日月东升西落
 * （Star Walk 核心观感）；free 模式恒等旋转，与既有行为完全一致。
 *
 * 【坐标推导】
 * 世界系约定：天顶=+Y、北点=−Z、东=+X（方位角 az = atan2(x, −z)，北起东正；
 * CameraRig 的 yaw 语义 dirToYaw = atan2(−x, −z)，故 earth 模式下 az = −yaw）。
 * 赤道系沿用 raDecToVector3 约定（+Y=北天极，RA 从 +X 向 −Z 增）。该系中：
 *   天顶 Ẑ = (RA=LST, Dec=纬度)（地平坐标定义即此）；
 *   北点 N̂ = normalize(P − (P·Ẑ)Ẑ)，P=(0,1,0) 为北天极——天极在地平面
 *     （法向 Ẑ）上的投影即正北方向，南北半球同式成立（|纬度|=90° 退化除外）；
 *   东点 Ê = N̂ × Ẑ（ENU 右手系 E×N=U ⇒ N×U=E）。
 * 所求旋转 R 满足 R·Ê=+X、R·Ẑ=+Y、R·N̂=−Z。令 A = [Ê | Ẑ | −N̂]（列向量），
 * 则 A 把世界基 (X,Y,Z) 映到赤道基；A 正交 ⇒ R = Aᵀ，取其四元数即得。
 *
 * 【锚点自证】（scratchpad/verify-skyframe.mjs 实跑核实，2026-07-15）
 *   北京 2026-07-15 21:00 CST（=13:00 UTC，JD 2461237.041667）：
 *     LST = 244.8034° = 16.3202h；
 *   北极星 HIP11767（RA 37.95° / Dec +89.264°）经本四元数投影：
 *     az = 0.429°、alt = 39.247°——北极星距天极 0.736°，绕极小圆日周运动，
 *     理论范围 az ∈ ±0.97°、alt = 39.904°±0.736°，实测值在域内且与
 *     Meeus equatorialToHorizontal 独立解逐位一致；
 *   随机 20 星全向抽查：四元数投影 vs Meeus 公式最大角偏差 4.5e-14°。
 *
 * 【帧纪律】全部对象模块级预分配；tickSkyFrame 内零分配；目标四元数只在
 * observeTime/city/viewMode 变化时重算（播放期 ≤4Hz）；已收敛时 tick 一次
 * 角距比较即返回。播放平滑：4Hz 的目标更新经指数 slerp（λ=12/s）补间成
 * 连续旋转；1周/秒 档单步 >180° 时最短路径会出现「车轮倒转」采样混叠，
 * 与 Star Walk 同现象，属演示级近似（已知不修）。
 */

/** 模式切换（free↔earth）的定时过渡时长（秒），与相机俯仰缓推同步。 */
const MODE_TRANSITION_SEC = 0.8;
/** 播放跟踪的指数逼近率 λ（1/s）：4Hz 目标步进在 ~0.25s 内追平 95%。 */
const TRACK_LAMBDA = 12;
/** 收敛判定角距（rad）：小于此值直接 snap 到目标并休眠。 */
const SETTLE_EPS = 1e-4;

const DEG2RAD = Math.PI / 180;

// ── 模块级状态（预分配，禁帧内分配） ──
/** 当前天球旋转（渲染 group 与拾取读这份；free 模式收敛于恒等）。 */
const qCurrent = new THREE.Quaternion();
/** 目标旋转（setSkyTarget 低频写入）。 */
const qTarget = new THREE.Quaternion();
/** qCurrent 的逆（worldToSkyLocal 用；随 qCurrent 同步更新）。 */
const qInverse = new THREE.Quaternion();
/** 模式切换定时过渡的起点。 */
const qFrom = new THREE.Quaternion();

// 目标四元数构造 scratch
const POLE = new THREE.Vector3(0, 1, 0);
const zEq = new THREE.Vector3();
const nEq = new THREE.Vector3();
const eEq = new THREE.Vector3();
const mBasis = new THREE.Matrix4();
const scratchDate = new Date(0);

/** 已收敛标记：true 时 tick 零成本返回。 */
let settled = true;
/** ≥0 表示定时过渡进行中（0→1 归一化进度）；−1 为指数跟踪常态。 */
let transitionT = -1;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * 重算目标四元数（低频：observeTime/city/viewMode 变化时由 UniverseScene 的
 * 天旋 group 调用；其它域勿调）。mode='free' → 目标恒等。
 * snap=true 时当前值直接跳到目标（首帧/水合场景，不做入场动画）。
 */
export function setSkyTarget(
  mode: 'free' | 'earth',
  timeMs: number,
  latDeg: number,
  lonDeg: number,
  snap = false,
): void {
  if (mode === 'free') {
    qTarget.identity();
  } else {
    scratchDate.setTime(timeMs);
    const lstRad = localSiderealTime(scratchDate, lonDeg) * DEG2RAD;
    const latRad = latDeg * DEG2RAD;
    // 天顶 Ẑ = (RA=LST, Dec=lat)，raDecToVector3 约定的内联版（免中间对象）
    const cosLat = Math.cos(latRad);
    zEq.set(cosLat * Math.cos(lstRad), Math.sin(latRad), -cosLat * Math.sin(lstRad));
    // 北点 N̂ = 天极在地平面上的投影归一（推导见文件头注释）
    nEq.copy(POLE).addScaledVector(zEq, -POLE.dot(zEq));
    if (nEq.lengthSq() < 1e-12) nEq.set(1, 0, 0); // |纬度|=90° 退化：任取一北
    nEq.normalize();
    // 东点 Ê = N̂ × Ẑ（ENU 右手系）
    eEq.crossVectors(nEq, zEq);
    // A = [Ê | Ẑ | −N̂]（列），R = Aᵀ；nEq 此后不再使用，原地取负零分配
    mBasis.makeBasis(eEq, zEq, nEq.negate());
    mBasis.transpose();
    qTarget.setFromRotationMatrix(mBasis);
  }
  if (snap) {
    qCurrent.copy(qTarget);
    qInverse.copy(qCurrent).invert();
    transitionT = -1;
    settled = true;
    return;
  }
  settled = false; // tick 负责收敛与 snap 判定
}

/**
 * 启动 0.8s 定时 slerp 过渡（free↔earth 模式切换专用；时间机器播放走
 * 指数跟踪常态即可）。与 CameraRig 的俯仰缓推同步开始，观感为一体。
 */
export function beginSkyModeTransition(): void {
  qFrom.copy(qCurrent);
  transitionT = 0;
  settled = false;
}

/**
 * 每帧推进（仅 UniverseScene 的天旋 group useFrame 调用一次；零分配）。
 * 定时过渡期做 easeInOutCubic 的 from→target slerp；常态做指数逼近——
 * 播放期 4Hz 的目标台阶被补间成连续天旋。
 */
export function tickSkyFrame(deltaSec: number): void {
  if (transitionT >= 0) {
    transitionT = Math.min(transitionT + deltaSec / MODE_TRANSITION_SEC, 1);
    qCurrent.slerpQuaternions(qFrom, qTarget, easeInOutCubic(transitionT));
    qInverse.copy(qCurrent).invert();
    if (transitionT >= 1) transitionT = -1; // 交回指数跟踪（settled 由下次 tick 判）
    return;
  }
  if (settled) return;
  qCurrent.slerp(qTarget, 1 - Math.exp(-TRACK_LAMBDA * deltaSec));
  if (qCurrent.angleTo(qTarget) < SETTLE_EPS) {
    qCurrent.copy(qTarget);
    settled = true;
  }
  qInverse.copy(qCurrent).invert();
}

/**
 * 当前天球旋转四元数（跨域契约 §2 导出）：free 模式恒等。
 * 返回模块级单例引用——只读，消费方【禁止修改】；需要保留请自行 copy。
 */
export function getSkyQuaternion(): THREE.Quaternion {
  return qCurrent;
}

/**
 * 世界系向量 → 天球本地系（赤道系）向量（跨域契约 §2 导出）。
 * 典型用法：把相机视线/世界方向反旋回天空层的本地坐标做比对（星座注视、
 * 拾取预筛等）。out 可与 v 为同一实例（原地变换），零分配。
 */
export function worldToSkyLocal(v: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(v).applyQuaternion(qInverse);
}
