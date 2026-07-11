/**
 * 证书 SVG 生成器（纯函数，零依赖，可单测）。
 * 暗黑星空 + 烫金风格，3:4 竖版，适合打印。所有用户/星体文本必过 escapeXml。
 */
import { formatDateZh, formatDec, formatOccasion, formatRa } from './format';
import { escapeXml, mulberry32, round, stringToSeed, wrapByGraphemes } from './svg-utils';

export interface CertificateSvgStar {
  nameZh: string;
  nameEn: string;
  constellationZh: string;
  raDeg: number;
  decDeg: number;
  magnitude: number;
}

export interface CertificateSvgInput {
  /** 星星纪念名（用户文案，需转义/折叠）。 */
  memorialName: string;
  /** OccasionType 码 → 内部转中文。 */
  occasionCode: string;
  memorialDateIso: string | null;
  /** STAR-YYYYMMDD-XXXX。 */
  registrationNo: string;
  /** 想说的话（可空）。 */
  blessingText: string | null;
  star: CertificateSvgStar;
  /** 传入 COMPLIANCE_NOTICE（脚注，强制）。 */
  compliance: string;
  /** 默认 'v1'。 */
  templateVersion?: string;
}

const W = 1200;
const H = 1600;
const CN_FONT = "'Noto Serif SC','Songti SC',serif";
const LATIN_FONT = "'Cinzel','Times New Roman',serif";
const MONO_FONT = "'JetBrains Mono','Courier New',monospace";

/** 生成完整独立 SVG 字符串（不含 XML 声明，前端可内联）。 */
export function renderCertificateSvg(input: CertificateSvgInput): string {
  const { star } = input;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${CN_FONT}">`,
  );
  parts.push(defs());
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="url(#sky)"/>`);
  parts.push(starfield(input.registrationNo));

  // 烫金双线边框 + 四角装饰
  parts.push(
    `<rect x="48" y="48" width="${W - 96}" height="${H - 96}" fill="none" stroke="url(#gold)" stroke-width="4" filter="url(#glow)"/>`,
  );
  parts.push(
    `<rect x="66" y="66" width="${W - 132}" height="${H - 132}" fill="none" stroke="url(#gold)" stroke-width="1.5" opacity="0.7"/>`,
  );
  parts.push(corners());

  // 标题区
  parts.push(
    `<text x="${W / 2}" y="240" text-anchor="middle" font-family="${CN_FONT}" font-size="72" letter-spacing="12" fill="url(#gold)" filter="url(#glow)">星辰纪念证书</text>`,
  );
  parts.push(
    `<text x="${W / 2}" y="300" text-anchor="middle" font-family="${LATIN_FONT}" font-size="26" letter-spacing="6" fill="#d9c37a" opacity="0.85">Stellar Memorial Certificate</text>`,
  );
  parts.push(
    `<line x1="${W / 2 - 180}" y1="336" x2="${W / 2 + 180}" y2="336" stroke="url(#gold)" stroke-width="1.5" opacity="0.6"/>`,
  );

  // 主体
  let y = 460;
  const nameLines = wrapByGraphemes(input.memorialName, 12, 2);
  parts.push(
    `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${CN_FONT}" font-size="60" fill="#f7f3e8">` +
      tspans(nameLines.map((l) => `「${l}」`), W / 2, 72) +
      `</text>`,
  );
  y += 60 + (nameLines.length - 1) * 72 + 70;

  const occasion = formatOccasion(input.occasionCode);
  const dateZh = formatDateZh(input.memorialDateIso);
  const line1 = dateZh ? `${occasion} · ${dateZh}` : occasion;
  parts.push(centerText(line1, y, 32, '#cfd6e6', CN_FONT));
  y += 80;

  parts.push(centerText(`${star.nameZh} · ${star.nameEn}`, y, 40, '#f5d76e', CN_FONT));
  y += 58;
  parts.push(centerText(`星座 ${star.constellationZh}`, y, 28, '#aab4c8', CN_FONT));
  y += 66;

  parts.push(
    centerText(
      `RA ${formatRa(star.raDeg)}  ·  Dec ${formatDec(star.decDeg)}`,
      y,
      26,
      '#9fd6ff',
      MONO_FONT,
    ),
  );
  y += 48;
  parts.push(centerText(`视星等 ${round(star.magnitude, 2)}`, y, 24, '#8aa0bf', MONO_FONT));
  y += 90;

  // 祝福区（可选）
  if (input.blessingText && input.blessingText.trim()) {
    const blessingLines = wrapByGraphemes(input.blessingText.trim(), 22, 3);
    parts.push(
      `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${CN_FONT}" font-size="28" font-style="italic" fill="#e6dcc4">` +
        tspans(
          blessingLines.map((l, i) =>
            i === 0
              ? `“${l}${i === blessingLines.length - 1 ? '”' : ''}`
              : i === blessingLines.length - 1
                ? `${l}”`
                : l,
          ),
          W / 2,
          44,
        ) +
        `</text>`,
    );
    y += blessingLines.length * 44 + 40;
  }

  // 纪念编号（右下）
  parts.push(
    `<text x="${W - 96}" y="${H - 150}" text-anchor="end" font-family="${MONO_FONT}" font-size="22" fill="#d9c37a">证书编号 ${escapeXml(input.registrationNo)}</text>`,
  );

  // 合规脚注（强制，不得省略/改文案）
  const complianceLines = wrapByGraphemes(input.compliance, 40, 3);
  parts.push(
    `<text x="${W / 2}" y="${H - 96}" text-anchor="middle" font-family="${CN_FONT}" font-size="18" fill="#7f8aa0">` +
      tspans(complianceLines, W / 2, 26) +
      `</text>`,
  );

  parts.push(`</svg>`);
  return parts.join('');
}

/** 一行居中文本。 */
function centerText(
  text: string,
  y: number,
  size: number,
  fill: string,
  font: string,
): string {
  return `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${font}" font-size="${size}" fill="${fill}">${escapeXml(text)}</text>`;
}

/** 多行 tspan（内容已需转义——调用方传入的是已格式化文本，这里统一 escapeXml）。 */
function tspans(lines: string[], x: number, dy: number): string {
  return lines
    .map(
      (l, i) =>
        `<tspan x="${x}" dy="${i === 0 ? 0 : dy}">${escapeXml(l)}</tspan>`,
    )
    .join('');
}

function defs(): string {
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

/** 确定性撒点星背景（以 registrationNo 为种子），约 120 点。 */
function starfield(seedStr: string): string {
  const rand = mulberry32(stringToSeed(seedStr));
  const circles: string[] = [];
  for (let i = 0; i < 120; i++) {
    const cx = round(rand() * W, 1);
    const cy = round(rand() * H, 1);
    const r = round(0.4 + rand() * 1.8, 2);
    const op = round(0.2 + rand() * 0.6, 2);
    circles.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" opacity="${op}"/>`);
  }
  return `<g>${circles.join('')}</g>`;
}

/** 四角烫金装饰。 */
function corners(): string {
  const inset = 66;
  const len = 60;
  const s = `stroke="url(#gold)" stroke-width="3" fill="none"`;
  return (
    `<g>` +
    `<path d="M ${inset} ${inset + len} L ${inset} ${inset} L ${inset + len} ${inset}" ${s}/>` +
    `<path d="M ${W - inset} ${inset + len} L ${W - inset} ${inset} L ${W - inset - len} ${inset}" ${s}/>` +
    `<path d="M ${inset} ${H - inset - len} L ${inset} ${H - inset} L ${inset + len} ${H - inset}" ${s}/>` +
    `<path d="M ${W - inset} ${H - inset - len} L ${W - inset} ${H - inset} L ${W - inset - len} ${H - inset}" ${s}/>` +
    `</g>`
  );
}
