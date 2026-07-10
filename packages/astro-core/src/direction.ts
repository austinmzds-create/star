import { normalizeDegrees } from './time';
import type { CompassDirection } from './types';

const COMPASS_16 = [
  { zh: '正北', en: 'N' },
  { zh: '东北偏北', en: 'NNE' },
  { zh: '东北', en: 'NE' },
  { zh: '东北偏东', en: 'ENE' },
  { zh: '正东', en: 'E' },
  { zh: '东南偏东', en: 'ESE' },
  { zh: '东南', en: 'SE' },
  { zh: '东南偏南', en: 'SSE' },
  { zh: '正南', en: 'S' },
  { zh: '西南偏南', en: 'SSW' },
  { zh: '西南', en: 'SW' },
  { zh: '西南偏西', en: 'WSW' },
  { zh: '正西', en: 'W' },
  { zh: '西北偏西', en: 'WNW' },
  { zh: '西北', en: 'NW' },
  { zh: '西北偏北', en: 'NNW' },
] as const;

/**
 * 把方位角（0–360，从正北起向东为正）转换为 16 方位描述。
 */
export function azimuthToDirection(azimuthDeg: number): CompassDirection {
  const az = normalizeDegrees(azimuthDeg);
  const index = Math.round(az / 22.5) % 16;
  const point = COMPASS_16[index]!;
  return { azimuthDeg: az, zh: point.zh, en: point.en };
}
