/**
 * 局部天区投影（星图用）。标准 gnomonic（切平面）投影，中心 = 目标星，
 * 近中心无畸变、精确；配合 astro-core 赤道坐标约定（RA 向东增，星图东在左）。
 */
import { clamp } from './svg-utils';

const D2R = Math.PI / 180;

/** 目标星与某星的角距（度），球面余弦公式。用于筛邻域。 */
export function angularSeparationDeg(
  ra0: number,
  dec0: number,
  ra: number,
  dec: number,
): number {
  const a = dec0 * D2R;
  const b = dec * D2R;
  const dl = (ra - ra0) * D2R;
  const c = Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos(dl);
  return Math.acos(clamp(c, -1, 1)) / D2R;
}

/**
 * gnomonic：返回切平面 (x 东为正, y 北为正)，单位弧度。中心星映射到 (0,0)。
 * cosc<=0 表示落在切点背面（超过 90°），视为不可投影，返回 NaN 由调用方剔除。
 */
export function gnomonicProject(
  ra0: number,
  dec0: number,
  ra: number,
  dec: number,
): { x: number; y: number } {
  const a = dec0 * D2R;
  const b = dec * D2R;
  const dl = (ra - ra0) * D2R;
  const cosc = Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos(dl);
  if (cosc <= 0) {
    return { x: NaN, y: NaN };
  }
  const x = (Math.cos(b) * Math.sin(dl)) / cosc;
  const y = (Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(dl)) / cosc;
  return { x, y };
}
