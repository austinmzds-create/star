import { DEG2RAD, RAD2DEG } from './constants';
import { localSiderealTime, normalizeDegrees } from './time';
import type {
  EquatorialCoord,
  HorizontalCoord,
  ObserverLocation,
  Vec3,
} from './types';

/**
 * 把赤道坐标（RA/Dec）投影到一个固定半径的天球上，得到 three.js 用的三维点。
 *
 * 坐标约定（右手系，+Y 指向天球北极）：
 *   x = r·cos(dec)·cos(ra)
 *   y = r·sin(dec)
 *   z = -r·cos(dec)·sin(ra)
 *
 * 第一版不做真实距离尺度——真实恒星距离差异过大，反而不利于观感；
 * 所有星体统一贴在半径 r 的天球内壁，形成包裹用户的星空。
 */
export function raDecToVector3(
  { raDeg, decDeg }: EquatorialCoord,
  radius = 1000,
): Vec3 {
  const ra = raDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const cosDec = Math.cos(dec);
  return {
    x: radius * cosDec * Math.cos(ra),
    y: radius * Math.sin(dec),
    z: -radius * cosDec * Math.sin(ra),
  };
}

/**
 * 把赤道坐标转换为某观测者、某时刻的地平坐标（高度角/方位角）。
 *
 * 采用 Meeus《Astronomical Algorithms》公式，内部方位角以「从正南起、向西为正」
 * 计算，最后换算为通用的「从正北起、向东为正」（0–360）。
 */
export function equatorialToHorizontal(
  equatorial: EquatorialCoord,
  observer: ObserverLocation,
  date: Date,
): HorizontalCoord {
  const lst = localSiderealTime(date, observer.longitudeDeg);
  // 时角 H = LST - RA
  const hourAngleDeg = normalizeDegrees(lst - equatorial.raDeg);

  const h = hourAngleDeg * DEG2RAD;
  const dec = equatorial.decDeg * DEG2RAD;
  const lat = observer.latitudeDeg * DEG2RAD;

  const sinAlt =
    Math.sin(lat) * Math.sin(dec) +
    Math.cos(lat) * Math.cos(dec) * Math.cos(h);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt)));

  // Meeus：方位角从正南起、向西为正
  const azSouthWest = Math.atan2(
    Math.sin(h),
    Math.cos(h) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat),
  );

  const azimuthDeg = normalizeDegrees(azSouthWest * RAD2DEG + 180);

  return {
    altitudeDeg: altitude * RAD2DEG,
    azimuthDeg,
  };
}
