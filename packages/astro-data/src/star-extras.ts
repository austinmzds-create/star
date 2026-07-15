/**
 * 恒星增强字段懒加载（Phase 9C，跨域契约冻结）。
 *
 * generated/star-extras.json（pm/ci/变星/聚星/IAU 官方名）通过【动态 import】
 * 加载：webpack/Next 侧自动切成异步 chunk，绝不进主 bundle（First Load 回收
 * 纪律——9B 曾把 pm 透传进 bright-stars.json 使主页 593→748KB，9C 全部迁到这里）；
 * Node 侧（vitest / api seed）经各自的 JSON 转换器同样可用。
 *
 * 单例缓存：首次调用发起 import，之后复用同一 Promise（并发调用只加载一次）。
 * 防御：JSON 缺失/结构异常时返回空 Map（catalog 主表完整可用，增强字段静默缺席），
 * 与 catalog.ts 对 generated JSON 的防御载入纪律一致。
 */

import { CATALOG_BY_UID } from './catalog';
import type { StarExtra } from './types';

/** star-extras.json 单条短键记录（ETL 契约见 scripts/build-catalog.mjs 文件头）。 */
interface RawExtraEntry {
  /** [pmRa, pmDec] mas/yr。 */
  p?: [number, number];
  /** ci（B−V）。 */
  c?: number;
  /** [varMin(最暗), varMax(最亮)]。 */
  v?: [number, number];
  /** 1 = 聚星。 */
  m?: number;
  /** IAU-CSN 官方名。 */
  n?: string;
}

let cache: Promise<ReadonlyMap<string, StarExtra>> | null = null;

/** 短键记录 → StarExtra（字段级防御：形状不对的键静默丢弃，绝不抛错）。 */
function decodeEntry(raw: RawExtraEntry): StarExtra {
  const out: StarExtra = {};
  if (Array.isArray(raw.p) && raw.p.length === 2 && raw.p.every(Number.isFinite)) {
    out.pmRa = raw.p[0];
    out.pmDec = raw.p[1];
  }
  if (typeof raw.c === 'number' && Number.isFinite(raw.c)) out.ci = raw.c;
  if (Array.isArray(raw.v) && raw.v.length === 2 && raw.v.every(Number.isFinite)) {
    out.varMin = raw.v[0];
    out.varMax = raw.v[1];
  }
  if (raw.m === 1) out.multiple = true;
  if (typeof raw.n === 'string' && raw.n) out.iauName = raw.n;
  return out;
}

async function loadAndDecode(): Promise<ReadonlyMap<string, StarExtra>> {
  try {
    // 动态 import（不用 import 属性，与 catalog.ts 的兼容性取舍一致）：
    // webpack/Next → 异步 chunk；vitest/Nest → 各自 JSON 转换器。
    // 先转 unknown 再断言：api 侧 ts-jest 的 resolveJsonModule 会把 JSON 推成
    // 字面量类型（p 推成 number[] 而非 [number, number]），直接 as 报 TS2352。
    const mod = (await import('./generated/star-extras.json')) as unknown as {
      default?: { byUid?: Record<string, RawExtraEntry> };
      byUid?: Record<string, RawExtraEntry>;
    };
    const byUid = mod.default?.byUid ?? mod.byUid;
    if (!byUid || typeof byUid !== 'object') return new Map();
    const map = new Map<string, StarExtra>();
    for (const [uid, raw] of Object.entries(byUid)) {
      if (raw && typeof raw === 'object') map.set(uid, decodeEntry(raw));
    }
    return map;
  } catch {
    // JSON 缺失（ETL 未跑）/加载失败：增强字段整体缺席，主目录不受影响
    return new Map();
  }
}

/**
 * 懒加载恒星增强字段表（uid → StarExtra）。单例缓存，Node 与浏览器都可用。
 * 跨域契约（冻结）：公信力 UI 经 apps/web 的 useStarExtra hook 消费；api seed 直接 await。
 *
 * 空结果不缓存：浏览器侧异步 chunk 拉取失败（离线/网络抖动）会落到空 Map，
 * 若缓存则永久降级——不缓存让下一次调用（如用户重进深时模式）有机会重试；
 * 正常构建下 JSON 恒有 8000+ 条，空 = 异常，重试成本仅一次 import。
 */
export async function loadStarExtras(): Promise<ReadonlyMap<string, StarExtra>> {
  if (!cache) {
    cache = loadAndDecode().then((map) => {
      if (map.size === 0) cache = null;
      return map;
    });
  }
  return cache;
}

/**
 * 把增强字段回填进内存目录（CelestialObject.pmRaMasYr/pmDecMasYr）。
 *
 * 9C 起主表 lean 化，目录对象在模块加载期不带 pm；深时模式（恒星自行时光机）
 * 的 CPU 侧几何（星座连线形变等）仍读目录 pm 字段——extras 加载完成后调用本
 * 函数一次性补齐（幂等；已带 pm 的对象如手写比邻星不覆盖）。渲染侧 GPU
 * attribute 的回填由 web 层自行完成（TwinkleStars），不在此处。
 */
export function applyStarExtrasToCatalog(extras: ReadonlyMap<string, StarExtra>): void {
  for (const [uid, ex] of extras) {
    if (ex.pmRa === undefined || ex.pmDec === undefined) continue;
    const obj = CATALOG_BY_UID.get(uid);
    if (!obj || obj.pmRaMasYr !== undefined) continue;
    obj.pmRaMasYr = ex.pmRa;
    obj.pmDecMasYr = ex.pmDec;
  }
}
