/**
 * Web 分享海报生成器（Phase 6B 目标 5）。
 *
 * 纯 2D 离屏 canvas 程序化绘制 1080×1440 PNG，明确不做 WebGL 截图
 * （preserveDrawingBuffer 常驻双倍显存、构图不可控）；本模块不进主 bundle，
 * StarInfoCard 点击「生成分享海报」时 await import 动态加载。
 *
 * 主体视觉按天体类型分派：
 *  - 带照片 DSO → /dso-photos/{imageKey}.jpg 真实照片 + 径向淡出蒙版 + 就地署名；
 *  - 星历天体（行星/日月）→ /textures/planets/*.jpg 贴图圆裁 + 球感明暗 + 署名
 *    （土星补两道程序化椭圆环线）；
 *  - 恒星及其余 → 程序化光晕（按光谱色）+ 衍射星芒。
 * 图片加载失败/超时一律降级程序化视觉，generatePoster 不因资产失败 reject。
 *
 * 星野为确定性随机（objectUid 做种子），同一天体海报可复现，便于回归对比。
 */
import type { CelestialObject } from '@star/astro-data';
import { formatDateZh, formatDec, formatRA } from './format';
import { PLANET_ASSETS } from './planetAssets';
import { spectralColor } from './universe';

export interface PosterInput {
  /** solarSystem.getObjectByUid 结果。 */
  obj: CelestialObject;
  /** 展示坐标（星历/卫星/小天体传实时值，StarInfoCard 已有 coords 级联）。 */
  coords: { raDeg: number; decDeg: number };
  /** 观测城市名（如「北京」）。 */
  cityName: string;
  /** 观测时刻（epoch ms），通常为 observeTime ?? Date.now()。 */
  dateMs: number;
}

const W = 1080;
const H = 1440;
/** 主体视觉中心与直径。 */
const CX = 540;
const CY = 620;
const VISUAL_D = 620;

/** 中文字体栈（canvas 无法加载 webfont，走系统字体）。 */
const FONT_STACK = '-apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';

// ── 确定性随机 ──────────────────────────────────────────────

/** FNV-1a 32 位字符串哈希（星野种子）。 */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG（返回 [0,1) 均匀随机）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 资产加载 ────────────────────────────────────────────────

/** 同源图片加载，4s 超时视为失败（reject 由调用方降级处理）。 */
function loadImage(src: string, timeoutMs = 4000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = window.setTimeout(() => {
      img.src = '';
      reject(new Error('image timeout'));
    }, timeoutMs);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('image error'));
    };
    img.src = src;
  });
}

// ── 各绘制层 ────────────────────────────────────────────────

/** 1. 底色：垂直渐变深空。 */
function drawBackground(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#05060f');
  g.addColorStop(0.5, '#0a0d1f');
  g.addColorStop(1, '#05060f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** 2. 程序化星野（~650 星点 + 2 团星云雾），确定性随机。 */
function drawStarField(ctx: CanvasRenderingContext2D, rand: () => number): void {
  // 星云雾（品牌 nebula 紫蓝色系），先铺在星点之下
  for (let i = 0; i < 2; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const r = 260 + rand() * 240;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(107,115,255,0.06)');
    g.addColorStop(1, 'rgba(107,115,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 650; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const alpha = 0.25 + rand() * 0.65;
    if (rand() < 0.08) {
      // 亮星：加一圈小辉光
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 4);
      glow.addColorStop(0, `rgba(220,228,255,${(alpha * 0.8).toFixed(3)})`);
      glow.addColorStop(1, 'rgba(220,228,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - 4, y - 4, 8, 8);
      ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const r = 0.4 + rand() * 1.0;
      ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** DSO 真实照片：cover 裁切正方形 + 径向淡出蒙版（不做水平翻转，照片本来方向）。 */
async function drawDsoPhoto(ctx: CanvasRenderingContext2D, imageKey: string): Promise<void> {
  const img = await loadImage(`/dso-photos/${imageKey}.jpg`);
  const size = VISUAL_D;
  const tmp = document.createElement('canvas');
  tmp.width = size;
  tmp.height = size;
  const tctx = tmp.getContext('2d');
  if (!tctx) throw new Error('no 2d context');

  // cover 裁切：取图片中央正方形铺满
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - s) / 2;
  const sy = (img.naturalHeight - s) / 2;
  tctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);

  // 径向淡出蒙版（0.68→1 淡出，思路同 dso-photos processPhoto）
  tctx.globalCompositeOperation = 'destination-out';
  const half = size / 2;
  const mask = tctx.createRadialGradient(half, half, 0, half, half, half);
  mask.addColorStop(0, 'rgba(0,0,0,0)');
  mask.addColorStop(0.68, 'rgba(0,0,0,0)');
  mask.addColorStop(1, 'rgba(0,0,0,1)');
  tctx.fillStyle = mask;
  tctx.fillRect(0, 0, size, size);
  tctx.globalCompositeOperation = 'source-over';

  ctx.drawImage(tmp, CX - half, CY - half);
}

/** 星历天体：贴图圆裁 + 晨昏明暗 + 内缘压暗；土星补两道程序化环线。 */
async function drawPlanet(ctx: CanvasRenderingContext2D, uid: string): Promise<void> {
  const asset = PLANET_ASSETS[uid];
  if (!asset) throw new Error('no planet asset');
  const img = await loadImage(asset.textureUrl);
  const r = VISUAL_D / 2 - 40; // 球体半径（给环留白）

  ctx.save();
  ctx.beginPath();
  ctx.arc(CX, CY, r, 0, Math.PI * 2);
  ctx.clip();
  // 贴图为 2:1 等距圆柱投影，取中央区域 cover 绘制
  const srcH = img.naturalHeight;
  const srcW = Math.min(img.naturalWidth, srcH); // 中央正方形
  const sx = (img.naturalWidth - srcW) / 2;
  ctx.drawImage(img, sx, 0, srcW, srcH, CX - r, CY - r, r * 2, r * 2);

  // 晨昏明暗界线：右下暗
  const shade = ctx.createRadialGradient(
    CX - r * 0.45,
    CY - r * 0.45,
    r * 0.2,
    CX,
    CY,
    r * 1.35,
  );
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(0.65, 'rgba(0,0,0,0.1)');
  shade.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = shade;
  ctx.fillRect(CX - r, CY - r, r * 2, r * 2);

  // 圆周内缘压暗（球体感）
  const rim = ctx.createRadialGradient(CX, CY, r * 0.72, CX, CY, r);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = rim;
  ctx.fillRect(CX - r, CY - r, r * 2, r * 2);
  ctx.restore();

  // 土星：两道浅金椭圆环线（不搬 ring 贴图）
  if (uid === 'EPH-SATURN') {
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate((-18 * Math.PI) / 180);
    ctx.strokeStyle = 'rgba(226,205,160,0.5)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.55, r * 0.42, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(226,205,160,0.25)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.72, r * 0.48, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/** 线性 RGB(0–1) → css rgba 串。 */
function rgba(rgb: [number, number, number], a: number): string {
  const [r, g, b] = rgb;
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
}

/** 恒星/降级视觉：三层光晕 + 4 条衍射星芒。tint 为线性 RGB。 */
function drawStarGlow(ctx: CanvasRenderingContext2D, tint: [number, number, number]): void {
  // 星芒（先画，压在光晕之下）：4 条细长渐变矩形，45° 间隔
  ctx.save();
  ctx.translate(CX, CY);
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI) / 4);
    const g = ctx.createLinearGradient(-260, 0, 260, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, rgba(tint, 0.55));
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-260, -1.5, 520, 3);
    ctx.restore();
  }
  ctx.restore();

  // 三层光晕：核心白 → 光谱色晕 → 透明
  const glow = ctx.createRadialGradient(CX, CY, 0, CX, CY, 310);
  glow.addColorStop(0, 'rgba(255,255,255,0.98)');
  glow.addColorStop(60 / 310, 'rgba(255,255,255,0.9)');
  glow.addColorStop(240 / 310, rgba(tint, 0.22));
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(CX - 310, CY - 310, 620, 620);
}

/** 主体视觉分派 + 失败降级。返回署名文本（无需署名时 null）。 */
async function drawSubject(ctx: CanvasRenderingContext2D, obj: CelestialObject): Promise<string | null> {
  // DSO 真实照片
  if (obj.imageKey) {
    try {
      await drawDsoPhoto(ctx, obj.imageKey);
      return obj.imageCredit ? `影像：${obj.imageCredit}` : null;
    } catch {
      // 照片失败 → 星云紫色晕
      drawStarGlow(ctx, [0.62, 0.65, 1.0]);
      return null;
    }
  }
  // 星历天体（行星/日月）
  if (obj.isEphemeris && PLANET_ASSETS[obj.objectUid]) {
    try {
      await drawPlanet(ctx, obj.objectUid);
      // 口径与 credits.json「行星贴图」条目一致
      return '行星贴图：Solar System Scope (INOVE) · CC BY 4.0';
    } catch {
      drawStarGlow(ctx, [1.0, 0.95, 0.84]);
      return null;
    }
  }
  // 恒星（按光谱色）及其余对象（白色光晕）
  const tint =
    obj.type === 'star' ? spectralColor(obj.spectralType) : ([0.78, 0.82, 1.0] as [number, number, number]);
  drawStarGlow(ctx, tint);
  return null;
}

/** 居中文本便捷函数（可选字距，浏览器不支持时静默无字距）。 */
function centerText(
  ctx: CanvasRenderingContext2D,
  text: string,
  y: number,
  font: string,
  color: string,
  letterSpacing?: string,
): void {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if (letterSpacing !== undefined && 'letterSpacing' in c) c.letterSpacing = letterSpacing;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(text, CX, y);
  if (letterSpacing !== undefined && 'letterSpacing' in c) c.letterSpacing = '0px';
}

/** 品牌区：点线光晕圆 + 双行字标（BrandMark 同款视觉）。 */
function drawBrand(ctx: CanvasRenderingContext2D): void {
  const y = 1315;
  // 估算整块宽度做水平居中：图标 44 + 间距 18 + 文本 ~190
  const iconR = 22;
  const blockW = iconR * 2 + 18 + 190;
  const left = CX - blockW / 2;
  const ix = left + iconR;
  const iy = y + 4;

  const halo = ctx.createRadialGradient(ix, iy, 0, ix, iy, iconR);
  halo.addColorStop(0, 'rgba(150,165,255,0.85)');
  halo.addColorStop(0.55, 'rgba(107,115,255,0.35)');
  halo.addColorStop(1, 'rgba(107,115,255,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(ix - iconR, iy - iconR, iconR * 2, iconR * 2);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(ix, iy, 5, 0, Math.PI * 2);
  ctx.fill();

  const tx = left + iconR * 2 + 18;
  ctx.textAlign = 'left';
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in c) c.letterSpacing = '8px';
  ctx.font = `600 34px ${FONT_STACK}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('星辰纪念', tx, y - 2);
  if ('letterSpacing' in c) c.letterSpacing = '10px';
  ctx.font = `400 22px ${FONT_STACK}`;
  ctx.fillStyle = 'rgba(200,206,255,0.6)';
  ctx.fillText('STELLAR MEMORIAL', tx, y + 30);
  if ('letterSpacing' in c) c.letterSpacing = '0px';
}

// ── 对外 API ────────────────────────────────────────────────

/** 生成 1080×1440 PNG Blob；图片资产失败自动降级程序化视觉（仅 toBlob 失败才 reject）。 */
export async function generatePoster(input: PosterInput): Promise<Blob> {
  const { obj, coords, cityName, dateMs } = input;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d 不可用');

  // 1–2. 底色 + 确定性星野
  drawBackground(ctx);
  drawStarField(ctx, mulberry32(fnv1a(obj.objectUid)));

  // 3. 主体视觉（含降级），返回署名
  const credit = await drawSubject(ctx, obj);
  if (credit) {
    centerText(ctx, credit, 966, `400 22px ${FONT_STACK}`, 'rgba(200,206,255,0.45)');
  }

  // 4. 文字区
  centerText(ctx, obj.nameZh, 1060, `600 84px ${FONT_STACK}`, '#ffffff');
  const enLine = `${obj.commonNameZh ? `${obj.commonNameZh} · ` : ''}${obj.nameEn}${obj.bayer ? ` · ${obj.bayer}` : ''}`;
  centerText(ctx, enLine, 1112, `400 30px ${FONT_STACK}`, 'rgba(200,206,255,0.7)', '6px');
  centerText(
    ctx,
    `赤经 ${formatRA(coords.raDeg)}   赤纬 ${formatDec(coords.decDeg)}`,
    1162,
    `400 26px ${FONT_STACK}`,
    'rgba(200,206,255,0.55)',
  );
  const magPart = obj.type === 'satellite' ? '' : `视星等 ${obj.magnitude.toFixed(2)} · `;
  centerText(
    ctx,
    `${obj.constellationZh ? `${obj.constellationZh} · ` : ''}${magPart}${cityName}观测 · ${formatDateZh(new Date(dateMs).toISOString())}`,
    1200,
    `400 26px ${FONT_STACK}`,
    'rgba(200,206,255,0.55)',
  );

  // 5. 分隔细线
  const line = ctx.createLinearGradient(CX - 160, 0, CX + 160, 0);
  line.addColorStop(0, 'rgba(150,165,255,0)');
  line.addColorStop(0.5, 'rgba(150,165,255,0.4)');
  line.addColorStop(1, 'rgba(150,165,255,0)');
  ctx.fillStyle = line;
  ctx.fillRect(CX - 160, 1246, 320, 1);

  // 6. 品牌区
  drawBrand(ctx);

  // 7. 合规脚注
  centerText(
    ctx,
    '私人纪念命名登记，不代表 IAU 或任何官方天文机构命名 · 仅供纪念与欣赏',
    1402,
    `400 22px ${FONT_STACK}`,
    'rgba(200,206,255,0.4)',
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('海报导出失败'));
    }, 'image/png');
  });
}

/**
 * 触发浏览器下载。iOS Safari 对 a[download] 的行为是新标签打开图片，
 * 用户可长按保存——不做 UA 分支，行为可接受。
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
