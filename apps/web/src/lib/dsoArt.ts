/**
 * 程序化 DSO 艺术图（全天体查看器 · ~558 个无照片深空天体的视觉兜底）。
 *
 * 纯 2D 离屏 canvas，确定性随机（mulberry32 + FNV-1a(uid) 种子，思路同
 * posterGenerator）：同一 uid 任何时刻渲染 pixel 级一致，便于回归截图对比。
 * 零网络请求、零纹理文件、零 three 依赖——查看器 DsoArtPane 与卡内缩略图
 * （ViewerPreviewBlock）共用，均为 img/2D，不占 GL 上下文。
 *
 * 分类走 deriveDsoProfile(obj).stage（@star/astro-data 冻结契约）：
 *   galaxy（旋涡/椭圆）· 星云四型（发射/反射/行星状/超新星遗迹）· 星团两型
 *   （球状向心/疏散团块）；非 DSO 类型（卫星/小天体等误入）兜底光晕，
 * 保证「任何 uid 都能画出内容」。
 */

import { deriveDsoProfile, type CelestialObject } from '@star/astro-data';
import { getObjectByUid } from './solarSystem';

type Ctx2D = CanvasRenderingContext2D;
type Rnd = () => number;

// ── 确定性随机（与 posterGenerator 同实现，独立复制避免跨 chunk 耦合） ──

/** FNV-1a 32 位字符串哈希。 */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG（[0,1) 均匀）。 */
function mulberry32(seed: number): Rnd {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 近高斯（3 次均匀和 - 1.5，范围 ±1.5、集中在 0）。 */
function gaussOf(rnd: Rnd): Rnd {
  return () => rnd() + rnd() + rnd() - 1.5;
}

// ── 公共底：深空渐变 + 缩量星野（~120 点） ──

function drawBase(ctx: Ctx2D, S: number, rnd: Rnd): void {
  const bg = ctx.createLinearGradient(0, 0, 0, S);
  bg.addColorStop(0, '#05060f');
  bg.addColorStop(0.5, '#0a0d1f');
  bg.addColorStop(1, '#05060f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);

  for (let i = 0; i < 120; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const a = 0.2 + rnd() * 0.55;
    ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, (0.3 + rnd() * 0.9) * (S / 320), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 4 芒渐变十字线（星团最亮成员 / 兜底光晕用）。 */
function drawSpikes(ctx: Ctx2D, x: number, y: number, len: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  for (let i = 0; i < 2; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI) / 2);
    const g = ctx.createLinearGradient(-len, 0, len, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, color);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-len, -0.6, len * 2, 1.2);
    ctx.restore();
  }
  ctx.restore();
}

// ── 旋涡星系 ──

function drawSpiralGalaxy(ctx: Ctx2D, S: number, rnd: Rnd): void {
  const g = gaussOf(rnd);
  ctx.save();
  ctx.translate(S / 2, S / 2);
  ctx.rotate(rnd() * Math.PI);
  ctx.scale(1, 0.42 + rnd() * 0.3); // 倾角：椭圆压扁

  // 外晕：奶白微光
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.46 * S);
  halo.addColorStop(0, 'rgba(255,244,226,0.08)');
  halo.addColorStop(1, 'rgba(255,244,226,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(-0.5 * S, -0.5 * S, S, S);

  // 双对数螺线旋臂（各 700 点）：内暖外蓝，越外越暗
  const b = 0.17 + rnd() * 0.06;
  const rMax = 0.46 * S;
  for (const arm of [0, Math.PI]) {
    for (let i = 0; i < 700; i++) {
      const theta = (i / 700) * 2.6 * Math.PI;
      const r = 0.045 * S * Math.exp(b * theta);
      if (r > rMax) break;
      const x = r * Math.cos(theta + arm) + g() * 0.05 * S;
      const y = r * Math.sin(theta + arm) + g() * 0.05 * S;
      const t = r / rMax;
      const col = t < 0.35 ? '255,238,210' : '190,205,255';
      const a = (1 - t) * 0.5 * rnd();
      ctx.fillStyle = `rgba(${col},${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, 0.5 + rnd() * 1.1, 0, Math.PI * 2);
      ctx.fill();
      if (rnd() < 0.06) {
        // HII 区：亮蓝点 + 小辉光
        const glow = ctx.createRadialGradient(x, y, 0, x, y, 4);
        glow.addColorStop(0, 'rgba(150,190,255,0.5)');
        glow.addColorStop(1, 'rgba(150,190,255,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(x - 4, y - 4, 8, 8);
        ctx.fillStyle = 'rgba(190,215,255,0.85)';
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // 尘带：贴着螺线内缘（×0.92）的暗色断续弧段
  ctx.strokeStyle = 'rgba(8,6,12,0.35)';
  ctx.lineWidth = 0.015 * S;
  for (const arm of [0, Math.PI]) {
    let prevX: number | null = null;
    let prevY: number | null = null;
    for (let i = 0; i < 220; i++) {
      const theta = (i / 220) * 2.6 * Math.PI;
      const r = 0.045 * S * Math.exp(b * theta) * 0.92;
      if (r > rMax) break;
      const x = r * Math.cos(theta + arm);
      const y = r * Math.sin(theta + arm);
      // 断续：每 9 步画 6 步，留缺口成「段」
      if (prevX != null && prevY != null && i % 9 < 6) {
        ctx.beginPath();
        ctx.moveTo(prevX, prevY);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      prevX = x;
      prevY = y;
    }
  }

  // 核球：暖白亮核
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.13 * S);
  core.addColorStop(0, 'rgba(255,240,215,0.95)');
  core.addColorStop(1, 'rgba(255,240,215,0)');
  ctx.fillStyle = core;
  ctx.fillRect(-0.13 * S, -0.13 * S, 0.26 * S, 0.26 * S);
  ctx.restore();
}

// ── 椭圆星系 ──

function drawEllipticalGalaxy(ctx: Ctx2D, S: number, rnd: Rnd): void {
  const g = gaussOf(rnd);
  ctx.save();
  ctx.translate(S / 2, S / 2);
  ctx.rotate(rnd() * Math.PI);
  ctx.scale(1, 0.55 + rnd() * 0.35);

  // 近似 de Vaucouleurs r^(1/4) 亮度律的多段径向渐变
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.5 * S);
  grad.addColorStop(0, 'rgba(255,244,224,0.9)');
  grad.addColorStop(0.08, 'rgba(255,244,224,0.55)');
  grad.addColorStop(0.25, 'rgba(255,244,224,0.28)');
  grad.addColorStop(0.5, 'rgba(255,244,224,0.12)');
  grad.addColorStop(1, 'rgba(255,244,224,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(-0.5 * S, -0.5 * S, S, S);

  // 老年恒星颗粒感
  for (let i = 0; i < 260; i++) {
    const x = g() * 0.16 * S;
    const y = g() * 0.16 * S;
    const a = 0.05 + rnd() * 0.13;
    ctx.fillStyle = `rgba(255,244,224,${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.4 + rnd() * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── 星云（发射/反射/行星状/超新星遗迹）：低分辨率逐像素 fbm 再放大 ──

type NebulaKind = 'emission' | 'reflection' | 'planetary' | 'snr';

/** 64×64 种子格点值噪声（双线性 + smoothstep 插值），fbm 4 октav。 */
function makeFbm(rnd: Rnd): (x: number, y: number) => number {
  const N = 64;
  const grid = new Float32Array(N * N);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const at = (ix: number, iy: number): number =>
    grid[(((iy % N) + N) % N) * N + (((ix % N) + N) % N)] ?? 0;
  const sample = (x: number, y: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi);
    const bb = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (bb - a) * sx + (c - a) * sy + (a - bb - c + d) * sx * sy;
  };
  return (x, y) => {
    let f = 0;
    let amp = 0.5;
    let fx = x;
    let fy = y;
    for (let o = 0; o < 4; o++) {
      f += amp * sample(fx, fy);
      fx *= 2.03;
      fy *= 2.03;
      amp *= 0.5;
    }
    return Math.min(1, f * 1.07); // 归一到 ~[0,1]
  };
}

function nebulaColor(kind: NebulaKind, n: number): [number, number, number] {
  switch (kind) {
    case 'emission':
      return [180 + 70 * n, 40 + 90 * n, 60 + 40 * n];
    case 'reflection':
      return [70 + 60 * n, 110 + 80 * n, 200 + 55 * n];
    case 'planetary':
      return [90 + 80 * n, 180 + 60 * n, 150 + 50 * n];
    case 'snr':
      return [200 + 55 * n, 120 + 60 * n, 180 + 60 * n];
  }
}

function drawNebula(ctx: Ctx2D, S: number, rnd: Rnd, kind: NebulaKind): void {
  const fbm = makeFbm(rnd);
  const P = 96; // 逐像素分辨率（放大绘制，smoothing 抹平格子感）
  const offX = rnd() * 100;
  const offY = rnd() * 100;

  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = P;
  const tctx = tmp.getContext('2d');
  if (!tctx) return;
  const img = tctx.createImageData(P, P);
  const data = img.data;

  for (let py = 0; py < P; py++) {
    for (let px = 0; px < P; px++) {
      const dx = (px - P / 2) / (P / 2);
      const dy = (py - P / 2) / (P / 2);
      const r = Math.sqrt(dx * dx + dy * dy);
      let n = fbm(px * 0.06 + offX, py * 0.06 + offY);
      if (kind === 'snr') n = 1 - Math.abs(2 * n - 1); // 脊化：细丝缕
      let a = Math.pow(Math.max(0, n), 1.6) * Math.max(0, 1 - r * 1.1);
      if (kind === 'planetary') {
        // 环形壳：中心透、r≈0.55 处最亮
        const d = (r - 0.55) / 0.16;
        a *= Math.exp(-d * d);
      }
      const [cr, cg, cb] = nebulaColor(kind, n);
      const idx = (py * P + px) * 4;
      data[idx] = Math.min(255, cr);
      data[idx + 1] = Math.min(255, cg);
      data[idx + 2] = Math.min(255, cb);
      data[idx + 3] = Math.min(255, Math.round(a * 255));
    }
  }
  tctx.putImageData(img, 0, 0);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.globalCompositeOperation = 'lighter'; // 加色：星云雾叠在星野之上
  ctx.drawImage(tmp, 0, 0, P, P, 0, 0, S, S);
  ctx.globalCompositeOperation = 'source-over';

  // 嵌 12 颗亮星点（星云中的年轻恒星）
  for (let i = 0; i < 12; i++) {
    const x = S * (0.2 + rnd() * 0.6);
    const y = S * (0.2 + rnd() * 0.6);
    const a = 0.5 + rnd() * 0.5;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 3.5 * (S / 320));
    glow.addColorStop(0, `rgba(230,238,255,${(a * 0.7).toFixed(3)})`);
    glow.addColorStop(1, 'rgba(230,238,255,0)');
    ctx.fillStyle = glow;
    const gr = 3.5 * (S / 320);
    ctx.fillRect(x - gr, y - gr, gr * 2, gr * 2);
    ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.9 * (S / 320), 0, Math.PI * 2);
    ctx.fill();
  }

  // 行星状星云：中央白矮星
  if (kind === 'planetary') {
    const c = S / 2;
    const wd = ctx.createRadialGradient(c, c, 0, c, c, 5 * (S / 320));
    wd.addColorStop(0, 'rgba(255,255,255,0.95)');
    wd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = wd;
    const wr = 5 * (S / 320);
    ctx.fillRect(c - wr, c - wr, wr * 2, wr * 2);
  }
  ctx.restore();
}

// ── 星团（复用 ClusterLayer 分布模型：球状向心 u^2.2 / 疏散均匀盘+团块） ──

function drawCluster(ctx: Ctx2D, S: number, rnd: Rnd, glob: boolean): void {
  const g = gaussOf(rnd);
  const c = S / 2;
  const N = glob ? 700 : 130;
  const rMax = glob ? 0.42 * S : 0.4 * S;

  // 球状：中心径向柔光核
  if (glob) {
    const core = ctx.createRadialGradient(c, c, 0, c, c, 0.2 * S);
    core.addColorStop(0, 'rgba(255,232,196,0.5)');
    core.addColorStop(1, 'rgba(255,232,196,0)');
    ctx.fillStyle = core;
    ctx.fillRect(c - 0.2 * S, c - 0.2 * S, 0.4 * S, 0.4 * S);
  }

  // 疏散：预生成 3 个团块中心（微成团结构）
  const clumps: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 3; i++) {
    const ang = rnd() * Math.PI * 2;
    const rr = rnd() * 0.22 * S;
    clumps.push({ x: c + rr * Math.cos(ang), y: c + rr * Math.sin(ang) });
  }

  const bright: Array<{ x: number; y: number; size: number; col: string }> = [];
  for (let i = 0; i < N; i++) {
    const u = rnd();
    const r = glob ? rMax * Math.pow(u, 2.2) : rMax * Math.sqrt(u);
    let x: number;
    let y: number;
    if (!glob && rnd() < 0.3) {
      const clump = clumps[Math.floor(rnd() * 3)] ?? { x: c, y: c };
      x = clump.x + g() * 0.06 * S;
      y = clump.y + g() * 0.06 * S;
    } else {
      const ang = rnd() * Math.PI * 2;
      x = c + r * Math.cos(ang);
      y = c + r * Math.sin(ang);
    }

    let col: string;
    if (glob) {
      // 年老整体暖金 ± 抖动
      const j = Math.round((rnd() - 0.5) * 24);
      col = `${255},${224 + j},${180 + j}`;
    } else {
      col = rnd() < 0.15 ? '255,220,170' : '200,215,255';
    }
    const size = glob
      ? (0.3 + rnd() * 0.9 + (1 - r / rMax) * 0.8) * (S / 320)
      : (0.5 + rnd() * 1.6) * (S / 320);
    const a = 0.35 + rnd() * 0.6;
    ctx.fillStyle = `rgba(${col},${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
    bright.push({ x, y, size, col });
  }

  // 最亮 6 颗补 4 芒十字线
  bright.sort((p, q) => q.size - p.size);
  for (const s of bright.slice(0, 6)) {
    drawSpikes(ctx, s.x, s.y, s.size * 9, `rgba(${s.col},0.55)`);
  }
}

// ── 非 DSO 兜底：三层光晕 + 4 芒（任何 uid 都画得出内容） ──

function drawGlowFallback(ctx: Ctx2D, S: number): void {
  const c = S / 2;
  drawSpikes(ctx, c, c, 0.4 * S, 'rgba(210,220,255,0.5)');
  const glow = ctx.createRadialGradient(c, c, 0, c, c, 0.42 * S);
  glow.addColorStop(0, 'rgba(255,255,255,0.95)');
  glow.addColorStop(0.12, 'rgba(255,255,255,0.85)');
  glow.addColorStop(0.55, 'rgba(160,175,255,0.2)');
  glow.addColorStop(1, 'rgba(160,175,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(c - 0.42 * S, c - 0.42 * S, 0.84 * S, 0.84 * S);
}

// ── 对外 API ──

const DSO_TYPES = new Set<string>(['galaxy', 'nebula', 'cluster']);

/** 渲染一张 size×size 的程序化 DSO 艺术图（同 obj 同 size 永远同图）。 */
export function renderDsoArt(obj: CelestialObject, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const rnd = mulberry32(fnv1a(obj.objectUid));
  drawBase(ctx, size, rnd);

  if (!DSO_TYPES.has(obj.type)) {
    drawGlowFallback(ctx, size);
    return canvas;
  }

  // 防御性收口（Phase 10）：分类异常绝不抛到 React 渲染栈——兜底光晕，保证「永不留黑洞」。
  let stage: string;
  try {
    stage = deriveDsoProfile(obj).stage;
  } catch {
    drawGlowFallback(ctx, size);
    return canvas;
  }
  switch (stage) {
    case 'galaxy':
      // 椭圆星系描述明示；其余 8 成画旋涡（真实旋涡占比亦占多数）
      if (obj.descriptionZh?.includes('椭圆') || rnd() >= 0.8) drawEllipticalGalaxy(ctx, size, rnd);
      else drawSpiralGalaxy(ctx, size, rnd);
      break;
    case 'globular_cluster':
      drawCluster(ctx, size, rnd, true);
      break;
    case 'open_cluster':
      drawCluster(ctx, size, rnd, false);
      break;
    case 'reflection_nebula':
      drawNebula(ctx, size, rnd, 'reflection');
      break;
    case 'planetary_nebula':
      drawNebula(ctx, size, rnd, 'planetary');
      break;
    case 'supernova_remnant':
      drawNebula(ctx, size, rnd, 'snr');
      break;
    default:
      drawNebula(ctx, size, rnd, 'emission');
      break;
  }
  return canvas;
}

/** dataURL 缓存（键 uid@size；超 40 条整表清空，防长会话累积大字符串）。 */
const artUrlCache = new Map<string, string>();

/** 取某 uid 的程序化艺术图 dataURL（未知 uid 亦返回兜底光晕图）。 */
export function getDsoArtURL(uid: string, size: number): string {
  const key = `${uid}@${size}`;
  const hit = artUrlCache.get(key);
  if (hit) return hit;

  const obj = getObjectByUid(uid);
  let canvas: HTMLCanvasElement;
  if (obj) {
    canvas = renderDsoArt(obj, size);
  } else {
    // 目录外 uid：深空底 + 兜底光晕（契约：任何 uid 都能渲染出内容）
    canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      drawBase(ctx, size, mulberry32(fnv1a(uid)));
      drawGlowFallback(ctx, size);
    }
  }
  const url = canvas.toDataURL('image/png');
  if (artUrlCache.size > 40) artUrlCache.clear();
  artUrlCache.set(key, url);
  return url;
}
