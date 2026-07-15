/**
 * 星座艺术图卡元数据（20 幅自绘 SVG 发光线稿的天球锚定参数）。
 *
 * SVG 文件位于 public/constellation-art/{abbr 小写}.svg，均为本项目原创绘制
 * （文件内嵌 CC0 声明），绝无第三方版权图像。
 * 渲染方式见 ConstellationArt 组件：切平面 Mesh 锚死在天球上（非 billboard），
 * rollDeg 手调使形象姿态骑准真实星点走向。
 */

export interface ConstellationArtMeta {
  /** IAU 3 字母缩写，如 'Ori'。 */
  con: string;
  /** 天球锚点（度）；默认取连线质心附近，可手工偏移让形象骑准星点。 */
  raDeg: number;
  decDeg: number;
  /** 长边角尺寸（度）≈ 外接角半径×2×1.15。 */
  sizeDeg: number;
  /** 绕视线法线旋转（度），对齐星点走向（手调初值）。 */
  rollDeg: number;
  /** 宽高比（与 SVG 构图一致；均为方形画布 1）。 */
  aspect: number;
}

/**
 * 12 黄道 + 8 著名星座（Ori/UMa/Cas/Cyg + 自选 Lyr/Aql/Peg/Cru）。
 *
 * 锚点/尺寸经真实星点投影校准：SVG 画布按「RA+ 向屏幕左（东）、Dec+ 向上」
 * 的观星方向作画，px = 256 − (ra−anchorRa)·cos(dec)·(512/sizeDeg)，
 * py = 256 − (dec−anchorDec)·(512/sizeDeg)。关键星（猎户七星、北斗、
 * 仙后 W、秋季四边形、南十字四星等）在图中骑准真实星点。
 */
export const CONSTELLATION_ART: ConstellationArtMeta[] = [
  // ── 12 黄道 ──
  { con: 'Ari', raDeg: 31, decDeg: 20, sizeDeg: 16, rollDeg: 0, aspect: 1 },
  { con: 'Tau', raDeg: 67, decDeg: 16, sizeDeg: 20, rollDeg: 0, aspect: 1 },
  { con: 'Gem', raDeg: 107, decDeg: 22, sizeDeg: 24, rollDeg: 0, aspect: 1 },
  { con: 'Cnc', raDeg: 130, decDeg: 16, sizeDeg: 16, rollDeg: 0, aspect: 1 },
  { con: 'Leo', raDeg: 164, decDeg: 17, sizeDeg: 30, rollDeg: 0, aspect: 1 },
  { con: 'Vir', raDeg: 196, decDeg: -1, sizeDeg: 28, rollDeg: 0, aspect: 1 },
  { con: 'Lib', raDeg: 228, decDeg: -16, sizeDeg: 16, rollDeg: 0, aspect: 1 },
  { con: 'Sco', raDeg: 252, decDeg: -32, sizeDeg: 28, rollDeg: 0, aspect: 1 },
  { con: 'Sgr', raDeg: 280, decDeg: -28, sizeDeg: 20, rollDeg: 0, aspect: 1 },
  { con: 'Cap', raDeg: 315, decDeg: -18, sizeDeg: 24, rollDeg: 0, aspect: 1 },
  { con: 'Aqr', raDeg: 334, decDeg: -8, sizeDeg: 26, rollDeg: 0, aspect: 1 },
  { con: 'Psc', raDeg: 15, decDeg: 12, sizeDeg: 22, rollDeg: 0, aspect: 1 },
  // ── 8 著名 ──
  { con: 'Ori', raDeg: 83.2, decDeg: -1.5, sizeDeg: 24, rollDeg: 0, aspect: 1 },
  { con: 'UMa', raDeg: 186, decDeg: 54, sizeDeg: 30, rollDeg: 0, aspect: 1 },
  { con: 'Cas', raDeg: 15, decDeg: 60, sizeDeg: 18, rollDeg: 0, aspect: 1 },
  { con: 'Cyg', raDeg: 303, decDeg: 38, sizeDeg: 28, rollDeg: 0, aspect: 1 },
  { con: 'Lyr', raDeg: 283, decDeg: 36, sizeDeg: 12, rollDeg: 0, aspect: 1 },
  { con: 'Aql', raDeg: 296, decDeg: 4, sizeDeg: 22, rollDeg: 0, aspect: 1 },
  { con: 'Peg', raDeg: 352, decDeg: 21, sizeDeg: 26, rollDeg: 0, aspect: 1 },
  { con: 'Cru', raDeg: 187.5, decDeg: -60, sizeDeg: 12, rollDeg: 0, aspect: 1 },
];

/** 按缩写查艺术图元数据。 */
export const CONSTELLATION_ART_BY_CON: Map<string, ConstellationArtMeta> = new Map(
  CONSTELLATION_ART.map((a) => [a.con, a]),
);

/** 某星座是否有精绘艺术图。 */
export function hasConstellationArt(abbr: string): boolean {
  return CONSTELLATION_ART_BY_CON.has(abbr);
}

/** 艺术图 SVG 的公网路径。 */
export function constellationArtUrl(abbr: string): string {
  return `/constellation-art/${abbr.toLowerCase()}.svg`;
}
