/**
 * 星图 SVG 生成器（纯函数，零依赖，可单测）。
 * 局部天区 gnomonic 投影，圆形裁剪，目标星金色高亮。
 */
import { formatDec, formatRa } from './format';
import { gnomonicProject } from './projection';
import { clamp, escapeXml, round } from './svg-utils';

export interface StarMapNeighbor {
  nameZh?: string;
  raDeg: number;
  decDeg: number;
  magnitude: number;
  objectUid: string;
}

export interface StarMapSvgInput {
  target: {
    nameZh: string;
    raDeg: number;
    decDeg: number;
    magnitude: number;
    objectUid: string;
  };
  /** 已按角距筛好、含或不含 target 均可（内部按 uid 去重 target）。 */
  neighbors: StarMapNeighbor[];
  /** 视场直径（度），默认 30。 */
  fovDeg?: number;
  /** 正方形边长 px，默认 900。 */
  size?: number;
  /** 可选脚注。 */
  compliance?: string;
}

const D2R = Math.PI / 180;

export function renderStarMapSvg(input: StarMapSvgInput): string {
  const size = input.size ?? 900;
  const fovDeg = input.fovDeg ?? 30;
  const { target } = input;
  const cx = size / 2;
  const cy = size / 2;
  const viewR = size / 2 - 40; // 圆盘半径（留边）
  const fovRad = fovDeg * D2R;
  // 切平面单位（弧度）→ 屏幕像素：半径映射到半个视场
  const scale = viewR / Math.tan(fovRad / 2);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`,
  );
  parts.push(defs());
  parts.push(`<clipPath id="disc"><circle cx="${cx}" cy="${cy}" r="${viewR}"/></clipPath>`);
  parts.push(`<rect x="0" y="0" width="${size}" height="${size}" fill="#05070f"/>`);
  parts.push(
    `<circle cx="${cx}" cy="${cy}" r="${viewR}" fill="url(#disc-bg)" stroke="url(#gold)" stroke-width="2"/>`,
  );

  // 天区内容（裁剪到圆盘）
  const inner: string[] = [];
  // 淡金十字准星
  inner.push(
    `<line x1="${cx}" y1="${cy - viewR}" x2="${cx}" y2="${cy + viewR}" stroke="#d9c37a" stroke-width="0.6" opacity="0.25"/>`,
  );
  inner.push(
    `<line x1="${cx - viewR}" y1="${cy}" x2="${cx + viewR}" y2="${cy}" stroke="#d9c37a" stroke-width="0.6" opacity="0.25"/>`,
  );

  // 邻域星（跳过 target）
  for (const n of input.neighbors) {
    if (n.objectUid === target.objectUid) continue;
    const { x, y } = gnomonicProject(target.raDeg, target.decDeg, n.raDeg, n.decDeg);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    // 东在左 → screenX 取负；北在上 → screenY 取负
    const sx = cx - x * scale;
    const sy = cy - y * scale;
    // 视场外剔除（落在圆盘外）
    const dist = Math.hypot(sx - cx, sy - cy);
    if (dist > viewR) continue;
    const r = clamp(1 + (6 - n.magnitude) * 0.9, 1, 7);
    const op = clamp(0.35 + (6 - n.magnitude) * 0.11, 0.3, 1);
    inner.push(
      `<circle cx="${round(sx, 1)}" cy="${round(sy, 1)}" r="${round(r, 2)}" fill="#dfe8ff" opacity="${round(op, 2)}"/>`,
    );
  }

  // 目标星高亮（其真实投影位，通常近中心）
  const tp = gnomonicProject(target.raDeg, target.decDeg, target.raDeg, target.decDeg);
  const tsx = cx - tp.x * scale;
  const tsy = cy - tp.y * scale;
  inner.push(
    `<g data-role="target">` +
      `<circle cx="${round(tsx, 1)}" cy="${round(tsy, 1)}" r="18" fill="none" stroke="url(#gold)" stroke-width="2" filter="url(#glow)"/>` +
      `<circle cx="${round(tsx, 1)}" cy="${round(tsy, 1)}" r="4.5" fill="#fff7dd"/>` +
      `<text x="${round(tsx + 26, 1)}" y="${round(tsy + 6, 1)}" font-family="'Noto Serif SC','Songti SC',serif" font-size="26" fill="#f5d76e">${escapeXml(target.nameZh)}</text>` +
      `</g>`,
  );

  parts.push(`<g clip-path="url(#disc)">${inner.join('')}</g>`);

  // 圆盘边缘信息
  parts.push(
    `<text x="${cx}" y="${size - 18}" text-anchor="middle" font-family="'JetBrains Mono','Courier New',monospace" font-size="18" fill="#8aa0bf">视场 ${fovDeg}° · 中心 RA ${formatRa(target.raDeg)} Dec ${formatDec(target.decDeg)}</text>`,
  );

  if (input.compliance && input.compliance.trim()) {
    parts.push(
      `<text x="${cx}" y="22" text-anchor="middle" font-family="'Noto Serif SC','Songti SC',serif" font-size="14" fill="#5f6b82">${escapeXml(input.compliance.slice(0, 48))}</text>`,
    );
  }

  parts.push(`</svg>`);
  return parts.join('');
}

function defs(): string {
  return (
    `<defs>` +
    `<radialGradient id="disc-bg" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0%" stop-color="#0d1330"/>` +
    `<stop offset="100%" stop-color="#070a18"/>` +
    `</radialGradient>` +
    `<linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%">` +
    `<stop offset="0%" stop-color="#f5d76e"/>` +
    `<stop offset="100%" stop-color="#b8860b"/>` +
    `</linearGradient>` +
    `<filter id="glow" x="-50%" y="-50%" width="200%" height="200%">` +
    `<feGaussianBlur stdDeviation="3" result="blur"/>` +
    `<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>` +
    `</filter>` +
    `</defs>`
  );
}
