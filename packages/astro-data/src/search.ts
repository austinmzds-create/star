import { CELESTIAL_CATALOG } from './catalog';
import type { CelestialObject, StarSearchResult } from './types';

type MatchFamily = StarSearchResult['matchedOn'];

interface SearchField {
  value: string;
  family: MatchFamily;
  weight: number;
}

/** 归一化：去空白、转小写、去拉丁变音符号（中文字符原样保留）。 */
function normalize(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** 单个字段相对查询词的匹配质量：完全 > 前缀 > 包含 > 不匹配。 */
function matchQuality(candidate: string, query: string): number {
  const c = normalize(candidate);
  if (!c) return 0;
  if (c === query) return 100;
  if (c.startsWith(query)) return 70;
  if (c.includes(query)) return 45;
  return 0;
}

/** 收集某星体所有可搜索字段。 */
function collectFields(obj: CelestialObject): SearchField[] {
  const fields: SearchField[] = [
    { value: obj.nameEn, family: 'name', weight: 1 },
    { value: obj.nameZh, family: 'name', weight: 1 },
  ];
  if (obj.bayer) fields.push({ value: obj.bayer, family: 'bayer', weight: 0.9 });
  for (const alias of obj.aliases) {
    fields.push({ value: alias, family: 'alias', weight: 0.85 });
  }
  fields.push({ value: obj.objectUid, family: 'catalog', weight: 0.8 });
  for (const id of Object.values(obj.catalogIds)) {
    fields.push({ value: id, family: 'catalog', weight: 0.8 });
  }
  fields.push({ value: obj.constellation, family: 'constellation', weight: 0.6 });
  fields.push({ value: obj.constellationZh, family: 'constellation', weight: 0.6 });
  return fields;
}

/** 越亮的星体得到越高的加权，作为同分时的次序。 */
function brightnessBonus(magnitude: number): number {
  return Math.max(0, 7 - magnitude) * 0.6;
}

export interface SearchOptions {
  /** 返回结果上限，默认 8。 */
  limit?: number;
  /** 待搜索的星体集合，默认使用精选星表。 */
  catalog?: CelestialObject[];
}

/**
 * 在星表中按查询词搜索星体，返回按相关性排序的结果。
 * 支持中文名、英文名、别名、拜耳命名、星表编号（HIP/HD）、objectUid、星座名。
 */
export function searchCelestial(
  query: string,
  options: SearchOptions = {},
): StarSearchResult[] {
  const limit = options.limit ?? 8;
  const catalog = options.catalog ?? CELESTIAL_CATALOG;
  const q = normalize(query);
  if (!q) return [];

  const results: StarSearchResult[] = [];
  for (const obj of catalog) {
    let best = 0;
    let bestFamily: MatchFamily = 'name';
    for (const field of collectFields(obj)) {
      const quality = matchQuality(field.value, q);
      if (quality === 0) continue;
      const score = quality * field.weight;
      if (score > best) {
        best = score;
        bestFamily = field.family;
      }
    }
    if (best > 0) {
      results.push({
        object: obj,
        score: best + brightnessBonus(obj.magnitude),
        matchedOn: bestFamily,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
