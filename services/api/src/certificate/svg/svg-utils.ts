/** SVG 生成基元：转义、数值裁剪、确定性伪随机、按码点折行。纯函数，零依赖，可单测。 */

/**
 * XML/SVG 文本转义：& < > " ' 全部实体化，防注入与渲染破坏。
 * 顺序上 & 必须最先替换（否则会二次转义后续实体的 &）。
 */
export function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 数值裁剪到 [lo, hi]。 */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 四舍五入到指定小数位（默认 3 位），减小 SVG 体积与快照抖动。 */
export function round(v: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/**
 * 确定性伪随机（mulberry32）：以整数种子生成 [0,1) 序列。
 * 用于程序化撒点星背景——同一 registrationNo 每次渲染结果一致，便于快照测试。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 字符串 → 32 位整数种子（简单 FNV-1a 变体，确定性）。 */
export function stringToSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 按 Unicode 码点折行：用 Array.from 切分（与 DTO 码点计数一致），
 * 每行 perLine 个码点，至多 maxLines 行，超出则末行结尾加省略号。
 */
export function wrapByGraphemes(text: string, perLine: number, maxLines: number): string[] {
  const chars = Array.from(text ?? '');
  const lines: string[] = [];
  for (let i = 0; i < chars.length && lines.length < maxLines; i += perLine) {
    lines.push(chars.slice(i, i + perLine).join(''));
  }
  // 是否有溢出未纳入
  const consumed = Math.min(chars.length, perLine * maxLines);
  if (consumed < chars.length && lines.length > 0) {
    const last = Array.from(lines[lines.length - 1] ?? '');
    // 末行留一个码点位给省略号
    const trimmed = last.slice(0, Math.max(0, perLine - 1)).join('');
    lines[lines.length - 1] = `${trimmed}…`;
  }
  return lines;
}
