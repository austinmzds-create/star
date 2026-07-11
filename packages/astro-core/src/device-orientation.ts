import { DEG2RAD, RAD2DEG } from './constants';
import { normalizeDegrees } from './time';
import type { HorizontalCoord } from './types';

/**
 * W3C 设备方向（DeviceOrientationEvent 的 alpha/beta/gamma）→ 观察方向的地平坐标。
 *
 * 约定（W3C Device Orientation 规范）：
 *  - 地球参考系：X=东、Y=北、Z=天顶；
 *  - 旋转矩阵 R = Rz(α)·Rx(β)·Ry(γ)（内旋 z-x'-y''，角度制）；
 *  - 「视线方向」= 设备 −z 轴（屏幕背面法向），即 v = R·(0,0,−1)。
 *
 * 关键性质：视线取的是设备 −z 轴，而屏幕方向（portrait/landscape）旋转是
 * 绕设备 z 轴的旋转，对该轴不变——因此**无需 screen.orientation.angle 补偿**，
 * 横竖屏举起手机指向同一片天，公式同一套。
 *
 * 展开 R·(0,0,−1)：
 *   east  = −cosα·sinγ − sinα·sinβ·cosγ
 *   north = −sinα·sinγ + cosα·sinβ·cosγ
 *   up    = −cosβ·cosγ
 * 高度角 = asin(up)；方位角 = atan2(east, north)（北起东正，与本包地平约定一致）。
 *
 * 注意：iOS Safari 的 deviceorientation alpha 为相对原点；调用方若拿到
 * webkitCompassHeading，应先换算 alpha = 360 − heading 再传入本函数。
 */
export function deviceOrientationToLookDirection(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
): HorizontalCoord {
  const a = alphaDeg * DEG2RAD;
  const b = betaDeg * DEG2RAD;
  const g = gammaDeg * DEG2RAD;
  const sa = Math.sin(a);
  const ca = Math.cos(a);
  const sb = Math.sin(b);
  const cb = Math.cos(b);
  const sg = Math.sin(g);
  const cg = Math.cos(g);

  const east = -ca * sg - sa * sb * cg;
  const north = -sa * sg + ca * sb * cg;
  const up = -cb * cg;

  const altitudeDeg = Math.asin(Math.max(-1, Math.min(1, up))) * RAD2DEG;
  const azimuthDeg = normalizeDegrees(Math.atan2(east, north) * RAD2DEG);
  return { altitudeDeg, azimuthDeg };
}
