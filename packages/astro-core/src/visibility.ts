import {
  DEG2RAD,
  MS_PER_HOUR,
  RAD2DEG,
  SIDEREAL_DEG_PER_HOUR,
} from './constants';
import { equatorialToHorizontal } from './coordinates';
import { azimuthToDirection } from './direction';
import { localSiderealTime, normalizeDegrees } from './time';
import type {
  EquatorialCoord,
  ObservationSummary,
  ObserverLocation,
  VisibilitySnapshot,
} from './types';

/**
 * 某观测者、某时刻对某星体的可见性快照：地平坐标 + 是否在地平线上 + 方位描述。
 */
export function computeVisibility(
  equatorial: EquatorialCoord,
  observer: ObserverLocation,
  date: Date,
): VisibilitySnapshot {
  const horizontal = equatorialToHorizontal(equatorial, observer, date);
  return {
    horizontal,
    isAboveHorizon: horizontal.altitudeDeg > 0,
    direction: azimuthToDirection(horizontal.azimuthDeg),
  };
}

/**
 * 某观测者对某星体的一整晚观测概况：
 * - 下一次上中天（过子午线、达最高点）的时间
 * - 上中天时的最大高度角
 * - 是否拱极（全天不落）/ 是否永不升起
 *
 * 上/下中天高度角用精确反正弦求出，对南北半球、任意赤纬都成立。
 */
export function computeObservationSummary(
  equatorial: EquatorialCoord,
  observer: ObserverLocation,
  fromDate: Date,
): ObservationSummary {
  const lat = observer.latitudeDeg * DEG2RAD;
  const dec = equatorial.decDeg * DEG2RAD;
  const sinLatSinDec = Math.sin(lat) * Math.sin(dec);
  const cosLatCosDec = Math.cos(lat) * Math.cos(dec);

  // 上中天（H = 0）与下中天（H = 180°）时的高度角
  const upperAltDeg =
    Math.asin(Math.max(-1, Math.min(1, sinLatSinDec + cosLatCosDec))) * RAD2DEG;
  const lowerAltDeg =
    Math.asin(Math.max(-1, Math.min(1, sinLatSinDec - cosLatCosDec))) * RAD2DEG;

  // 从 fromDate 起，本地恒星时推进到 RA 时即为上中天
  const currentLst = localSiderealTime(fromDate, observer.longitudeDeg);
  const deltaDeg = normalizeDegrees(equatorial.raDeg - currentLst);
  const hoursUntilTransit = deltaDeg / SIDEREAL_DEG_PER_HOUR;
  const nextTransit = new Date(
    fromDate.getTime() + hoursUntilTransit * MS_PER_HOUR,
  );

  return {
    nextTransit,
    maxAltitudeDeg: upperAltDeg,
    isCircumpolar: lowerAltDeg >= 0,
    neverRises: upperAltDeg < 0,
  };
}
