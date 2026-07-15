#!/usr/bin/env node
/**
 * PWA 图标生成脚本（Phase 6B 目标 11）：node 零依赖，纯数学像素生成 +
 * 手写极简 PNG 编码器（node:zlib deflate + 查表 CRC32），产物提交入库。
 *
 * 视觉与 BrandMark 同源：深空径向底 + 定种子星点 + 中央品牌星
 * （白核 + nebula 蓝紫光晕）。自绘品牌资产，无第三方版权，不进
 * fetch-assets 清单。
 *
 * 产出（写入 apps/web/public/icons/）：
 *   icon-192.png            192×192  常规
 *   icon-512.png            512×512  常规
 *   icon-maskable-512.png   512×512  maskable（内容缩进 20% 安全区，底色满铺出血）
 *
 * 用法：node apps/web/scripts/generate-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

// ── PNG 编码（8bit RGBA，filter 0，单 IDAT） ───────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** RGBA Uint8Array → PNG Buffer。 */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // compression/filter/interlace = 0

  // 每行前置 filter byte 0
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, rowStart + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── 像素生成 ─────────────────────────────────────────────────

/** mulberry32 PRNG（定种子 → 图标可复现）。 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * 渲染一档图标。safeScale：maskable 时 0.8（内容缩进 20% 安全区），常规 1。
 * 独立按尺寸渲染，不做缩放。
 */
function renderIcon(size, safeScale) {
  const px = new Float64Array(size * size * 3); // 线性累加后再量化
  const cx = size / 2;
  const cy = size / 2;

  // 1. 深空径向底：中心 #0a0d22 → 边缘 #05060f
  const c0 = [5 / 255, 6 / 255, 15 / 255];
  const c1 = [10 / 255, 13 / 255, 34 / 255];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy) / (size * 0.62);
      const t = clamp01(d);
      const i = (y * size + x) * 3;
      px[i] = c1[0] + (c0[0] - c1[0]) * t;
      px[i + 1] = c1[1] + (c0[1] - c1[1]) * t;
      px[i + 2] = c1[2] + (c0[2] - c1[2]) * t;
    }
  }

  // 2. 定种子星点（白色，小半径高斯衰减）
  const rand = mulberry32(20260711);
  const starCount = size >= 512 ? 90 : 42;
  for (let s = 0; s < starCount; s++) {
    const sx = rand() * size;
    const sy = rand() * size;
    const r = (0.8 + rand() * 1.2) * (size / 512) + 0.6;
    const a = 0.2 + rand() * 0.6;
    const R = Math.ceil(r * 2.5);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const x = Math.round(sx + dx);
        const y = Math.round(sy + dy);
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.hypot(dx, dy) / r;
        const v = a * Math.exp(-d * d);
        const i = (y * size + x) * 3;
        px[i] += v;
        px[i + 1] += v;
        px[i + 2] += v;
      }
    }
  }

  // 3. 中央品牌星：白核 → rgb(150,165,255) 光晕 → 透明（BrandMark 同款）
  const glowR = 0.32 * size * safeScale;
  const coreR = 0.05 * size * safeScale;
  const nebula = [150 / 255, 165 / 255, 1.0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > glowR) continue;
      const t = d / glowR;
      const intensity = (1 - t) * (1 - t);
      // 核心偏白，向外过渡到 nebula 蓝紫
      const mix = smoothstep(0.12, 0.65, t);
      const r = (1 - mix) * 1 + mix * nebula[0];
      const g = (1 - mix) * 1 + mix * nebula[1];
      const b = (1 - mix) * 1 + mix * nebula[2];
      const i = (y * size + x) * 3;
      px[i] += r * intensity;
      px[i + 1] += g * intensity;
      px[i + 2] += b * intensity;
      // 实心白核（抗锯齿边缘）
      const core = 1 - smoothstep(coreR * 0.8, coreR * 1.15, d);
      px[i] += core;
      px[i + 1] += core;
      px[i + 2] += core;
    }
  }

  // 量化到 RGBA（alpha 恒 255：安装图标不透明底最稳）
  const rgba = new Uint8Array(size * size * 4);
  for (let p = 0; p < size * size; p++) {
    rgba[p * 4] = Math.round(clamp01(px[p * 3]) * 255);
    rgba[p * 4 + 1] = Math.round(clamp01(px[p * 3 + 1]) * 255);
    rgba[p * 4 + 2] = Math.round(clamp01(px[p * 3 + 2]) * 255);
    rgba[p * 4 + 3] = 255;
  }
  return rgba;
}

// ── 主流程 ───────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const targets = [
  { file: 'icon-192.png', size: 192, safe: 1 },
  { file: 'icon-512.png', size: 512, safe: 1 },
  { file: 'icon-maskable-512.png', size: 512, safe: 0.8 },
];

for (const t of targets) {
  const rgba = renderIcon(t.size, t.safe);
  const png = encodePng(t.size, t.size, rgba);
  writeFileSync(join(outDir, t.file), png);
  console.log(`✓ ${t.file}  ${t.size}×${t.size}  ${(png.length / 1024).toFixed(1)} KB`);
}
console.log(`图标已写入 ${outDir}`);
