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
  // 逆变换见下方 horizontalToEquatorial，两者共用同一套 Meeus 约定。
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

/**
 * equatorialToHorizontal 的逆变换：由地平坐标反推该观测者、该时刻指向的赤道坐标。
 *
 * 用途：把「观测者此刻的地平线（alt=0 的大圆）/ 东南西北方位标」反投影回
 * 固定的赤道系天球（前端 GridLayer/HorizonLayer 据此摆放几何）。
 *
 * 入参方位角采用通用「从正北起、向东为正」（与 equatorialToHorizontal 的
 * 出参一致）；内部换回 Meeus「从正南起、向西为正」参与三角计算。
 * 注意：alt=±90°（天顶/天底）处方位角退化，反解的 RA 无唯一意义。
 */
export function horizontalToEquatorial(
  horizontal: HorizontalCoord,
  observer: ObserverLocation,
  date: Date,
): EquatorialCoord {
  const alt = horizontal.altitudeDeg * DEG2RAD;
  // 通用方位角（北起东正）→ Meeus 方位角（南起西正）
  const aS = (horizontal.azimuthDeg - 180) * DEG2RAD;
  const lat = observer.latitudeDeg * DEG2RAD;

  const sinDec =
    Math.sin(lat) * Math.sin(alt) -
    Math.cos(lat) * Math.cos(alt) * Math.cos(aS);
  const dec = Math.asin(Math.max(-1, Math.min(1, sinDec)));

  // 时角 H：tan H = sin A / (cos A·sin φ + tan alt·cos φ)（A 为南起西正方位角）
  const h = Math.atan2(
    Math.sin(aS),
    Math.cos(aS) * Math.sin(lat) + Math.tan(alt) * Math.cos(lat),
  );
  const lst = localSiderealTime(date, observer.longitudeDeg);

  return {
    raDeg: normalizeDegrees(lst - h * RAD2DEG),
    decDeg: dec * RAD2DEG,
  };
}
