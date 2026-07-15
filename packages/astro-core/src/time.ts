import {
  DAYS_PER_JULIAN_CENTURY,
  JD_J2000,
  JD_UNIX_EPOCH,
  MS_PER_DAY,
} from './constants';

/** 把角度归一化到 [0, 360)。 */
export function normalizeDegrees(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}

/**
 * 由 JavaScript Date 计算儒略日（JD）。
 * Date.getTime() 返回的是 UTC 纪元毫秒，因此结果天然基于 UTC。
 */
export function julianDate(date: Date): number {
  return date.getTime() / MS_PER_DAY + JD_UNIX_EPOCH;
}

/**
 * 格林尼治平恒星时（GMST），单位度，归一化到 [0, 360)。
 * 采用 IAU 1982 表达式（含 T^2、T^3 修正项）。
 */
export function greenwichMeanSiderealTime(date: Date): number {
  const jd = julianDate(date);
  const d = jd - JD_J2000;
  const t = d / DAYS_PER_JULIAN_CENTURY;
  const gmst =
    280.46061837 +
    360.98564736629 * d +
    0.000387933 * t * t -
    (t * t * t) / 38_710_000.0;
  return normalizeDegrees(gmst);
}

/**
 * 本地平恒星时（LST），单位度，归一化到 [0, 360)。
 * 东经为正。
 */
export function localSiderealTime(date: Date, longitudeDeg: number): number {
  return normalizeDegrees(greenwichMeanSiderealTime(date) + longitudeDeg);
}
