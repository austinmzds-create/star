import { randomInt } from 'node:crypto';

/** 小写字母+数字，去混淆（无 0/o/1/i/l），12 位 ≈ 59 bit 熵，不可枚举。 */
const SLUG_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

/**
 * 生成公开纪念页短链 slug（自实现 nanoid 风格，避免 nanoid v5 纯 ESM 与 CJS bundle 的互操作噪音）。
 * 唯一性最终由 DB @unique 约束兜底。
 */
export function makePublicSlug(length = 12): string {
  let s = '';
  for (let i = 0; i < length; i++) s += SLUG_ALPHABET[randomInt(SLUG_ALPHABET.length)]!;
  return s;
}
