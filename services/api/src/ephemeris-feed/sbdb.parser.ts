/**
 * JPL SBDB 响应解析器（纯函数，零 Nest 依赖，便于 fixture 单测）。
 *
 * 数据纪律：数值一律 Number() 原样解析透传，绝不改写/编造；
 * 结构不符合预期（缺列/缺字段/非数值）→ 抛错（调用方视为本轮抓取失败，
 * 保留最后成功批次），绝不静默吞掉产出半截数据。
 */
import {
  ASTEROID_TARGETS,
  COMET_M1_MAX,
  COMET_NAME_ZH,
  COMET_TP_WINDOW_DAYS,
  COMET_WHITELIST,
} from './feed.constants';
import type { MinorBodyDto } from './feed.types';

/** sbdb_query.api 响应骨架（fields + 行式 data，值为字符串或 null）。 */
export interface SbdbQueryResponse {
  signature?: { source?: string; version?: string };
  count?: number | string;
  fields: string[];
  data: (string | number | null)[][];
}

/** sbdb.api 单体响应骨架（只取用到的字段）。 */
export interface SbdbSingleResponse {
  object?: { fullname?: string; des?: string; kind?: string };
  orbit?: { epoch?: string | number; elements?: { name: string; value: string | number | null }[] };
}

/** 必填数值解析：null/非数值抛错（带上下文），保证坏数据不入库。 */
function reqNum(v: string | number | null | undefined, field: string, ctx: string): number {
  const n = v == null || v === '' ? NaN : Number(v);
  if (!Number.isFinite(n)) throw new Error(`SBDB 数据异常：${ctx} 的 ${field} 非有限数值（${String(v)}）`);
  return n;
}

/** 可选数值解析：null/缺省 → undefined；出现但非数值 → 抛错。 */
function optNum(v: string | number | null | undefined, field: string, ctx: string): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`SBDB 数据异常：${ctx} 的 ${field} 非有限数值（${String(v)}）`);
  return n;
}

/**
 * 从 SBDB full_name 提取彗星编号（designation）：
 * - 周期彗星：'1P/Halley' → '1P'，'3D/Biela' → '3D'
 * - 临时编号：'C/2023 A3 (Tsuchinshan-ATLAS)' → 'C/2023 A3'，'C/2025 K1-D (ATLAS)' → 'C/2025 K1-D'
 * - 史料彗星（公元前/早期纪年，年份 1–4 位可带负号）：'C/-146 P1' → 'C/-146 P1'
 * 无法识别抛错（上游命名规则突变时宁可失败也不猜）。
 */
export function cometDesignation(fullName: string): string {
  const s = fullName.trim();
  const periodic = /^(\d+[PDI])(?:[/-]|$)/.exec(s);
  if (periodic?.[1]) return periodic[1];
  const provisional = /^([CPADXI]\/-?\d{1,4} [A-Z]+\d*(?:-[A-Z]+)?)/.exec(s);
  if (provisional?.[1]) return provisional[1];
  throw new Error(`SBDB 数据异常：无法从 full_name 提取彗星编号（${fullName}）`);
}

/** designation → 稳定 id（去掉非字母数字：'C/2023 A3' → 'C2023A3'）。 */
export function designationToId(designation: string): string {
  return designation.replace(/[^0-9A-Za-z]+/g, '');
}

/** 解析后的单条彗星根数（含过滤所需的 designation）。 */
export interface ParsedComet {
  designation: string;
  dto: MinorBodyDto;
}

/**
 * 解析 sbdb_query.api 批量彗星响应 → 全量彗星根数行。
 * 列位置按 fields 数组动态定位，不依赖请求时的字段顺序。
 */
export function parseSbdbQueryResponse(json: SbdbQueryResponse): ParsedComet[] {
  if (!Array.isArray(json?.fields) || !Array.isArray(json?.data)) {
    throw new Error('SBDB 数据异常：批量响应缺少 fields/data');
  }
  const col = new Map(json.fields.map((f, i) => [f, i]));
  for (const f of ['full_name', 'e', 'i', 'om', 'w', 'epoch']) {
    if (!col.has(f)) throw new Error(`SBDB 数据异常：批量响应缺少必需列 ${f}`);
  }
  const at = (row: (string | number | null)[], f: string): string | number | null =>
    row[col.get(f)!] ?? null;

  return json.data.map((row) => {
    const fullName = String(at(row, 'full_name') ?? '').trim();
    if (!fullName) throw new Error('SBDB 数据异常：存在 full_name 为空的行');
    const designation = cometDesignation(fullName);
    const nameZh = COMET_NAME_ZH[designation];
    const dto: MinorBodyDto = {
      id: designationToId(designation),
      name: fullName,
      ...(nameZh ? { nameZh } : {}),
      kind: 'comet',
      epochJd: reqNum(at(row, 'epoch'), 'epoch', fullName),
      e: reqNum(at(row, 'e'), 'e', fullName),
      iDeg: reqNum(at(row, 'i'), 'i', fullName),
      omDeg: reqNum(at(row, 'om'), 'om', fullName),
      wDeg: reqNum(at(row, 'w'), 'w', fullName),
    };
    const qAu = optNum(at(row, 'q'), 'q', fullName);
    const aAu = optNum(at(row, 'a'), 'a', fullName);
    const tpJd = optNum(at(row, 'tp'), 'tp', fullName);
    const maDeg = optNum(at(row, 'ma'), 'ma', fullName);
    const m1 = optNum(at(row, 'M1'), 'M1', fullName);
    const m2 = optNum(at(row, 'M2'), 'M2', fullName);
    if (qAu != null) dto.qAu = qAu;
    if (aAu != null) dto.aAu = aAu;
    if (tpJd != null) dto.tpJd = tpJd;
    if (maDeg != null) dto.maDeg = maDeg;
    if (m1 != null) dto.m1 = m1;
    if (m2 != null) dto.m2 = m2;
    // 彗星至少要有一种可解算的参数化：q/tp（近抛物线）或 a/ma（椭圆）
    if (dto.qAu == null && dto.aAu == null) {
      throw new Error(`SBDB 数据异常：${fullName} 既无 q 也无 a，无法参数化轨道`);
    }
    return { designation, dto };
  });
}

/**
 * 现役亮彗星过滤：|tp − now| ≤ 2 年 且 M1 ≤ 12，白名单（1P/2P/12P）无条件保留。
 * 输出按 M1 从亮到暗排序（缺 M1 的白名单天体排最后），全量典型 20–100 颗。
 */
export function filterActiveComets(rows: ParsedComet[], nowJd: number): MinorBodyDto[] {
  const seen = new Set<string>();
  const kept: ParsedComet[] = [];
  for (const row of rows) {
    const { designation, dto } = row;
    const whitelisted = COMET_WHITELIST.includes(designation);
    const active =
      dto.m1 != null &&
      dto.m1 <= COMET_M1_MAX &&
      dto.tpJd != null &&
      Math.abs(dto.tpJd - nowJd) <= COMET_TP_WINDOW_DAYS;
    if ((whitelisted || active) && !seen.has(dto.id)) {
      seen.add(dto.id);
      kept.push(row);
    }
  }
  return kept
    .sort((a, b) => (a.dto.m1 ?? Infinity) - (b.dto.m1 ?? Infinity))
    .map((r) => r.dto);
}

/**
 * 解析 sbdb.api 单体响应（Ceres/Pallas/Vesta 小行星）→ MinorBodyDto。
 * target.sstr 与 object.des 必须一致（防上游模糊匹配串号）。
 */
export function parseSbdbSingleBody(
  json: SbdbSingleResponse,
  target: { sstr: string; id: string; nameZh: string },
): MinorBodyDto {
  const ctx = `sstr=${target.sstr}`;
  const des = json?.object?.des;
  if (des !== target.sstr) {
    throw new Error(`SBDB 数据异常：单体响应 des=${String(des)} 与请求 ${ctx} 不一致`);
  }
  const elements = json.orbit?.elements;
  if (!Array.isArray(elements)) throw new Error(`SBDB 数据异常：${ctx} 缺少 orbit.elements`);
  const el = new Map(elements.map((e) => [e.name, e.value]));
  const dto: MinorBodyDto = {
    id: target.id,
    name: json.object?.fullname?.trim() || target.id,
    nameZh: target.nameZh,
    kind: 'asteroid',
    epochJd: reqNum(json.orbit?.epoch, 'epoch', ctx),
    e: reqNum(el.get('e'), 'e', ctx),
    iDeg: reqNum(el.get('i'), 'i', ctx),
    omDeg: reqNum(el.get('om'), 'om', ctx),
    wDeg: reqNum(el.get('w'), 'w', ctx),
    aAu: reqNum(el.get('a'), 'a', ctx),
    maDeg: reqNum(el.get('ma'), 'ma', ctx),
  };
  const qAu = optNum(el.get('q'), 'q', ctx);
  const tpJd = optNum(el.get('tp'), 'tp', ctx);
  if (qAu != null) dto.qAu = qAu;
  if (tpJd != null) dto.tpJd = tpJd;
  return dto;
}

/** ASTEROID_TARGETS 的重导出（service/测试共用）。 */
export { ASTEROID_TARGETS };
