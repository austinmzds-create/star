/**
 * 88 星座连线表（Star Walk 式星座动画的数据基础）。
 *
 * 由 scripts/build-constellation-lines.mjs 离线生成（d3-celestial 星座线 + 核心星表
 * 最近邻匹配，BSD-3-Clause，详见 generated/README.md）。
 *
 * 线段端点为 objectUid（HIP > HD > HR 规则，与 CELESTIAL_CATALOG 完全一致）：
 * web 端直接 `CATALOG_BY_UID.get(uid)` 取坐标绘线，零转换、100% 可解析。
 */

import constellationLines from './generated/constellation-lines.json';

/** 一个星座的连线数据。 */
export interface ConstellationLineSet {
  /** IAU 3 字母缩写（CONSTELLATION_ABBR 的键），如 'Ori'。 */
  con: string;
  /** 线段列表；每段为 [起点 objectUid, 终点 objectUid]。 */
  segments: [string, string][];
}

interface GeneratedLines {
  meta?: { constellationCount?: number; segmentCount?: number; droppedSegments?: number };
  constellations?: { con: string; segments: string[][] }[];
}

// 防御载入：缺失或结构异常时退化为空数组，构建不崩（web 端应对空数组静默降级）。
const raw = (constellationLines as GeneratedLines)?.constellations ?? [];

/** 全 88 星座连线表，按缩写字典序。 */
export const CONSTELLATION_LINES: ConstellationLineSet[] = raw.map((c) => ({
  con: c.con,
  segments: c.segments.map((s) => [s[0] ?? '', s[1] ?? ''] as [string, string]),
}));

/** 按星座缩写取连线。 */
export const CONSTELLATION_LINES_BY_CON: Map<string, ConstellationLineSet> = new Map(
  CONSTELLATION_LINES.map((c) => [c.con, c]),
);
