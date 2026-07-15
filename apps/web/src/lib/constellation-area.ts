/**
 * IAU 88 星座天区面积表（平方度，1930 年 IAU 官方边界的公开数据）。
 *
 * 用途：星座富面板的「全天第 N 大 · 约 X 平方度」一行。
 * 排名在模块加载期由面积降序一次算好；校验锚点：Hya 1303 第 1、
 * Vir 1294 第 2、UMa 1280 第 3、Cru 68 第 88（typecheck 级自证见富面板消费端）。
 * 面积仅是天区大小的客观事实，与命名/产权无任何关联。
 */

export const CONSTELLATION_AREA_SQDEG: Record<string, number> = {
  And: 722.3,
  Ant: 238.9,
  Aps: 206.3,
  Aqr: 979.9,
  Aql: 652.5,
  Ara: 237.1,
  Ari: 441.4,
  Aur: 657.4,
  Boo: 906.8,
  Cae: 124.9,
  Cam: 756.8,
  Cnc: 505.9,
  CVn: 465.2,
  CMa: 380.1,
  CMi: 183.4,
  Cap: 413.9,
  Car: 494.2,
  Cas: 598.4,
  Cen: 1060.4,
  Cep: 587.8,
  Cet: 1231.4,
  Cha: 131.6,
  Cir: 93.4,
  Col: 270.2,
  Com: 386.5,
  CrA: 127.7,
  CrB: 178.7,
  Crv: 183.8,
  Crt: 282.4,
  Cru: 68.4,
  Cyg: 804.0,
  Del: 188.5,
  Dor: 179.2,
  Dra: 1083.0,
  Equ: 71.6,
  Eri: 1137.9,
  For: 397.5,
  Gem: 513.8,
  Gru: 365.5,
  Her: 1225.1,
  Hor: 248.9,
  Hya: 1302.8,
  Hyi: 243.0,
  Ind: 294.0,
  Lac: 200.7,
  Leo: 947.0,
  LMi: 232.0,
  Lep: 290.3,
  Lib: 538.1,
  Lup: 333.7,
  Lyn: 545.4,
  Lyr: 286.5,
  Men: 153.5,
  Mic: 209.5,
  Mon: 481.6,
  Mus: 138.4,
  Nor: 165.3,
  Oct: 291.0,
  Oph: 948.3,
  Ori: 594.1,
  Pav: 377.7,
  Peg: 1120.8,
  Per: 615.0,
  Phe: 469.3,
  Pic: 246.7,
  Psc: 889.4,
  PsA: 245.4,
  Pup: 673.4,
  Pyx: 220.8,
  Ret: 113.9,
  Sge: 79.9,
  Sgr: 867.4,
  Sco: 496.8,
  Scl: 474.8,
  Sct: 109.1,
  Ser: 636.9,
  Sex: 313.5,
  Tau: 797.2,
  Tel: 251.5,
  Tri: 131.8,
  TrA: 110.0,
  Tuc: 294.6,
  UMa: 1279.7,
  UMi: 255.9,
  Vel: 499.6,
  Vir: 1294.4,
  Vol: 141.4,
  Vul: 268.2,
};

/** 缩写 → 面积排名（1 = 全天最大）；模块加载期一次排序构建。 */
const RANK_BY_ABBR: Map<string, number> = new Map(
  Object.entries(CONSTELLATION_AREA_SQDEG)
    .sort((a, b) => b[1] - a[1])
    .map(([abbr], i) => [abbr, i + 1]),
);

/** 某座的面积与排名；未知缩写（数据漂移兜底）返回 null。 */
export function getConstellationArea(abbr: string): { areaSqDeg: number; rank: number } | null {
  const area = CONSTELLATION_AREA_SQDEG[abbr];
  const rank = RANK_BY_ABBR.get(abbr);
  if (area === undefined || rank === undefined) return null;
  return { areaSqDeg: area, rank };
}
