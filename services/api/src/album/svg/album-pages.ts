/**
 * 纪念册 6 页 SVG 生成器（纯函数，零依赖，可单测）。
 * 全册 1200×1600（3:4 竖版），复用证书 SVG 基建（svg-utils/format/star-map）。
 * 所有用户/星体文本必过 escapeXml。宇宙来信正文由 service 侧先经 AgentService 拿到再传入，本函数只排版、保持纯/确定。
 */
import { formatDateZh, formatDec, formatOccasion, formatRa } from '../../certificate/svg/format';
import { renderStarMapSvg, type StarMapNeighbor } from '../../certificate/svg/star-map';
import {
  escapeXml,
  mulberry32,
  round,
  stringToSeed,
  wrapByGraphemes,
} from '../../certificate/svg/svg-utils';
import { embedSvg } from './svg-embed';

const W = 1200;
const H = 1600;
const CN_FONT = "'Noto Serif SC','Songti SC',serif";
const LATIN_FONT = "'Cinzel','Times New Roman',serif";
const MONO_FONT = "'JetBrains Mono','Courier New',monospace";

/** 纪念册单页的星体资料（比证书多距离/光谱/星表编号）。 */
export interface AlbumSvgStar {
  nameZh: string;
  nameEn: string;
  constellationZh: string;
  raDeg: number;
  decDeg: number;
  magnitude: number;
  distanceLy?: number | null;
  spectralType?: string | null;
  catalogIds?: Record<string, string> | null;
}

export interface AlbumPagesInput {
  memorialName: string;
  /** OccasionType 码。 */
  occasionCode: string;
  memorialDateIso: string | null;
  registrationNo: string;
  blessingText: string | null;
  storyText: string | null;
  /** 宇宙来信正文（service 先经 AgentService 拿到再传入）。 */
  letter: string;
  star: AlbumSvgStar;
  /** 复用 star-map 的邻域类型；service 用 findNeighbors 提供。 */
  neighbors: StarMapNeighbor[];
  /** 强制传 COMPLIANCE_NOTICE。 */
  compliance: string;
  /** 默认 'v1'。 */
  templateVersion?: string;
}

export type AlbumPageName = 'cover' | 'star-map' | 'story' | 'letter' | 'astro' | 'dedication';

export interface AlbumPage {
  name: AlbumPageName;
  /** 单页完整 <svg>。 */
  svg: string;
}

const PAGE_ORDER: AlbumPageName[] = ['cover', 'star-map', 'story', 'letter', 'astro', 'dedication'];
const PAGE_TOTAL = PAGE_ORDER.length;

/** 生成全册 6 页（长度恒为 6，顺序固定 cover→dedication）。 */
export function renderAlbumPages(input: AlbumPagesInput): AlbumPage[] {
  return [
    { name: 'cover', svg: renderCover(input) },
    { name: 'star-map', svg: renderStarMapPage(input) },
    { name: 'story', svg: renderStory(input) },
    { name: 'letter', svg: renderLetter(input) },
    { name: 'astro', svg: renderAstro(input) },
    { name: 'dedication', svg: renderDedication(input) },
  ];
}

/**
 * 合并长图（零依赖 PDF 替代）：6 页竖排成一张长图 SVG。
 * 逐页用 embedSvg 嵌套，页间深色间隔 + 细线分隔。返回单一自包含 <svg>。
 */
export function renderAlbumCombined(
  pages: AlbumPage[],
  _registrationNo: string,
  _compliance: string,
): string {
  const gap = 40;
  const totalH = H * pages.length + gap * (pages.length - 1);
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${totalH}" width="${W}" height="${totalH}">`,
  );
  parts.push(`<rect x="0" y="0" width="${W}" height="${totalH}" fill="#05070f"/>`);
  pages.forEach((page, i) => {
    const y = i * (H + gap);
    parts.push(embedSvg(page.svg, 0, y, W, H));
    if (i < pages.length - 1) {
      const ly = y + H + gap / 2;
      parts.push(`<line x1="0" y1="${ly}" x2="${W}" y2="${ly}" stroke="#1a2140" stroke-width="1"/>`);
    }
  });
  parts.push(`</svg>`);
  return parts.join('');
}

// ---------------------------------------------------------------------------
// 页级公共骨架（复刻证书私有件，逻辑照搬）
// ---------------------------------------------------------------------------

/** 证书同款 <defs>。 */
function pageDefs(): string {
  return (
    `<defs>` +
    `<radialGradient id="sky" cx="50%" cy="38%" r="75%">` +
    `<stop offset="0%" stop-color="#0a0e27"/>` +
    `<stop offset="100%" stop-color="#05070f"/>` +
    `</radialGradient>` +
    `<linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="0%">` +
    `<stop offset="0%" stop-color="#f5d76e"/>` +
    `<stop offset="50%" stop-color="#b8860b"/>` +
    `<stop offset="100%" stop-color="#f5d76e"/>` +
    `</linearGradient>` +
    `<filter id="glow" x="-20%" y="-20%" width="140%" height="140%">` +
    `<feGaussianBlur stdDeviation="3" result="blur"/>` +
    `<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>` +
    `</filter>` +
    `<radialGradient id="starGlow" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0%" stop-color="#ffffff" stop-opacity="0.9"/>` +
    `<stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>` +
    `</radialGradient>` +
    `</defs>`
  );
}

/** 确定性撒点星背景（种子含页名，各页背景不同但可复现）。约 100 点。 */
function starfield(seedStr: string): string {
  const rand = mulberry32(stringToSeed(seedStr));
  const circles: string[] = [];
  for (let i = 0; i < 100; i++) {
    const cx = round(rand() * W, 1);
    const cy = round(rand() * H, 1);
    const r = round(0.4 + rand() * 1.8, 2);
    const op = round(0.2 + rand() * 0.6, 2);
    circles.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" opacity="${op}"/>`);
  }
  return `<g>${circles.join('')}</g>`;
}

/** 烫金双线边框 + 四角装饰。 */
function pageFrame(): string {
  const inset = 66;
  const len = 60;
  const s = `stroke="url(#gold)" stroke-width="3" fill="none"`;
  return (
    `<rect x="48" y="48" width="${W - 96}" height="${H - 96}" fill="none" stroke="url(#gold)" stroke-width="4" filter="url(#glow)"/>` +
    `<rect x="66" y="66" width="${W - 132}" height="${H - 132}" fill="none" stroke="url(#gold)" stroke-width="1.5" opacity="0.7"/>` +
    `<g>` +
    `<path d="M ${inset} ${inset + len} L ${inset} ${inset} L ${inset + len} ${inset}" ${s}/>` +
    `<path d="M ${W - inset} ${inset + len} L ${W - inset} ${inset} L ${W - inset - len} ${inset}" ${s}/>` +
    `<path d="M ${inset} ${H - inset - len} L ${inset} ${H - inset} L ${inset + len} ${H - inset}" ${s}/>` +
    `<path d="M ${W - inset} ${H - inset - len} L ${W - inset} ${H - inset} L ${W - inset - len} ${H - inset}" ${s}/>` +
    `</g>`
  );
}

/** 页脚：合规脚注（2 行）+ 右下角 编号 · 第 X / N 页。 */
function pageFooter(
  compliance: string,
  registrationNo: string,
  pageIndex: number,
  pageTotal: number,
): string {
  const lines = wrapByGraphemes(compliance, 40, 2);
  return (
    `<text x="${W / 2}" y="${H - 108}" text-anchor="middle" font-family="${CN_FONT}" font-size="17" fill="#7f8aa0">` +
    tspans(lines, W / 2, 24) +
    `</text>` +
    `<text x="${W - 96}" y="${H - 72}" text-anchor="end" font-family="${MONO_FONT}" font-size="18" fill="#d9c37a">` +
    `编号 ${escapeXml(registrationNo)} · 第 ${pageIndex} / ${pageTotal} 页</text>`
  );
}

/** 页开头骨架（svg 开标签 + defs + 背景 + 撒点 + 边框）。 */
function pageOpen(input: AlbumPagesInput, pageName: AlbumPageName): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${CN_FONT}">` +
    pageDefs() +
    `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#sky)"/>` +
    starfield(`${input.registrationNo}:${pageName}`) +
    pageFrame()
  );
}

/** 标题带（居中主标题 + 拉丁副标 + 分隔线）。 */
function pageTitle(zh: string, latin: string): string {
  return (
    `<text x="${W / 2}" y="180" text-anchor="middle" font-family="${CN_FONT}" font-size="52" letter-spacing="8" fill="url(#gold)" filter="url(#glow)">${escapeXml(zh)}</text>` +
    `<text x="${W / 2}" y="228" text-anchor="middle" font-family="${LATIN_FONT}" font-size="22" letter-spacing="5" fill="#d9c37a" opacity="0.85">${escapeXml(latin)}</text>` +
    `<line x1="${W / 2 - 160}" y1="256" x2="${W / 2 + 160}" y2="256" stroke="url(#gold)" stroke-width="1.5" opacity="0.6"/>`
  );
}

// ---------------------------------------------------------------------------
// 第 1 页 封面
// ---------------------------------------------------------------------------
function renderCover(input: AlbumPagesInput): string {
  const { star } = input;
  const parts: string[] = [pageOpen(input, 'cover')];

  parts.push(
    `<text x="${W / 2}" y="300" text-anchor="middle" font-family="${CN_FONT}" font-size="72" letter-spacing="12" fill="url(#gold)" filter="url(#glow)">星辰纪念册</text>`,
  );
  parts.push(
    `<text x="${W / 2}" y="360" text-anchor="middle" font-family="${LATIN_FONT}" font-size="26" letter-spacing="6" fill="#d9c37a" opacity="0.85">Stellar Memorial Album</text>`,
  );

  // 居中大字纪念名
  let y = 620;
  const nameLines = wrapByGraphemes(input.memorialName, 12, 2);
  parts.push(
    `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${CN_FONT}" font-size="64" fill="#f7f3e8">` +
      tspans(
        nameLines.map((l) => `「${l}」`),
        W / 2,
        78,
      ) +
      `</text>`,
  );
  y += 60 + (nameLines.length - 1) * 78 + 90;

  parts.push(centerText(`${star.nameZh} · ${star.nameEn}`, y, 40, '#f5d76e', CN_FONT));
  y += 58;
  parts.push(centerText(`星座 ${star.constellationZh}`, y, 28, '#aab4c8', CN_FONT));
  y += 90;

  const occasion = formatOccasion(input.occasionCode);
  const dateZh = formatDateZh(input.memorialDateIso);
  const line = dateZh ? `${occasion} · ${dateZh}` : occasion;
  parts.push(centerText(line, y, 32, '#cfd6e6', CN_FONT));

  parts.push(pageFooter(input.compliance, input.registrationNo, 1, PAGE_TOTAL));
  parts.push(`</svg>`);
  return parts.join('');
}

// ---------------------------------------------------------------------------
// 第 2 页 星图
// ---------------------------------------------------------------------------
function renderStarMapPage(input: AlbumPagesInput): string {
  const { star } = input;
  const parts: string[] = [pageOpen(input, 'star-map')];
  parts.push(pageTitle('星图 · Star Map', 'Star Map'));

  const mapSvg = renderStarMapSvg({
    target: {
      nameZh: star.nameZh,
      raDeg: star.raDeg,
      decDeg: star.decDeg,
      magnitude: star.magnitude,
      objectUid: (star.catalogIds && star.catalogIds.uid) || star.nameEn,
    },
    neighbors: input.neighbors,
    fovDeg: 30,
    size: 900,
    compliance: input.compliance,
  });
  // 居中：(1200-900)/2 = 150
  parts.push(embedSvg(mapSvg, 150, 380, 900, 900));

  parts.push(centerText('真实天区局部投影', 1340, 26, '#8aa0bf', MONO_FONT));

  parts.push(pageFooter(input.compliance, input.registrationNo, 2, PAGE_TOTAL));
  parts.push(`</svg>`);
  return parts.join('');
}

// ---------------------------------------------------------------------------
// 第 3 页 纪念故事
// ---------------------------------------------------------------------------
function renderStory(input: AlbumPagesInput): string {
  const parts: string[] = [pageOpen(input, 'story')];
  parts.push(pageTitle('纪念故事 · Our Story', 'Our Story'));

  let y = 360;
  const occasion = formatOccasion(input.occasionCode);
  const dateZh = formatDateZh(input.memorialDateIso);
  parts.push(centerText(dateZh ? `${occasion} · ${dateZh}` : occasion, y, 30, '#cfd6e6', CN_FONT));
  y += 90;

  const story = input.storyText && input.storyText.trim() ? input.storyText.trim() : '愿这段心意，被星空温柔收藏。';
  const storyLines = wrapByGraphemes(story, 20, 10);
  parts.push(
    `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${CN_FONT}" font-size="30" fill="#e6dcc4">` +
      tspans(storyLines, W / 2, 52) +
      `</text>`,
  );
  y += storyLines.length * 52 + 60;

  if (input.blessingText && input.blessingText.trim()) {
    const bl = wrapByGraphemes(input.blessingText.trim(), 22, 2);
    parts.push(
      `<text x="${W / 2}" y="${Math.min(y, H - 220)}" text-anchor="middle" font-family="${CN_FONT}" font-size="26" font-style="italic" fill="#f5d76e">` +
        tspans(
          bl.map((l, i) => (i === 0 ? `“${l}` : bl.length - 1 === i ? `${l}”` : l)),
          W / 2,
          40,
        ) +
        `</text>`,
    );
  }

  parts.push(pageFooter(input.compliance, input.registrationNo, 3, PAGE_TOTAL));
  parts.push(`</svg>`);
  return parts.join('');
}

// ---------------------------------------------------------------------------
// 第 4 页 宇宙来信
// ---------------------------------------------------------------------------
function renderLetter(input: AlbumPagesInput): string {
  const parts: string[] = [pageOpen(input, 'letter')];
  parts.push(pageTitle('宇宙来信 · A Letter from the Stars', 'A Letter from the Stars'));

  // 信笺底
  parts.push(
    `<rect x="150" y="320" width="${W - 300}" height="1000" rx="18" fill="#0b1024" stroke="url(#gold)" stroke-width="1.5" opacity="0.5"/>`,
  );

  let y = 400;
  const segments = (input.letter ?? '').split('\n').filter((s) => s.trim().length > 0);
  const lines: string[] = [];
  for (const seg of segments) {
    for (const l of wrapByGraphemes(seg, 22, 6)) lines.push(l);
    lines.push(''); // 段间空行
  }
  parts.push(
    `<text x="220" y="${y}" text-anchor="start" font-family="${CN_FONT}" font-size="30" fill="#e6dcc4">` +
      lines
        .map((l, i) => `<tspan x="220" dy="${i === 0 ? 0 : 48}">${escapeXml(l)}</tspan>`)
        .join('') +
      `</text>`,
  );
  y += lines.length * 48;

  parts.push(
    `<text x="${W - 220}" y="1280" text-anchor="end" font-family="${CN_FONT}" font-size="24" fill="#d9c37a">— 写给「${escapeXml(input.memorialName)}」</text>`,
  );

  parts.push(pageFooter(input.compliance, input.registrationNo, 4, PAGE_TOTAL));
  parts.push(`</svg>`);
  return parts.join('');
}

// ---------------------------------------------------------------------------
// 第 5 页 天文资料
// ---------------------------------------------------------------------------
function renderAstro(input: AlbumPagesInput): string {
  const { star } = input;
  const parts: string[] = [pageOpen(input, 'astro')];
  parts.push(pageTitle('天文资料 · Astrometry', 'Astrometry'));

  parts.push(
    centerText('以下坐标为该星体的真实天文测量数据（历元 J2000.0）。', 340, 24, '#aab4c8', CN_FONT),
  );

  const catIds =
    star.catalogIds && Object.keys(star.catalogIds).length > 0
      ? Object.entries(star.catalogIds)
          .filter(([k]) => k.toLowerCase() !== 'uid')
          .map(([k, v]) => `${k.toUpperCase()} ${v}`)
          .join(' · ')
      : '';
  const rows: [string, string][] = [
    ['赤经 RA', formatRa(star.raDeg)],
    ['赤纬 Dec', formatDec(star.decDeg)],
    ['星座', star.constellationZh],
    ['视星等', String(round(star.magnitude, 2))],
    ['距离', star.distanceLy != null ? `${round(star.distanceLy, 1)} 光年` : '—'],
    ['光谱型', star.spectralType ?? '—'],
    ['星表编号', catIds || '—'],
    ['坐标历元', 'J2000.0'],
  ];

  let y = 460;
  const labelX = 220;
  const valueX = 540;
  for (const [label, value] of rows) {
    parts.push(
      `<text x="${labelX}" y="${y}" font-family="${MONO_FONT}" font-size="28" fill="#8aa0bf">${escapeXml(label)}</text>`,
    );
    const valColor = label === '星表编号' || label === '坐标历元' ? '#f5d76e' : '#9fd6ff';
    parts.push(
      `<text x="${valueX}" y="${y}" font-family="${MONO_FONT}" font-size="28" fill="${valColor}">${escapeXml(value)}</text>`,
    );
    y += 84;
  }

  parts.push(pageFooter(input.compliance, input.registrationNo, 5, PAGE_TOTAL));
  parts.push(`</svg>`);
  return parts.join('');
}

// ---------------------------------------------------------------------------
// 第 6 页 寄语
// ---------------------------------------------------------------------------
function renderDedication(input: AlbumPagesInput): string {
  const parts: string[] = [pageOpen(input, 'dedication')];
  parts.push(pageTitle('谨以此册 · Dedication', 'Dedication'));

  const dedication =
    input.blessingText && input.blessingText.trim()
      ? input.blessingText.trim()
      : '愿这颗星，长明于我们共同的夜空。';
  const dedLines = wrapByGraphemes(dedication, 16, 4);
  parts.push(
    `<text x="${W / 2}" y="500" text-anchor="middle" font-family="${CN_FONT}" font-size="42" font-style="italic" fill="url(#gold)" filter="url(#glow)">` +
      tspans(dedLines, W / 2, 62) +
      `</text>`,
  );

  // 中部装饰星
  parts.push(`<circle cx="${W / 2}" cy="880" r="60" fill="url(#starGlow)"/>`);
  parts.push(`<circle cx="${W / 2}" cy="880" r="6" fill="#fff7dd"/>`);

  // 结尾三行
  parts.push(centerText('星辰纪念 · Stellar Memorial', 1080, 32, '#f5d76e', CN_FONT));
  parts.push(
    centerText(`纪念编号 ${input.registrationNo}`, 1130, 24, '#d9c37a', MONO_FONT),
  );
  const compLines = wrapByGraphemes(input.compliance, 32, 3);
  parts.push(
    `<text x="${W / 2}" y="1200" text-anchor="middle" font-family="${CN_FONT}" font-size="20" fill="#9aa6bd">` +
      tspans(compLines, W / 2, 30) +
      `</text>`,
  );

  parts.push(pageFooter(input.compliance, input.registrationNo, 6, PAGE_TOTAL));
  parts.push(`</svg>`);
  return parts.join('');
}

// ---------------------------------------------------------------------------
// 通用文本 helper
// ---------------------------------------------------------------------------

/** 一行居中文本（自动转义）。 */
function centerText(text: string, y: number, size: number, fill: string, font: string): string {
  return `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${font}" font-size="${size}" fill="${fill}">${escapeXml(text)}</text>`;
}

/** 多行 tspan（统一 escapeXml）。 */
function tspans(lines: string[], x: number, dy: number): string {
  return lines
    .map((l, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : dy}">${escapeXml(l)}</tspan>`)
    .join('');
}
