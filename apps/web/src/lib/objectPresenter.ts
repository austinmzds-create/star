/**
 * 天体展示层小工具：类型中文标签、徽章文案、AU 距离格式化、星座缩写反查。
 * 纯函数、零重依赖，供 StarInfoCard / SearchPanel / TargetHighlight 共用。
 */

import { CONSTELLATION_ABBR, type CelestialObject } from '@star/astro-data';

/** 天体类型 → 中文单词标签（徽章/名牌副标题用）。 */
export function kindLabelZh(obj: Pick<CelestialObject, 'type'>): string {
  switch (obj.type) {
    case 'star':
      return '恒星';
    case 'galaxy':
      return '星系';
    case 'nebula':
      return '星云';
    case 'cluster':
      return '星团';
    case 'planet':
      return '行星';
    case 'moon':
      return '卫星';
    case 'sun':
      return '恒星（太阳）';
    case 'satellite':
      return '人造卫星';
    case 'asteroid':
      return '小行星';
    case 'comet':
      return '彗星';
    default:
      return '天体';
  }
}

/** 信息卡首行徽章：太阳系天体带「太阳系 ·」前缀，深空显类型，恒星返回 null（沿用星座徽章）。 */
export function primaryBadgeZh(obj: Pick<CelestialObject, 'type'>): string | null {
  switch (obj.type) {
    case 'planet':
      return '太阳系 · 行星';
    case 'moon':
      return '太阳系 · 卫星';
    case 'sun':
      return '太阳系 · 恒星';
    case 'satellite':
      return '人造卫星 · 演示精度';
    case 'asteroid':
      return '太阳系 · 小行星';
    case 'comet':
      return '太阳系 · 彗星';
    case 'galaxy':
    case 'nebula':
    case 'cluster':
      return kindLabelZh(obj);
    default:
      return null;
  }
}

/** 搜索结果行的类型小徽章：恒星不加（避免噪音），其余显类型。 */
export function searchTypeBadgeZh(obj: Pick<CelestialObject, 'type'>): string | null {
  switch (obj.type) {
    case 'star':
      return null;
    case 'sun':
      return '太阳';
    case 'moon':
      return '月亮';
    case 'satellite':
      return '卫星';
    default:
      return kindLabelZh(obj);
  }
}

/** 地心距离（AU）→ 展示文本，如 '1.52 AU'。 */
export function formatDistanceAu(distanceAu: number): string {
  return `${distanceAu.toFixed(2)} AU`;
}

// 星座「英文全名/中文名」→ IAU 3 字母缩写 的反查表（搜索命中星座时点亮连线用）。
const CONSTELLATION_NAME_TO_ABBR = new Map<string, string>();
for (const [abbr, names] of Object.entries(CONSTELLATION_ABBR)) {
  CONSTELLATION_NAME_TO_ABBR.set(names.en.toLowerCase(), abbr);
  CONSTELLATION_NAME_TO_ABBR.set(names.zh, abbr);
  CONSTELLATION_NAME_TO_ABBR.set(abbr.toLowerCase(), abbr);
}

/** 由星座英文全名/中文名/缩写反查 IAU 缩写；未知返回 null。 */
export function constellationToAbbr(name: string): string | null {
  return CONSTELLATION_NAME_TO_ABBR.get(name.trim().toLowerCase()) ??
    CONSTELLATION_NAME_TO_ABBR.get(name.trim()) ??
    null;
}
