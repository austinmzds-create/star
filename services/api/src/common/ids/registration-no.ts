import { randomInt } from 'node:crypto';

/** 去混淆字母表：排除 0/O/1/I/L，共 31 字符。4 位 ≈ 92 万组合/天。 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/**
 * 生成对外纪念编号，形如 STAR-20260710-K7PX。
 * 用 node:crypto.randomInt（CSPRNG）而非 Math.random；
 * 唯一性最终由 DB @unique 约束兜底（冲突时上层重试）。
 */
export function makeRegistrationNo(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += ALPHABET[randomInt(ALPHABET.length)]!;
  return `STAR-${y}${m}${d}-${suffix}`;
}
