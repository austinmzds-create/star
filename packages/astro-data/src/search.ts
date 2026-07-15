import { FULL_CATALOG } from './catalog';
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

/** 收集某星体所有可搜索字段（构建期调用一次）。 */
function collectFields(obj: CelestialObject): SearchField[] {
  const fields: SearchField[] = [
    { value: obj.nameEn, family: 'name', weight: 1 },
    { value: obj.nameZh, family: 'name', weight: 1 },
  ];
  if (obj.commonNameZh) fields.push({ value: obj.commonNameZh, family: 'alias', weight: 0.9 });
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

// —— 预构建归一化索引（5000 量级性能）——
// 把「收集字段 + 归一化」从查询期移到构建期；查询期只做纯字符串比较。

interface IndexedField {
  /** 已归一化的字段值。 */
  n: string;
  family: MatchFamily;
  weight: number;
}

interface IndexedObject {
  obj: CelestialObject;
  featured: boolean;
  fields: IndexedField[];
}

// 按 catalog 引用缓存索引，避免每次查询 rebuild。
// 9C：目录支持运行时追加（动态彗星等，SEARCH_CATALOG 原地 push 保引用稳定），
// 故缓存命中同时校验长度——追加后长度变化即自动重建索引，无需显式失效接口。
const indexCache = new WeakMap<CelestialObject[], IndexedObject[]>();

function getIndex(catalog: CelestialObject[]): IndexedObject[] {
  let idx = indexCache.get(catalog);
  if (!idx || idx.length !== catalog.length) {
    idx = catalog.map((obj) => ({
      obj,
      featured: obj.isFeatured,
      fields: collectFields(obj)
        .map((f) => ({ n: normalize(f.value), family: f.family, weight: f.weight }))
        .filter((f) => f.n.length > 0),
    }));
    indexCache.set(catalog, idx);
  }
  return idx;
}

/**
 * 已归一化候选与已归一化查询的匹配质量：完全 > 前缀 > 包含 > 不匹配。
 * 候选 c 已在构建期归一化，查询期零 normalize。
 */
function matchQualityNormalized(c: string, query: string): number {
  if (c === query) return 100;
  if (c.startsWith(query)) return 70;
  if (c.includes(query)) return 45;
  return 0;
}

export interface SearchOptions {
  /** 返回结果上限，默认 8。 */
  limit?: number;
  /** 待搜索的星体集合，默认使用恒星 + 深空合并目录（FULL_CATALOG）。 */
  catalog?: CelestialObject[];
}

/**
 * 在星表中按查询词搜索星体，返回按相关性排序的结果。
 * 支持中文名、中文俗名、英文名、别名、拜耳命名、星表编号（HIP/HD/M/NGC/IC）、
 * objectUid、星座名。著名星在同等命中质量下置顶。
 */
export function searchCelestial(
  query: string,
  options: SearchOptions = {},
): StarSearchResult[] {
  const limit = options.limit ?? 8;
  const catalog = options.catalog ?? FULL_CATALOG;
  const q = normalize(query);
  if (!q) return [];

  const index = getIndex(catalog);
  const results: StarSearchResult[] = [];
  for (const indexed of index) {
    let best = 0;
    let bestFamily: MatchFamily = 'name';
    for (const field of indexed.fields) {
      const quality = matchQualityNormalized(field.n, q);
      if (quality === 0) continue;
      const score = quality * field.weight;
      if (score > best) {
        best = score;
        bestFamily = field.family;
      }
    }
    if (best > 0) {
      results.push({
        object: indexed.obj,
        score: best + brightnessBonus(indexed.obj.magnitude) + (indexed.featured ? 15 : 0),
        matchedOn: bestFamily,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
