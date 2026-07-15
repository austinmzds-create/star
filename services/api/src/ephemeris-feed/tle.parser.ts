/**
 * Celestrak TLE 文本解析与校验（纯函数）。
 * mod-10 校验与历元解析逻辑与 apps/web/src/lib/satellites/tles.ts 保持一致
 * （web 属「数据层」域，本文件是服务端独立实现，两处口径一致靠单测锚定同一批真实 TLE）。
 */

/** TLE 行 mod-10 校验（末位为校验位：数字求和 + 负号计 1）。 */
export function tleChecksumOk(line: string): boolean {
  if (line.length !== 69) return false;
  let sum = 0;
  for (let i = 0; i < 68; i++) {
    const ch = line[i]!;
    if (ch >= '0' && ch <= '9') sum += ch.charCodeAt(0) - 48;
    else if (ch === '-') sum += 1;
  }
  return sum % 10 === Number(line[68]);
}

/**
 * 解析 line1 第 19–32 列（1 起）的历元：YYDDD.DDDDDDDD → Date。
 * 两位年按 NORAD 惯例：57–99 → 19xx，00–56 → 20xx。格式非法返回 null。
 */
export function parseTleEpoch(line1: string): Date | null {
  const raw = line1.slice(18, 32).trim();
  const m = /^(\d{2})(\d{3}(?:\.\d+)?)$/.exec(raw);
  if (!m) return null;
  const yy = Number(m[1]);
  const year = yy >= 57 ? 1900 + yy : 2000 + yy;
  const dayOfYear = Number(m[2]);
  if (!(dayOfYear >= 1 && dayOfYear < 367)) return null;
  return new Date(Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86400000);
}

/** 解析结果：名称行 + 两行 TLE。 */
export interface ParsedTle {
  name: string;
  l1: string;
  l2: string;
  /** 从 l1 解析的历元（解析失败为 null，不阻断——历元仅观测用）。 */
  epochAt: Date | null;
}

/**
 * 解析 Celestrak gp.php?FORMAT=TLE 的 3 行响应（名称行 + l1 + l2）。
 * 校验：行结构、69 字符定长、mod-10 校验和、NORAD 目录号与请求一致。
 * 任何一项不过 → 抛错（本颗卫星本轮刷新失败，保留上一次成功值）。
 */
export function parseCelestrakTle(text: string, expectedNoradId: number): ParsedTle {
  const ctx = `NORAD ${expectedNoradId}`;
  // Celestrak 名称行右侧补空格、换行可能是 \r\n：先按行拆再 trimEnd
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  const l1 = lines.find((l) => l.startsWith('1 '));
  const l2 = lines.find((l) => l.startsWith('2 '));
  if (!l1 || !l2) throw new Error(`Celestrak 数据异常：${ctx} 响应缺少 TLE 行（${lines.length} 行）`);
  const nameLine = lines.find((l) => l !== l1 && l !== l2);
  if (l1.length !== 69 || l2.length !== 69) {
    throw new Error(`Celestrak 数据异常：${ctx} TLE 行长度非 69（${l1.length}/${l2.length}）`);
  }
  if (!tleChecksumOk(l1) || !tleChecksumOk(l2)) {
    throw new Error(`Celestrak 数据异常：${ctx} TLE 校验和不通过`);
  }
  const catNr1 = Number(l1.slice(2, 7));
  const catNr2 = Number(l2.slice(2, 7));
  if (catNr1 !== expectedNoradId || catNr2 !== expectedNoradId) {
    throw new Error(`Celestrak 数据异常：${ctx} 返回目录号 ${catNr1}/${catNr2} 不一致`);
  }
  return { name: nameLine?.trim() || String(expectedNoradId), l1, l2, epochAt: parseTleEpoch(l1) };
}

/** 组内单条解析结果（比 ParsedTle 多携带 NORAD 目录号，供构造 uid）。 */
export interface ParsedGroupTle extends ParsedTle {
  noradId: number;
}

/**
 * 解析 Celestrak gp.php?GROUP=…&FORMAT=TLE 的整组响应（成千上万颗，
 * 每颗三行：名称行 + l1 + l2）。
 *
 * 逐颗宽容：单颗结构/长度/校验和/目录号非法则【静默跳过】（不抛错）——
 * 整组里个别坏行不能拖垮整批；返回全部通过校验的条目。绝不产出半截或伪造行。
 */
export function parseCelestrakGroupTle(text: string): ParsedGroupTle[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  const out: ParsedGroupTle[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l1 = lines[i]!;
    if (!l1.startsWith('1 ')) continue;
    const l2 = lines[i + 1];
    if (!l2 || !l2.startsWith('2 ')) continue;
    // 名称行：紧邻上一行且非 TLE 数据行时采用，否则回落目录号
    const prev = i > 0 ? lines[i - 1]! : '';
    const nameLine = prev && !prev.startsWith('1 ') && !prev.startsWith('2 ') ? prev.trim() : '';
    if (l1.length !== 69 || l2.length !== 69) continue;
    if (!tleChecksumOk(l1) || !tleChecksumOk(l2)) continue;
    const noradId = Number(l1.slice(2, 7));
    if (!Number.isFinite(noradId)) continue;
    out.push({
      name: nameLine || `STARLINK-${noradId}`,
      l1,
      l2,
      epochAt: parseTleEpoch(l1),
      noradId,
    });
    i++; // 跳过已消费的 l2
  }
  return out;
}
