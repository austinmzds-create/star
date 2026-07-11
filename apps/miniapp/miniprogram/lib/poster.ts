import type { MemorialView } from './api';
import { COMPLIANCE_NOTICE } from './api';
import { raDecText } from './format';

/**
 * 海报绘制：竖版星空海报（星空 + 纪念名 + 祝福 + 坐标 + 合规脚注）。
 * 用 Canvas 2D 新接口（type="2d"），程序化撒星点，不依赖外部图片资源。
 * 无 DOM lib，故用结构化的最小 Ctx2D 接口约束用到的方法，保持 typecheck 独立。
 */

/** 逻辑画布尺寸（竖版）。真实像素按 dpr 缩放。 */
export const POSTER_W = 750;
export const POSTER_H = 1334;

/** 本模块用到的 2D 上下文子集（结构化类型，避免依赖 DOM lib）。 */
export interface Ctx2D {
  fillStyle: string | object;
  strokeStyle: string | object;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  beginPath(): void;
  arc(
    x: number,
    y: number,
    r: number,
    start: number,
    end: number,
    anticlockwise?: boolean,
  ): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  save(): void;
  restore(): void;
  scale(x: number, y: number): void;
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): { addColorStop(offset: number, color: string): void };
}

/** 32 位整数种子的确定性伪随机（mulberry32），保证同一颗星海报星点一致。 */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 从字符串生成种子。 */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 文本自动换行绘制，返回绘制后的下一个 y。 */
export function wrapText(
  ctx: Ctx2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  charsPerLine: number,
): number {
  // 小程序 measureText 在部分场景不稳定，这里用「每行最多 N 字」的近似换行（中文等宽近似）。
  let line = '';
  let curY = y;
  for (const ch of text) {
    if (ch === '\n' || line.length >= charsPerLine) {
      ctx.fillText(line, x, curY);
      curY += lineHeight;
      line = ch === '\n' ? '' : ch;
    } else {
      line += ch;
    }
  }
  if (line.length > 0) {
    ctx.fillText(line, x, curY);
    curY += lineHeight;
  }
  // maxWidth 目前作为语义占位（等宽近似不依赖真实测量）。
  void maxWidth;
  return curY;
}

/** 在给定 2D 上下文上绘制整张海报（逻辑坐标系，调用前应已 scale(dpr)）。 */
export function drawPoster(ctx: Ctx2D, view: MemorialView): void {
  const w = POSTER_W;
  const h = POSTER_H;

  // 1. 深蓝径向渐变背景
  const bg = ctx.createRadialGradient(w / 2, h * 0.32, 40, w / 2, h * 0.32, h);
  bg.addColorStop(0, '#1b2547');
  bg.addColorStop(0.5, '#0e1428');
  bg.addColorStop(1, '#070a16');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // 2. 程序化星点（种子来自星体 uid + 赤经，保证确定性）
  const rng = makeRng(hashSeed(view.star.objectUid) ^ Math.round(view.star.raDeg * 1000));
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 120; i += 1) {
    const sx = rng() * w;
    const sy = rng() * (h * 0.62);
    const r = rng() * 1.6 + 0.4;
    ctx.globalAlpha = rng() * 0.7 + 0.2;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 3. 目标星高亮：金色光点 + 十字星芒
  const cx = w / 2;
  const cy = h * 0.28;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 90);
  glow.addColorStop(0, 'rgba(244,213,141,0.95)');
  glow.addColorStop(0.4, 'rgba(244,213,141,0.35)');
  glow.addColorStop(1, 'rgba(244,213,141,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, 90, 0, Math.PI * 2);
  ctx.fill();
  // 星芒
  ctx.strokeStyle = 'rgba(244,213,141,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 70, cy);
  ctx.lineTo(cx + 70, cy);
  ctx.moveTo(cx, cy - 70);
  ctx.lineTo(cx, cy + 70);
  ctx.stroke();
  // 核心亮点
  ctx.fillStyle = '#fff8e6';
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fill();

  // 纪念名（金色大字）
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f4d58d';
  ctx.font = 'bold 56px sans-serif';
  ctx.fillText(truncate(view.memorialName, 12), cx, h * 0.44);

  // 真实星名 / 星座（小字）
  ctx.fillStyle = '#9aa6c4';
  ctx.font = '26px sans-serif';
  ctx.fillText(
    `${view.star.nameZh} · ${view.star.nameEn} · ${view.star.constellationZh}`,
    cx,
    h * 0.49,
  );

  // 4. 祝福语（自动换行）
  if (view.blessing) {
    ctx.fillStyle = '#eef2ff';
    ctx.font = '30px sans-serif';
    ctx.textAlign = 'center';
    wrapText(ctx, view.blessing, cx, h * 0.56, w - 120, 46, 16);
  }

  // 5. 坐标 + 登记编号
  ctx.fillStyle = '#7f8bb0';
  ctx.font = '24px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(raDecText(view.star.raDeg, view.star.decDeg), cx, h * 0.7);
  ctx.fillText(`登记编号 ${view.registrationNo}`, cx, h * 0.7 + 40);

  // 6. 合规脚注（全文换行，必须出现）
  ctx.fillStyle = '#68738f';
  ctx.font = '20px sans-serif';
  ctx.textAlign = 'center';
  wrapText(ctx, COMPLIANCE_NOTICE, cx, h * 0.82, w - 100, 32, 24);

  // 7. 底部品牌 + 小程序码占位
  ctx.fillStyle = '#f4d58d';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('星辰纪念 · 扫码找到你的星', cx, h - 70);
  // 小程序码占位方框（真机可替换为后端生成的码）
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(w - 130, h - 130, 90, 90);
  ctx.fillStyle = '#68738f';
  ctx.font = '16px sans-serif';
  ctx.fillText('小程序码', w - 85, h - 25);
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
