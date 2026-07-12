/**
 * 恒星视觉参数推导（全天体查看器 · StarPane3D / 卡内星点缩略图共用）。
 *
 * 纯函数、零 three 依赖：卡内 2D 缩略图（ViewerPreviewBlock）走 next/dynamic
 * 轻 chunk，本模块不能把 three 拖进去——光谱色兜底表在此独立实现，
 * 不 import lib/universe.ts（那边 import three）。
 *
 * 一切参数由 derivePhysical（@star/astro-data 冻结契约）派生：同一恒星
 * 永远同一视觉；无法推导时逐级兜底（光谱色 → 白），不抛错。
 */

import { derivePhysical, type CelestialObject } from '@star/astro-data';

/** RGB 三元组（0–1 线性近似，直接可入 shader uniform / css 换算）。 */
export type RGB = [number, number, number];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * 色温 → RGB（Tanner Helland 黑体近似，输入钳到 1000–40000K）。
 * 拟合式基于 K/100 的分段对数/幂曲线，误差对视觉呈现不可感。
 */
export function kelvinToRGB(kelvin: number): RGB {
  const t = clamp(kelvin, 1000, 40000) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [clamp(r, 0, 255) / 255, clamp(g, 0, 255) / 255, clamp(b, 0, 255) / 255];
}

/** 光谱型首字母 → 色（tempK 缺失兜底；表值与 lib/universe.ts spectralColor 一致）。 */
export function spectralFallbackColor(spectralType?: string): RGB {
  switch (spectralType?.[0]?.toUpperCase()) {
    case 'O':
    case 'B':
      return [0.61, 0.7, 1.0];
    case 'A':
      return [0.83, 0.89, 1.0];
    case 'F':
      return [1.0, 0.98, 0.94];
    case 'G':
      return [1.0, 0.95, 0.84];
    case 'K':
      return [1.0, 0.8, 0.56];
    case 'M':
      return [1.0, 0.66, 0.48];
    default:
      return [1.0, 1.0, 1.0];
  }
}

/** StarPane3D 全部渲染参数（shader uniform + 球体/日冕尺寸一次算齐）。 */
export interface StarVisual {
  /** 表面基色（0–1）。 */
  rgb: RGB;
  /** 球体缩放（0.4–1.8）：半径的对数压缩，白矮星强制 0.4。 */
  scale: number;
  /** 米粒噪声频率：巨星大对流胞 2.2 / 主序 4.5 / 白矮星 7。 */
  noiseScale: number;
  /** 边缘变暗指数：热星（>10000K）变暗弱 0.35，其余 0.55。 */
  limb: number;
  /** 白矮星：更锐的辉光纹理 + 去第二层日冕。 */
  isWhiteDwarf: boolean;
}

/** 由目录行推导恒星视觉参数（derivePhysical null 时全兜底，任何恒星可渲染）。 */
export function deriveStarVisual(obj: CelestialObject): StarVisual {
  const profile = derivePhysical(obj);
  const tempK = profile?.tempK ?? null;
  const rgb = tempK != null ? kelvinToRGB(tempK) : spectralFallbackColor(obj.spectralType);

  const stage = profile?.stage ?? '';
  const isWhiteDwarf = stage === 'white_dwarf';
  const radius = profile?.radiusSolar ?? 1;
  // 半径跨 5 个数量级（白矮星 0.01 → 超巨星 1000+），对数压缩到可比拟的球径
  const scale = isWhiteDwarf ? 0.4 : clamp(0.55 + 0.28 * Math.log10(Math.max(radius, 0.01)), 0.4, 1.8);

  const noiseScale = isWhiteDwarf ? 7 : stage === 'giant' || stage === 'supergiant' ? 2.2 : 4.5;
  const limb = tempK != null && tempK > 10000 ? 0.35 : 0.55;

  return { rgb, scale, noiseScale, limb, isWhiteDwarf };
}

/** RGB(0–1) → css rgba 串。 */
export function rgbToCss(rgb: RGB, a: number): string {
  return `rgba(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)},${a})`;
}
