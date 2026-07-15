import { CONSTELLATION_ABBR, CONSTELLATION_ZH } from './constellations';
// 注：不用 import 属性（with { type: 'json' }），以兼容各消费端 tsconfig 的 module 设置；
// resolveJsonModule 已在 tsconfig.base.json 开启，普通 JSON import 三端（vitest/Next/Nest webpack）均可。
import brightStars from './generated/bright-stars.json';
import deepSky from './generated/deep-sky.json';
import type { CelestialObject, CelestialObjectType } from './types';

/**
 * 精选星表原始数据（真实 J2000 天文数据）。
 * 坐标 raDeg/decDeg 为 J2000 历元的赤经/赤纬（度）；mag 为视星等；distLy 为距离（光年）。
 * 数据取自 Hipparcos / Bright Star Catalogue 等公开星表的常用取值。
 */
interface RawStar {
  uid: string;
  en: string;
  zh: string;
  bayer: string;
  con: string;
  ra: number;
  dec: number;
  mag: number;
  dist: number;
  spec: string;
  hip: string;
  hd?: string;
  aliases?: string[];
  desc?: string;
  /**
   * 自行（mas/yr，pmRa 含 cosδ）。9C 起统一由 star-extras.json 异步回填
   * （applyStarExtrasToCatalog）；此手写通道仅作 extras 覆盖不到时的兜底
   * （比邻星 mag 11 在核心层外，但已列入 extras 允许名单），取值同源 HYG 缓存 CSV。
   */
  pmRa?: number;
  pmDec?: number;
}

const RAW_STARS: RawStar[] = [
  { uid: 'HIP32349', en: 'Sirius', zh: '天狼星', bayer: 'α CMa', con: 'Canis Major', ra: 101.287, dec: -16.716, mag: -1.46, dist: 8.6, spec: 'A1V', hip: '32349', hd: '48915', aliases: ['天狼', 'Dog Star', 'Alpha Canis Majoris'], desc: '全天最亮的恒星，位于大犬座，距地球仅约 8.6 光年。' },
  { uid: 'HIP30438', en: 'Canopus', zh: '老人星', bayer: 'α Car', con: 'Carina', ra: 95.988, dec: -52.696, mag: -0.74, dist: 310, spec: 'A9II', hip: '30438', hd: '45348', aliases: ['南极老人', 'Alpha Carinae'], desc: '全天第二亮星，中国古代称之为寿星、南极老人。' },
  { uid: 'HIP69673', en: 'Arcturus', zh: '大角星', bayer: 'α Boo', con: 'Boötes', ra: 213.915, dec: 19.182, mag: -0.05, dist: 37, spec: 'K0III', hip: '69673', hd: '124897', aliases: ['大角', 'Alpha Boötis'], desc: '北天最亮的恒星，一颗橙色巨星。' },
  { uid: 'HIP71683', en: 'Rigil Kentaurus', zh: '南门二', bayer: 'α Cen', con: 'Centaurus', ra: 219.902, dec: -60.834, mag: -0.27, dist: 4.37, spec: 'G2V', hip: '71683', hd: '128620', aliases: ['半人马座α', 'Alpha Centauri', 'Toliman'], desc: '离太阳系最近的恒星系统之一，肉眼可见为一颗亮星。' },
  { uid: 'HIP91262', en: 'Vega', zh: '织女星', bayer: 'α Lyr', con: 'Lyra', ra: 279.234, dec: 38.784, mag: 0.03, dist: 25, spec: 'A0V', hip: '91262', hd: '172167', aliases: ['织女一', '织女', 'Alpha Lyrae'], desc: '天琴座主星，牛郎织女传说中的织女，夏季大三角之一。' },
  { uid: 'HIP24608', en: 'Capella', zh: '五车二', bayer: 'α Aur', con: 'Auriga', ra: 79.172, dec: 45.998, mag: 0.08, dist: 43, spec: 'G3III', hip: '24608', hd: '34029', aliases: ['Alpha Aurigae'], desc: '御夫座最亮星，北天冬季显眼的黄色亮星。' },
  { uid: 'HIP24436', en: 'Rigel', zh: '参宿七', bayer: 'β Ori', con: 'Orion', ra: 78.634, dec: -8.202, mag: 0.13, dist: 860, spec: 'B8Ia', hip: '24436', hd: '34085', aliases: ['Beta Orionis'], desc: '猎户座最亮星，一颗蓝白色超巨星。' },
  { uid: 'HIP37279', en: 'Procyon', zh: '南河三', bayer: 'α CMi', con: 'Canis Minor', ra: 114.825, dec: 5.225, mag: 0.34, dist: 11.5, spec: 'F5IV', hip: '37279', hd: '61421', aliases: ['Alpha Canis Minoris'], desc: '小犬座主星，冬季大三角之一，距地球约 11.5 光年。' },
  { uid: 'HIP7588', en: 'Achernar', zh: '水委一', bayer: 'α Eri', con: 'Eridanus', ra: 24.429, dec: -57.237, mag: 0.46, dist: 139, spec: 'B6V', hip: '7588', hd: '10144', aliases: ['Alpha Eridani'], desc: '波江座最亮星，位于长河的南端。' },
  { uid: 'HIP27989', en: 'Betelgeuse', zh: '参宿四', bayer: 'α Ori', con: 'Orion', ra: 88.793, dec: 7.407, mag: 0.42, dist: 640, spec: 'M1Ia', hip: '27989', hd: '39801', aliases: ['Alpha Orionis'], desc: '猎户座右肩的红超巨星，亮度会明显变化。' },
  { uid: 'HIP68702', en: 'Hadar', zh: '马腹一', bayer: 'β Cen', con: 'Centaurus', ra: 210.956, dec: -60.373, mag: 0.61, dist: 390, spec: 'B1III', hip: '68702', hd: '122451', aliases: ['Agena', 'Beta Centauri'], desc: '半人马座第二亮星，与南门二一同指向南十字。' },
  { uid: 'HIP97649', en: 'Altair', zh: '牛郎星', bayer: 'α Aql', con: 'Aquila', ra: 297.696, dec: 8.868, mag: 0.77, dist: 16.7, spec: 'A7V', hip: '97649', hd: '187642', aliases: ['河鼓二', '牛郎', 'Alpha Aquilae'], desc: '天鹰座主星，牛郎织女传说中的牛郎，夏季大三角之一。' },
  { uid: 'HIP60718', en: 'Acrux', zh: '十字架二', bayer: 'α Cru', con: 'Crux', ra: 186.65, dec: -63.099, mag: 0.77, dist: 320, spec: 'B0.5IV', hip: '60718', hd: '108248', aliases: ['Alpha Crucis'], desc: '南十字座最亮星，南十字底端。' },
  { uid: 'HIP21421', en: 'Aldebaran', zh: '毕宿五', bayer: 'α Tau', con: 'Taurus', ra: 68.98, dec: 16.509, mag: 0.85, dist: 65, spec: 'K5III', hip: '21421', hd: '29139', aliases: ['Alpha Tauri'], desc: '金牛座之眼，一颗橙红色巨星。' },
  { uid: 'HIP65474', en: 'Spica', zh: '角宿一', bayer: 'α Vir', con: 'Virgo', ra: 201.298, dec: -11.161, mag: 1.04, dist: 250, spec: 'B1III', hip: '65474', hd: '116658', aliases: ['Alpha Virginis'], desc: '室女座最亮星，一颗蓝白色双星。' },
  { uid: 'HIP80763', en: 'Antares', zh: '心宿二', bayer: 'α Sco', con: 'Scorpius', ra: 247.352, dec: -26.432, mag: 1.09, dist: 550, spec: 'M1.5Iab', hip: '80763', hd: '148478', aliases: ['大火', 'Alpha Scorpii'], desc: '天蝎座心脏，一颗红超巨星，中国古称「大火」。' },
  { uid: 'HIP37826', en: 'Pollux', zh: '北河三', bayer: 'β Gem', con: 'Gemini', ra: 116.329, dec: 28.026, mag: 1.14, dist: 34, spec: 'K0III', hip: '37826', hd: '62509', aliases: ['Beta Geminorum'], desc: '双子座最亮星，与北河二并称双子。' },
  { uid: 'HIP113368', en: 'Fomalhaut', zh: '北落师门', bayer: 'α PsA', con: 'Piscis Austrinus', ra: 344.413, dec: -29.622, mag: 1.16, dist: 25, spec: 'A3V', hip: '113368', hd: '216956', aliases: ['Alpha Piscis Austrini'], desc: '南鱼座主星，秋季南天孤独的亮星。' },
  { uid: 'HIP102098', en: 'Deneb', zh: '天津四', bayer: 'α Cyg', con: 'Cygnus', ra: 310.358, dec: 45.28, mag: 1.25, dist: 2600, spec: 'A2Ia', hip: '102098', hd: '197345', aliases: ['Alpha Cygni'], desc: '天鹅座尾部的蓝白超巨星，夏季大三角之一，极为遥远。' },
  { uid: 'HIP62434', en: 'Mimosa', zh: '十字架三', bayer: 'β Cru', con: 'Crux', ra: 191.93, dec: -59.689, mag: 1.25, dist: 350, spec: 'B0.5III', hip: '62434', hd: '111123', aliases: ['Becrux', 'Beta Crucis'], desc: '南十字座第二亮星。' },
  { uid: 'HIP49669', en: 'Regulus', zh: '轩辕十四', bayer: 'α Leo', con: 'Leo', ra: 152.093, dec: 11.967, mag: 1.35, dist: 79, spec: 'B8IV', hip: '49669', hd: '87901', aliases: ['Alpha Leonis'], desc: '狮子座心脏，黄道附近的蓝白亮星。' },
  { uid: 'HIP33579', en: 'Adhara', zh: '弧矢七', bayer: 'ε CMa', con: 'Canis Major', ra: 104.656, dec: -28.972, mag: 1.5, dist: 430, spec: 'B2II', hip: '33579', hd: '52089', aliases: ['Epsilon Canis Majoris'], desc: '大犬座第二亮星。' },
  { uid: 'HIP36850', en: 'Castor', zh: '北河二', bayer: 'α Gem', con: 'Gemini', ra: 113.65, dec: 31.888, mag: 1.57, dist: 51, spec: 'A1V', hip: '36850', hd: '60179', aliases: ['Alpha Geminorum'], desc: '双子座之一，实为六合星系统。' },
  { uid: 'HIP85927', en: 'Shaula', zh: '尾宿八', bayer: 'λ Sco', con: 'Scorpius', ra: 263.402, dec: -37.104, mag: 1.63, dist: 570, spec: 'B2IV', hip: '85927', hd: '158926', aliases: ['Lambda Scorpii'], desc: '天蝎座尾刺上的亮星。' },
  { uid: 'HIP61084', en: 'Gacrux', zh: '十字架一', bayer: 'γ Cru', con: 'Crux', ra: 187.791, dec: -57.113, mag: 1.63, dist: 88, spec: 'M3.5III', hip: '61084', hd: '108903', aliases: ['Gamma Crucis'], desc: '南十字座顶端的红巨星。' },
  { uid: 'HIP25336', en: 'Bellatrix', zh: '参宿五', bayer: 'γ Ori', con: 'Orion', ra: 81.283, dec: 6.35, mag: 1.64, dist: 250, spec: 'B2III', hip: '25336', hd: '35468', aliases: ['Gamma Orionis', '女武神星'], desc: '猎户座左肩的蓝色亮星，又称「女武神星」。' },
  { uid: 'HIP25428', en: 'Elnath', zh: '五车五', bayer: 'β Tau', con: 'Taurus', ra: 81.573, dec: 28.608, mag: 1.65, dist: 130, spec: 'B7III', hip: '25428', hd: '35497', aliases: ['Beta Tauri'], desc: '金牛座北角，御夫五车与金牛共享的亮星。' },
  { uid: 'HIP45238', en: 'Miaplacidus', zh: '南船五', bayer: 'β Car', con: 'Carina', ra: 138.3, dec: -69.717, mag: 1.68, dist: 110, spec: 'A2IV', hip: '45238', hd: '80007', aliases: ['Beta Carinae'], desc: '船底座第二亮星，深南天的白色亮星。' },
  { uid: 'HIP26311', en: 'Alnilam', zh: '参宿二', bayer: 'ε Ori', con: 'Orion', ra: 84.053, dec: -1.202, mag: 1.69, dist: 1300, spec: 'B0Ia', hip: '26311', hd: '37128', aliases: ['Epsilon Orionis'], desc: '猎户腰带三星中间那颗蓝超巨星。' },
  { uid: 'HIP26727', en: 'Alnitak', zh: '参宿一', bayer: 'ζ Ori', con: 'Orion', ra: 85.19, dec: -1.943, mag: 1.77, dist: 1260, spec: 'O9.5Ib', hip: '26727', hd: '37742', aliases: ['Zeta Orionis'], desc: '猎户腰带东端的亮星，附近有著名的火焰星云。' },
  { uid: 'HIP62956', en: 'Alioth', zh: '玉衡', bayer: 'ε UMa', con: 'Ursa Major', ra: 193.507, dec: 55.96, mag: 1.77, dist: 81, spec: 'A1III', hip: '62956', hd: '112185', aliases: ['Epsilon Ursae Majoris'], desc: '北斗七星之一，斗柄上最亮的星。' },
  { uid: 'HIP54061', en: 'Dubhe', zh: '天枢', bayer: 'α UMa', con: 'Ursa Major', ra: 165.932, dec: 61.751, mag: 1.79, dist: 123, spec: 'K0III', hip: '54061', hd: '95689', aliases: ['Alpha Ursae Majoris', '北斗一'], desc: '北斗七星斗口，与天璇连线指向北极星。' },
  { uid: 'HIP15863', en: 'Mirfak', zh: '天船三', bayer: 'α Per', con: 'Perseus', ra: 51.081, dec: 49.861, mag: 1.79, dist: 510, spec: 'F5Ib', hip: '15863', hd: '20902', aliases: ['Alpha Persei'], desc: '英仙座最亮星。' },
  { uid: 'HIP34444', en: 'Wezen', zh: '弧矢一', bayer: 'δ CMa', con: 'Canis Major', ra: 107.098, dec: -26.393, mag: 1.83, dist: 1600, spec: 'F8Ia', hip: '34444', hd: '54605', aliases: ['Delta Canis Majoris'], desc: '大犬座黄白色超巨星，极为遥远明亮。' },
  { uid: 'HIP90185', en: 'Kaus Australis', zh: '箕宿三', bayer: 'ε Sgr', con: 'Sagittarius', ra: 276.043, dec: -34.385, mag: 1.85, dist: 143, spec: 'B9.5III', hip: '90185', hd: '169022', aliases: ['Epsilon Sagittarii'], desc: '人马座「茶壶」底部的亮星。' },
  { uid: 'HIP41037', en: 'Avior', zh: '海石二', bayer: 'ε Car', con: 'Carina', ra: 125.628, dec: -59.509, mag: 1.86, dist: 630, spec: 'K3III', hip: '41037', hd: '71129', aliases: ['Epsilon Carinae'], desc: '船底座的橙色亮星。' },
  { uid: 'HIP67301', en: 'Alkaid', zh: '摇光', bayer: 'η UMa', con: 'Ursa Major', ra: 206.885, dec: 49.313, mag: 1.86, dist: 104, spec: 'B3V', hip: '67301', hd: '120315', aliases: ['Eta Ursae Majoris', '北斗七'], desc: '北斗七星斗柄末端。' },
  { uid: 'HIP28360', en: 'Menkalinan', zh: '五车三', bayer: 'β Aur', con: 'Auriga', ra: 89.882, dec: 44.947, mag: 1.9, dist: 82, spec: 'A2IV', hip: '28360', hd: '40183', aliases: ['Beta Aurigae'], desc: '御夫座第二亮星，一对食双星。' },
  // 注：Alhena 的 HD 号为 47105（56537 是 λ Gem 的，早期笔误会把 λ Gem 从目录错误去重掉）。
  { uid: 'HIP31681', en: 'Alhena', zh: '井宿三', bayer: 'γ Gem', con: 'Gemini', ra: 99.428, dec: 16.399, mag: 1.9, dist: 109, spec: 'A0IV', hip: '31681', hd: '47105', aliases: ['Gamma Geminorum'], desc: '双子座脚部的亮星。' },
  { uid: 'HIP11767', en: 'Polaris', zh: '北极星', bayer: 'α UMi', con: 'Ursa Minor', ra: 37.955, dec: 89.264, mag: 1.98, dist: 433, spec: 'F7Ib', hip: '11767', hd: '8890', aliases: ['勾陈一', '北辰', 'Alpha Ursae Minoris', 'North Star'], desc: '当前的北极星，几乎正对天球北极，指示正北方向。' },
  { uid: 'HIP30324', en: 'Mirzam', zh: '军市一', bayer: 'β CMa', con: 'Canis Major', ra: 95.675, dec: -17.956, mag: 1.98, dist: 500, spec: 'B1II', hip: '30324', hd: '44743', aliases: ['Beta Canis Majoris'], desc: '大犬座蓝色亮星，天狼星旁的报信者。' },
  { uid: 'HIP46390', en: 'Alphard', zh: '星宿一', bayer: 'α Hya', con: 'Hydra', ra: 141.897, dec: -8.659, mag: 1.98, dist: 177, spec: 'K3III', hip: '46390', hd: '81797', aliases: ['Alpha Hydrae'], desc: '长蛇座之心，孤悬一方的橙色亮星。' },
  { uid: 'HIP9884', en: 'Hamal', zh: '娄宿三', bayer: 'α Ari', con: 'Aries', ra: 31.793, dec: 23.462, mag: 2.0, dist: 66, spec: 'K2III', hip: '9884', hd: '12929', aliases: ['Alpha Arietis'], desc: '白羊座最亮星。' },
  { uid: 'HIP677', en: 'Alpheratz', zh: '壁宿二', bayer: 'α And', con: 'Andromeda', ra: 2.097, dec: 29.091, mag: 2.06, dist: 97, spec: 'B8IV', hip: '677', hd: '358', aliases: ['Alpha Andromedae', 'Sirrah'], desc: '仙女座与飞马座共享的亮星，秋季四边形一角。' },
  { uid: 'HIP65378', en: 'Mizar', zh: '开阳', bayer: 'ζ UMa', con: 'Ursa Major', ra: 200.981, dec: 54.925, mag: 2.04, dist: 83, spec: 'A2V', hip: '65378', hd: '116656', aliases: ['Zeta Ursae Majoris', '北斗六'], desc: '北斗七星斗柄中的著名双星，旁有辅星（开阳增一）。' },
  { uid: 'HIP14576', en: 'Algol', zh: '大陵五', bayer: 'β Per', con: 'Perseus', ra: 47.042, dec: 40.956, mag: 2.12, dist: 90, spec: 'B8V', hip: '14576', hd: '19356', aliases: ['Beta Persei', 'Demon Star', '魔星'], desc: '著名食变星，古称「魔星」，亮度周期性变暗。' },
  { uid: 'HIP57632', en: 'Denebola', zh: '五帝座一', bayer: 'β Leo', con: 'Leo', ra: 177.265, dec: 14.572, mag: 2.11, dist: 36, spec: 'A3V', hip: '57632', hd: '102647', aliases: ['Beta Leonis'], desc: '狮子座尾巴上的亮星。' },
  { uid: 'HIP27366', en: 'Saiph', zh: '参宿六', bayer: 'κ Ori', con: 'Orion', ra: 86.939, dec: -9.67, mag: 2.06, dist: 650, spec: 'B0.5Ia', hip: '27366', hd: '38771', aliases: ['Kappa Orionis'], desc: '猎户座右膝的蓝超巨星。' },
  { uid: 'HIP25930', en: 'Mintaka', zh: '参宿三', bayer: 'δ Ori', con: 'Orion', ra: 83.002, dec: -0.299, mag: 2.23, dist: 1200, spec: 'O9.5II', hip: '25930', hd: '36486', aliases: ['Delta Orionis'], desc: '猎户腰带西端，几乎正压天赤道。' },
  { uid: 'HIP92855', en: 'Nunki', zh: '斗宿四', bayer: 'σ Sgr', con: 'Sagittarius', ra: 283.816, dec: -26.297, mag: 2.05, dist: 220, spec: 'B2.5V', hip: '92855', hd: '175191', aliases: ['Sigma Sagittarii'], desc: '人马座茶壶把手上的亮星。' },
  { uid: 'HIP72607', en: 'Kochab', zh: '北极二', bayer: 'β UMi', con: 'Ursa Minor', ra: 222.676, dec: 74.156, mag: 2.08, dist: 131, spec: 'K4III', hip: '72607', hd: '131873', aliases: ['Beta Ursae Minoris', '帝'], desc: '小熊座橙色亮星，古代曾充当北极星。' },
  { uid: 'HIP86032', en: 'Rasalhague', zh: '侯', bayer: 'α Oph', con: 'Ophiuchus', ra: 263.734, dec: 12.56, mag: 2.08, dist: 49, spec: 'A5III', hip: '86032', hd: '159561', aliases: ['Alpha Ophiuchi'], desc: '蛇夫座头部的亮星。' },
  { uid: 'HIP68933', en: 'Menkent', zh: '库楼三', bayer: 'θ Cen', con: 'Centaurus', ra: 211.671, dec: -36.37, mag: 2.06, dist: 61, spec: 'K0III', hip: '68933', hd: '123139', aliases: ['Theta Centauri'], desc: '半人马座橙色巨星。' },
  { uid: 'HIP3419', en: 'Diphda', zh: '土司空', bayer: 'β Cet', con: 'Cetus', ra: 10.897, dec: -17.987, mag: 2.04, dist: 96, spec: 'K0III', hip: '3419', hd: '4128', aliases: ['Beta Ceti', 'Deneb Kaitos'], desc: '鲸鱼座最亮星，秋季南天的橙色亮星。' },
  { uid: 'HIP50583', en: 'Algieba', zh: '轩辕十二', bayer: 'γ Leo', con: 'Leo', ra: 154.993, dec: 19.842, mag: 2.01, dist: 130, spec: 'K1III', hip: '50583', hd: '89484', aliases: ['Gamma Leonis'], desc: '狮子座金黄色双星，镰刀形的一环。' },
  { uid: 'HIP100751', en: 'Peacock', zh: '孔雀十一', bayer: 'α Pav', con: 'Pavo', ra: 306.412, dec: -56.735, mag: 1.94, dist: 180, spec: 'B2IV', hip: '100751', hd: '193924', aliases: ['Alpha Pavonis'], desc: '孔雀座最亮星。' },
  { uid: 'HIP70890', en: 'Proxima Centauri', zh: '比邻星', bayer: 'α Cen C', con: 'Centaurus', ra: 217.429, dec: -62.679, mag: 11.13, dist: 4.24, spec: 'M5.5Ve', hip: '70890', aliases: ['半人马座比邻星', 'Proxima'], desc: '距太阳最近的恒星（约 4.24 光年），一颗红矮星，肉眼不可见。', pmRa: -3775.6, pmDec: 768.2 },
  { uid: 'HIP95947', en: 'Albireo', zh: '辇道增七', bayer: 'β Cyg', con: 'Cygnus', ra: 292.68, dec: 27.96, mag: 3.05, dist: 430, spec: 'K3II', hip: '95947', hd: '183912', aliases: ['Beta Cygni'], desc: '天鹅座喙部著名的金蓝双星，望远镜下极美。' },
  { uid: 'HIP17702', en: 'Alcyone', zh: '昴宿六', bayer: 'η Tau', con: 'Taurus', ra: 56.871, dec: 24.105, mag: 2.87, dist: 440, spec: 'B7III', hip: '17702', hd: '23630', aliases: ['Eta Tauri', '昴星团'], desc: '昴星团（七姊妹星团）中最亮的成员。' },
];

/**
 * 渲染优先级分档：0 最高（首屏必载），数值越小越优先。
 * 供前端渐进/分档（LOD）加载参考。
 */
function decideRenderPriority(mag: number, isFeatured: boolean): number {
  if (isFeatured) return 0;
  if (mag <= 2.5) return 1;
  if (mag <= 4.5) return 2;
  return 3;
}

/**
 * 搜索排序次级键：越大越优先。= 著名加成 + 亮度加成。
 * 镜像 search.ts 的 brightnessBonus（放大取整），为 Phase 3 落库 ORDER BY 预备。
 */
function decideSearchPriority(mag: number, isFeatured: boolean): number {
  const featuredBonus = isFeatured ? 50 : 0;
  const brightness = Math.round(Math.max(0, 7 - mag) * 10); // mag -1.46→85，mag6→10
  return featuredBonus + brightness;
}

/**
 * isNamable 命名候选判定（合规红线）：
 * 1. 所有著名星（isFeatured）isNamable=false —— 绝不宣传「买断知名星」，仅作展示/讲故事素材。
 * 2. 无 HIP（仅 HD/HR）编号稳定性稍弱，暂不入售池。
 * 3. 命名候选池 = 非著名 + 有 HIP + 4.0 ≤ mag ≤ 6.0：肉眼/双筒可见、有真实坐标编号却尚无俗名，
 *    正是「为 TA 命名一颗真实可指认的星」的最佳商品。
 * 4. mag < 4.0 的非著名星更亮更稀缺，留作未来高端 SKU，本期字段占位不开放。
 */
function decideNamable(mag: number, isFeatured: boolean, hasHip: boolean): boolean {
  if (isFeatured) return false;
  if (!hasHip) return false;
  return mag >= 4.0 && mag <= 6.0;
}

/** 由原始数据构造完整的星体对象（手写精选，isFeatured=true，isNamable=false 红线）。 */
function buildStar(raw: RawStar): CelestialObject {
  const catalogIds: Record<string, string> = { hip: raw.hip };
  if (raw.hd) catalogIds.hd = raw.hd;
  // 别名并入带标签的星表编号（HD/HIP），让「HD 48915」这类查询可命中。
  const aliases = dedupe([
    ...(raw.aliases ?? []),
    raw.hd && 'HD ' + raw.hd,
    raw.hd && 'HD' + raw.hd,
    'HIP ' + raw.hip,
  ]).filter((a) => a !== raw.en && a !== raw.zh);
  return {
    objectUid: raw.uid,
    type: 'star',
    nameEn: raw.en,
    nameZh: raw.zh,
    aliases,
    bayer: raw.bayer,
    constellation: raw.con,
    constellationZh: CONSTELLATION_ZH[raw.con] ?? raw.con,
    raDeg: raw.ra,
    decDeg: raw.dec,
    magnitude: raw.mag,
    distanceLy: raw.dist,
    spectralType: raw.spec,
    catalogIds,
    isNamable: false, // 合规红线：著名星不作命名售卖对象。
    isFeatured: true,
    descriptionZh: raw.desc,
    renderPriority: 0,
    searchPriority: decideSearchPriority(raw.mag, true),
    sourceCatalog: 'handwritten',
    // 手写 pm 仅比邻星等 generated 覆盖不到的星携带；其余由合并前的回填补齐。
    ...(raw.pmRa !== undefined && raw.pmDec !== undefined
      ? { pmRaMasYr: raw.pmRa, pmDecMasYr: raw.pmDec }
      : {}),
  };
}

/** generated JSON 中单条精简星的形状。 */
interface GeneratedStar {
  u: string;
  ra: number;
  dec: number;
  mag: number;
  dist?: number | null;
  spect?: string;
  con?: string;
  bayer?: string;
  flam?: string;
  proper?: string;
  bf?: string;
  hip?: string;
  hd?: string;
  hr?: string;
}

/** 去重去空辅助。 */
function dedupe(items: (string | undefined | false)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    if (!it) continue;
    if (seen.has(it)) continue;
    seen.add(it);
    out.push(it);
  }
  return out;
}

/** 由 generated 行构造 CelestialObject（HYG 生成星，isFeatured=false）。 */
function buildFromGenerated(r: GeneratedStar): CelestialObject {
  const meta = r.con ? CONSTELLATION_ABBR[r.con] : undefined;
  const constellation = meta?.en ?? r.con ?? '';
  const constellationZh = meta?.zh ?? r.con ?? '';

  const catalogIds: Record<string, string> = {};
  if (r.hip) catalogIds.hip = r.hip;
  if (r.hd) catalogIds.hd = r.hd;
  if (r.hr) catalogIds.hr = r.hr;

  const nameEn = r.proper ?? r.bf ?? r.bayer ?? r.u;
  const idLabel = r.hd ? 'HD ' + r.hd : r.hip ? 'HIP ' + r.hip : r.u;
  // 非著名星无人工中文名：有 proper 暂用英文；否则「星座中文 + 编号」，如「天鹅座 HD12345」。
  const nameZh = r.proper ? nameEn : `${constellationZh} ${idLabel}`.trim();

  const aliases = dedupe([
    r.proper,
    r.bf,
    r.bayer,
    r.hd && 'HD ' + r.hd,
    r.hd && 'HD' + r.hd,
    r.hr && 'HR ' + r.hr,
  ]).filter((a) => a !== nameEn);

  const isFeatured = false;
  const isNamable = decideNamable(r.mag, isFeatured, !!r.hip);

  return {
    objectUid: r.u,
    type: 'star',
    nameEn,
    nameZh,
    aliases,
    bayer: r.bayer,
    constellation,
    constellationZh,
    raDeg: r.ra,
    decDeg: r.dec,
    magnitude: r.mag,
    distanceLy: r.dist ?? null,
    spectralType: r.spect,
    catalogIds,
    isNamable,
    isFeatured,
    renderPriority: decideRenderPriority(r.mag, isFeatured),
    searchPriority: decideSearchPriority(r.mag, isFeatured),
    sourceCatalog: 'hyg-v41',
    // 自行不再随主表透传（9C lean 化）：pm 走 star-extras.json 异步 chunk，
    // 加载完成后由 applyStarExtrasToCatalog 回填 pmRaMasYr/pmDecMasYr。
  };
}

// —— 合并 —— 手写 60 颗精选 + HYG generated，手写优先、编号去重 ——

const featured: CelestialObject[] = RAW_STARS.map(buildStar);

/** bright-stars.json 列式载荷形状（9C columnar-v1；ETL 单一约定见 build-catalog.mjs）。 */
interface GeneratedColumnar {
  n?: number;
  cols?: {
    ra?: number[];
    dec?: number[];
    mag?: number[];
    /** 0 = 未知哨兵（真实距离不为 0）。 */
    dist?: number[];
    spect?: string[];
    con?: string[];
    bayer?: string[];
    flam?: string[];
    proper?: string[];
    bf?: string[];
    hip?: string[];
    hd?: string[];
    hr?: string[];
  };
}

/**
 * 列式 → 行式解码（模块加载期一次，8896 行 <3ms）。
 * u 由 hip/hd/hr 按 HIP>HD>HR 派生（与 ETL 同一优先级约定，不落盘省 ~110KB）。
 * 防御：结构异常/长度不齐退化为空数组（catalog 仅剩手写 60 颗，构建不崩）。
 */
function decodeGenerated(json: unknown): GeneratedStar[] {
  const g = json as GeneratedColumnar | null;
  const cols = g?.cols;
  const n = g?.n;
  if (!cols || typeof n !== 'number' || n <= 0) return [];
  if (cols.ra?.length !== n || cols.dec?.length !== n || cols.mag?.length !== n) return [];
  const out: GeneratedStar[] = [];
  for (let i = 0; i < n; i++) {
    const hip = cols.hip?.[i] || undefined;
    const hd = cols.hd?.[i] || undefined;
    const hr = cols.hr?.[i] || undefined;
    let u: string | undefined;
    if (hip) u = 'HIP' + hip;
    else if (hd) u = 'HD' + hd;
    else if (hr) u = 'HR' + hr;
    if (!u) continue; // 理论不达（ETL 已剔孤儿），防御跳过
    const dist = cols.dist?.[i];
    out.push({
      u,
      ra: cols.ra[i]!,
      dec: cols.dec[i]!,
      mag: cols.mag[i]!,
      dist: dist === 0 || dist === undefined ? null : dist, // 0 = 未知哨兵
      spect: cols.spect?.[i] || undefined,
      con: cols.con?.[i] || undefined,
      bayer: cols.bayer?.[i] || undefined,
      flam: cols.flam?.[i] || undefined,
      proper: cols.proper?.[i] || undefined,
      bf: cols.bf?.[i] || undefined,
      hip,
      hd,
      hr,
    });
  }
  return out;
}

// generated 载入（防御：缺失或结构异常时退化为空数组，catalog 仅剩手写 60 颗，构建不崩）。
const generatedRaw: GeneratedStar[] = decodeGenerated(brightStars);
const generatedStars: CelestialObject[] = generatedRaw.map(buildFromGenerated);

// —— 自行回填（9B→9C 演进）——9B 曾在此从 generated 行补手写星的 pm；9C 主表
// lean 化后 generated 行不再携带 pm，回填改为运行时 applyStarExtrasToCatalog
// （star-extras.ts，extras 异步 chunk 加载完成后一次性补齐全目录含手写星）。
// RawStar 仍保留 pmRa/pmDec 手写通道（比邻星），extras 覆盖不到时的最后兜底。

/** 归一化数字编号，去前导 0，便于跨源比较。 */
const norm = (s?: string): string => s?.replace(/^0+/, '') ?? '';

// 收集手写星的编号键，用于剔除 generated 中的重复。
const featuredKeys = new Set<string>();
for (const f of featured) {
  if (f.catalogIds.hip) featuredKeys.add('hip:' + norm(f.catalogIds.hip));
  if (f.catalogIds.hd) featuredKeys.add('hd:' + norm(f.catalogIds.hd));
  featuredKeys.add('uid:' + f.objectUid);
}

function isDup(g: CelestialObject): boolean {
  if (featuredKeys.has('uid:' + g.objectUid)) return true;
  if (g.catalogIds.hip && featuredKeys.has('hip:' + norm(g.catalogIds.hip))) return true;
  if (g.catalogIds.hd && featuredKeys.has('hd:' + norm(g.catalogIds.hd))) return true;
  return false;
}

// 手写优先；generated 去重后并入。二次 Set 兜底 objectUid 唯一。
const mergedSeenUid = new Set<string>();
const merged: CelestialObject[] = [];
for (const star of [...featured, ...generatedStars.filter((g) => !isDup(g))]) {
  if (mergedSeenUid.has(star.objectUid)) continue;
  mergedSeenUid.add(star.objectUid);
  merged.push(star);
}

/** 统一真实星表（纯恒星）：手写精选 + HYG 亮星，按视星等从亮到暗排序。 */
export const CELESTIAL_CATALOG: CelestialObject[] = merged.sort(
  (a, b) => a.magnitude - b.magnitude,
);

// —— 深空天体（OpenNGC 生成：Messier 110 全量 + 亮 NGC/IC）——

/** generated/deep-sky.json 中单条深空天体的形状。 */
interface GeneratedDso {
  u: string;
  t: string;
  ra: number;
  dec: number;
  mag?: number;
  con?: string;
  m?: number;
  ngc?: string;
  ic?: string;
  names?: string[];
  zh?: string;
  commonZh?: string;
  desc?: string;
  majAx?: number;
}

/** 深空类型合法集合（deep-sky.json 的 t 字段；脚本自检已保证，此处兜底过滤）。 */
const DSO_TYPES = new Set<CelestialObjectType>(['galaxy', 'nebula', 'cluster', 'star']);

/**
 * 著名深空天体的真实影像登记（宇宙 V3）：
 * imageKey → web 端 public/dso-photos/{imageKey}.jpg（由 apps/web/scripts/fetch-assets.mjs 下载落盘）；
 * imageCredit → UI 就地署名文案（全部素材为 Public Domain 或 CC-BY，署名即合规闭环）。
 * 纯渲染参数（显示尺寸/旋转角等）不进数据包，归 web 端 lib/dso-photos.ts，保持数据与视觉解耦。
 * 完整来源登记见 apps/web/public/credits.json 与 docs/credits.md。
 */
const DSO_IMAGE_META: Record<string, { imageKey: string; imageCredit: string }> = {
  M31: { imageKey: 'm31', imageCredit: 'Adam Evans，CC BY 2.0' },
  M33: { imageKey: 'm33', imageCredit: 'ESO，CC BY 4.0' },
  M42: { imageKey: 'm42', imageCredit: 'NASA, ESA, M. Robberto (STScI/ESA) 与 HST Orion Treasury Team，公有领域' },
  M45: { imageKey: 'm45', imageCredit: 'NASA, ESA, AURA/Caltech, Palomar Observatory，公有领域' },
  M8: { imageKey: 'm8', imageCredit: 'ESO/VPHAS+ team，CC BY 4.0' },
  M16: { imageKey: 'm16', imageCredit: 'ESO，CC BY 4.0' },
  M17: { imageKey: 'm17', imageCredit: 'ESO，CC BY 4.0' },
  M20: { imageKey: 'm20', imageCredit: 'ESO，CC BY 3.0' },
  M27: { imageKey: 'm27', imageCredit: 'Bill Schoening/NOIRLab/NSF/AURA，CC BY 4.0' },
  M51: { imageKey: 'm51', imageCredit: 'NASA & ESA（哈勃空间望远镜），公有领域' },
  M57: { imageKey: 'm57', imageCredit: 'Hubble Heritage Team (AURA/STScI/NASA)，公有领域' },
  M13: { imageKey: 'm13', imageCredit: 'ESA/Hubble 与 NASA，公有领域' },
  M81: { imageKey: 'm81', imageCredit: 'NASA, ESA, Hubble Heritage Team，公有领域' },
  M101: { imageKey: 'm101', imageCredit: 'ESA & NASA（哈勃空间望远镜），CC BY 4.0' },
  M104: { imageKey: 'm104', imageCredit: 'NASA/ESA 与 Hubble Heritage Team，公有领域' },
  M1: { imageKey: 'm1', imageCredit: 'NASA, ESA, J. Hester & A. Loll (ASU)，公有领域' },
};

/** 四舍五入到 n 位小数（angularSizeDeg 换算用）。 */
function roundTo(x: number, n: number): number {
  const f = 10 ** n;
  return Math.round(x * f) / f;
}

/** 由 generated 深空行构造 CelestialObject。合规红线：DSO 一律 isNamable=false。 */
function buildDso(r: GeneratedDso): CelestialObject {
  const meta = r.con ? CONSTELLATION_ABBR[r.con] : undefined;
  const isMessier = r.m !== undefined;
  const nameEn = r.names?.[0] ?? r.u;
  // 无中文映射的 NGC/IC：'NGC224' → 'NGC 224' 原样展示。
  const nameZh = r.zh ?? r.u.replace(/^(M|NGC|IC)/, '$1 ');
  const mag = r.mag ?? 12; // 无星等按暗处理，仅影响排序。

  const catalogIds: Record<string, string> = {};
  if (isMessier) catalogIds.m = String(r.m);
  if (r.ngc) catalogIds.ngc = r.ngc;
  if (r.ic) catalogIds.ic = r.ic;

  const aliases = dedupe([
    r.u,
    isMessier && `M ${r.m}`,
    r.ngc && `NGC ${r.ngc}`,
    r.ngc && `NGC${r.ngc}`,
    r.ic && `IC ${r.ic}`,
    r.ic && `IC${r.ic}`,
    r.commonZh,
    ...(r.names ?? []),
  ]).filter((a) => a !== nameEn && a !== nameZh);

  // 真实影像元数据（仅 16 个著名 Messier）与真实角尺寸（majAx 角分 → 度，全量免费收益）。
  const imageMeta = DSO_IMAGE_META[r.u];

  return {
    objectUid: r.u,
    type: (DSO_TYPES.has(r.t as CelestialObjectType) ? r.t : 'nebula') as CelestialObjectType,
    nameEn,
    nameZh,
    commonNameZh: r.commonZh,
    aliases,
    constellation: meta?.en ?? r.con ?? '',
    constellationZh: meta?.zh ?? r.con ?? '',
    raDeg: r.ra,
    decDeg: r.dec,
    magnitude: mag,
    distanceLy: null,
    catalogIds,
    isNamable: false, // 合规红线：深空天体一律不可命名。
    isFeatured: isMessier, // Messier 全著名。
    descriptionZh: r.desc,
    renderPriority: isMessier ? 0 : mag <= 8 ? 1 : 2,
    searchPriority: decideSearchPriority(mag, isMessier),
    sourceCatalog: 'openngc',
    angularSizeDeg: r.majAx !== undefined ? roundTo(r.majAx / 60, 4) : undefined,
    ...(imageMeta ?? {}),
  };
}

// generated 载入（防御：缺失或结构异常时退化为空数组，构建不崩）。
const deepSkyRaw = ((deepSky as { objects?: GeneratedDso[] })?.objects ?? []) as GeneratedDso[];

/**
 * 深空天体表（Messier 110 全量 + 亮 NGC/IC，V/B-Mag ≤ 10）。
 * 独立于恒星表导出：web 渲染分层（恒星 Points / DSO sprite）、拾取分层天然清晰。
 */
export const DEEP_SKY_CATALOG: CelestialObject[] = deepSkyRaw.map(buildDso);

/**
 * 恒星 + 深空合并目录（搜索 / API / 按 uid 取用）。
 * CELESTIAL_CATALOG 语义不变仍为纯恒星，既有渲染消费端零回归。
 */
export const FULL_CATALOG: CelestialObject[] = [...CELESTIAL_CATALOG, ...DEEP_SKY_CATALOG];

/** 按 objectUid 建立索引（覆盖恒星 + 深空；uid 无冲突由生成脚本断言）。 */
export const CATALOG_BY_UID: Map<string, CelestialObject> = new Map(
  FULL_CATALOG.map((s) => [s.objectUid, s]),
);

/** 按 objectUid 取星体（恒星与深空天体均可，如 'HIP32349'、'M31'）。 */
export function getCelestialByUid(uid: string): CelestialObject | undefined {
  return CATALOG_BY_UID.get(uid);
}
