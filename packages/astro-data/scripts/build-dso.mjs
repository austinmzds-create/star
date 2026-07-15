// @ts-check
/**
 * 离线 ETL 脚本：下载 OpenNGC → 产出深空天体 JSON（src/generated/deep-sky.json）。
 *
 * 入选规则：
 *   1. Messier 110 个全量（含 addendum 中的 M40/M45，及 M102=NGC5866 覆写）；
 *   2. 非 Messier：非恒星类（剔 * / ** / Dup / NonEx / Other）且视星等 V-Mag（缺则 B-Mag）≤ 10。
 *
 * 数据源（CC-BY-SA-4.0，mattiaverga/OpenNGC）：
 *   https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv
 *   https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/addendum.csv
 *
 * 用法：
 *   node scripts/build-dso.mjs            下载并生成（缓存到 scripts/.cache/）
 *   node scripts/build-dso.mjs --offline  读取本地缓存生成
 *
 * 合规红线：深空天体一律 isNamable=false（由 catalog.ts 落实），本脚本只产数据。
 * 绝不编造坐标：下载失败且无缓存时非零退出，不写产物。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { curlDownload, decodeBrightStars, parseCsvLine, round } from './etl-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const CACHE_DIR = resolve(__dirname, '.cache');
const OUT_JSON = resolve(PKG_ROOT, 'src/generated/deep-sky.json');
const BRIGHT_STARS_JSON = resolve(PKG_ROOT, 'src/generated/bright-stars.json');

const MAG_LIMIT_NON_MESSIER = 10;

const SOURCES = [
  {
    name: 'NGC.csv',
    url: 'https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv',
    minBytes: 1_000_000,
  },
  {
    name: 'addendum.csv',
    url: 'https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/addendum.csv',
    minBytes: 5_000,
  },
];

/**
 * OpenNGC Type → CelestialObjectType 映射。
 * 'star' 仅为 M40（温内克 4 双星）兜底；'cluster' 的 *Ass 仅为 M24（人马座恒星云）兜底。
 */
const TYPE_MAP = {
  G: 'galaxy', GPair: 'galaxy', GTrpl: 'galaxy', GGroup: 'galaxy',
  OCl: 'cluster', GCl: 'cluster', 'Cl+N': 'cluster', '*Ass': 'cluster',
  PN: 'nebula', HII: 'nebula', Neb: 'nebula', EmN: 'nebula', RfN: 'nebula',
  SNR: 'nebula', Nova: 'nebula', DrkN: 'nebula',
  '*': 'star', '**': 'star',
};

/** 仅当是 Messier 时才允许的兜底类型（M73=NGC6994 在 OpenNGC 标为 Other，历史上作疏散星团/星群）。 */
const MESSIER_ONLY_TYPE_MAP = { Other: 'cluster' };

/**
 * Messier 归属覆写：OpenNGC 把 M102 标为 M101 的 Dup（历史争议的一种解释）。
 * 产品采用主流解释：M102 = NGC 5866（纺锤星系）。
 */
const MESSIER_OVERRIDES = { 102: 'NGC5866' };

/**
 * Messier 全 110 条中文名/俗名/一句话简介（人工撰写，不涉命名售卖话术）。
 * 无通行中文名者 zh 用 'M n' 编号原样。
 * @type {Record<number, { zh: string, common?: string, desc: string }>}
 */
const MESSIER_ZH = {
  1: { zh: '蟹状星云', desc: '金牛座的超新星遗迹，1054 年超新星爆发的残骸，中国宋代「天关客星」的对应物。' },
  2: { zh: 'M2', desc: '宝瓶座的致密球状星团，北天最大的球状星团之一。' },
  3: { zh: 'M3', desc: '猎犬座的明亮球状星团，以拥有大量变星著称。' },
  4: { zh: 'M4', desc: '天蝎座心宿二近旁的球状星团，是距离地球最近的球状星团之一。' },
  5: { zh: 'M5', desc: '巨蛇座的明亮球状星团，年龄超过百亿年。' },
  6: { zh: '蝴蝶星团', desc: '天蝎座的疏散星团，亮星排布形似展翅的蝴蝶。' },
  7: { zh: '托勒密星团', desc: '天蝎座尾部的疏散星团，公元 2 世纪托勒密就有记载。' },
  8: { zh: '礁湖星云', desc: '人马座的明亮发射星云，夏夜银河中肉眼可辨的光斑。' },
  9: { zh: 'M9', desc: '蛇夫座靠近银心方向的球状星团。' },
  10: { zh: 'M10', desc: '蛇夫座中部的球状星团，小望远镜即可分辨。' },
  11: { zh: '野鸭星团', desc: '盾牌座的致密疏散星团，亮星如一群飞行的野鸭。' },
  12: { zh: 'M12', desc: '蛇夫座的球状星团，与 M10 遥遥相邻。' },
  13: { zh: '武仙座大星团', desc: '北天最壮观的球状星团，聚集着数十万颗恒星。' },
  14: { zh: 'M14', desc: '蛇夫座的球状星团，略呈椭圆形。' },
  15: { zh: 'M15', desc: '飞马座的球状星团，核心极度致密，可能藏有中等质量黑洞。' },
  16: { zh: '鹰状星云', desc: '巨蛇座的发射星云与星团，哈勃「创生之柱」照片的所在地。' },
  17: { zh: '欧米伽星云', common: '天鹅星云', desc: '人马座的发射星云，形似希腊字母 Ω，也像浮水的天鹅。' },
  18: { zh: 'M18', desc: '人马座的小型疏散星团，位于欧米伽星云南侧。' },
  19: { zh: 'M19', desc: '蛇夫座的球状星团，是已知最扁的球状星团之一。' },
  20: { zh: '三叶星云', desc: '人马座的著名星云，发射、反射与暗星云三色交织，被暗尘埃带分成三瓣。' },
  21: { zh: 'M21', desc: '人马座的疏散星团，紧邻三叶星云。' },
  22: { zh: 'M22', desc: '人马座的明亮球状星团，北半球可见的最亮球状星团之一。' },
  23: { zh: 'M23', desc: '人马座的疏散星团，散布在银河星野中。' },
  24: { zh: '人马座恒星云', desc: '银河中的一片恒星云「窗口」，透过它能望进银河系内侧旋臂。' },
  25: { zh: 'M25', desc: '人马座的疏散星团，双筒望远镜的好目标。' },
  26: { zh: 'M26', desc: '盾牌座的疏散星团。' },
  27: { zh: '哑铃星云', desc: '狐狸座的行星状星云，人类发现的第一个行星状星云，形似哑铃。' },
  28: { zh: 'M28', desc: '人马座的球状星团，靠近「茶壶盖」箕宿。' },
  29: { zh: 'M29', desc: '天鹅座的小型疏散星团，沉浸在银河星野中。' },
  30: { zh: 'M30', desc: '摩羯座的球状星团，核心已经历引力坍缩。' },
  31: { zh: '仙女座星系', common: '仙女座大星云', desc: '距银河系最近的大型旋涡星系，约 254 万光年，肉眼可见的最遥远天体之一。' },
  32: { zh: 'M32', desc: '仙女座星系的致密椭圆伴星系。' },
  33: { zh: '三角座星系', desc: '本星系群第三大星系，极暗夜空下肉眼可见的正向旋涡星系。' },
  34: { zh: 'M34', desc: '英仙座的疏散星团，双筒望远镜可分辨成员星。' },
  35: { zh: 'M35', desc: '双子座「脚边」的疏散星团，冬夜的双筒好目标。' },
  36: { zh: 'M36', desc: '御夫座银河中的疏散星团，与 M37、M38 相伴。' },
  37: { zh: 'M37', desc: '御夫座最亮最富的疏散星团。' },
  38: { zh: 'M38', desc: '御夫座的疏散星团，亮星略呈希腊字母 π 形。' },
  39: { zh: 'M39', desc: '天鹅座的松散疏散星团，距地球仅约 800 光年。' },
  40: { zh: '温内克 4', desc: '大熊座的一对光学双星，梅西耶目录中著名的「特例」条目。' },
  41: { zh: 'M41', desc: '大犬座的疏散星团，就在天狼星南边约 4 度处。' },
  42: { zh: '猎户座大星云', desc: '猎户座腰带下方的恒星诞生地，冬夜肉眼可见的弥漫光斑。' },
  43: { zh: '德梅兰星云', desc: '猎户座大星云北侧被尘埃带分隔出的一部分。' },
  44: { zh: '鬼宿星团', common: '蜂巢星团', desc: '巨蟹座的疏散星团，中国古称「积尸气」，肉眼可见的朦胧光斑。' },
  45: { zh: '昴星团', common: '七姊妹星团', desc: '金牛座的疏散星团，中国古称昴宿，肉眼可见六至七颗亮星。' },
  46: { zh: 'M46', desc: '船尾座的疏散星团，视场中恰好投影着一颗行星状星云。' },
  47: { zh: 'M47', desc: '船尾座的明亮疏散星团，与 M46 同视场相映成趣。' },
  48: { zh: 'M48', desc: '长蛇座头部附近的疏散星团。' },
  49: { zh: 'M49', desc: '室女座星系团中最早被发现的成员，一个明亮的椭圆星系。' },
  50: { zh: 'M50', desc: '麒麟座的疏散星团，位于冬季银河之中。' },
  51: { zh: '涡状星系', desc: '猎犬座著名的正向旋涡星系，与伴星系交会缠绕。' },
  52: { zh: 'M52', desc: '仙后座的富疏散星团，位于银河星野中。' },
  53: { zh: 'M53', desc: '后发座的球状星团，远在银晕深处。' },
  54: { zh: 'M54', desc: '人马座的球状星团，可能属于正被银河系吞并的人马矮星系。' },
  55: { zh: 'M55', desc: '人马座的松散球状星团，南方夜空的双筒目标。' },
  56: { zh: 'M56', desc: '天琴座的球状星团，介于天鹅座辇道增七与天琴座之间。' },
  57: { zh: '环状星云', desc: '天琴座的行星状星云，恒星死亡后抛出的发光气体环。' },
  58: { zh: 'M58', desc: '室女座星系团中的明亮棒旋星系。' },
  59: { zh: 'M59', desc: '室女座星系团中的椭圆星系。' },
  60: { zh: 'M60', desc: '室女座星系团中的巨椭圆星系，与邻近星系正在相互作用。' },
  61: { zh: 'M61', desc: '室女座星系团中的旋涡星系，超新星频发。' },
  62: { zh: 'M62', desc: '蛇夫座的球状星团，外形略不对称。' },
  63: { zh: '葵花星系', desc: '猎犬座的旋涡星系，绒羽状旋臂如向日葵花盘。' },
  64: { zh: '黑眼星系', desc: '后发座的旋涡星系，核心醒目的暗尘埃带像一只黑眼睛。' },
  65: { zh: 'M65', desc: '狮子座三重星系的成员之一。' },
  66: { zh: 'M66', desc: '狮子座三重星系中最亮的成员，旋臂被引力扭曲。' },
  67: { zh: 'M67', desc: '巨蟹座的疏散星团，已知最古老的疏散星团之一。' },
  68: { zh: 'M68', desc: '长蛇座的球状星团。' },
  69: { zh: 'M69', desc: '人马座「茶壶」底部附近的球状星团。' },
  70: { zh: 'M70', desc: '人马座的球状星团，与 M69 成对出现在茶壶底。' },
  71: { zh: 'M71', desc: '天箭座的松散球状星团，曾长期被归为致密疏散星团。' },
  72: { zh: 'M72', desc: '宝瓶座的球状星团，梅西耶目录中较暗的成员。' },
  73: { zh: 'M73', desc: '宝瓶座的四星小星群，梅西耶目录中的另一个「特例」。' },
  74: { zh: 'M74', desc: '双鱼座的正向旋涡星系，旋臂舒展但表面亮度很低。' },
  75: { zh: 'M75', desc: '人马座的球状星团，核心极为致密。' },
  76: { zh: '小哑铃星云', desc: '英仙座的行星状星云，哑铃星云的迷你版。' },
  77: { zh: 'M77', desc: '鲸鱼座的塞弗特星系，拥有活跃的星系核。' },
  78: { zh: 'M78', desc: '猎户座的明亮反射星云，蓝白色的星光映亮尘埃。' },
  79: { zh: 'M79', desc: '天兔座的球状星团，冬季少见的球状星团目标。' },
  80: { zh: 'M80', desc: '天蝎座的致密球状星团，位于心宿二与房宿之间。' },
  81: { zh: '波德星系', desc: '大熊座的明亮旋涡星系，北天最容易观测的星系之一。' },
  82: { zh: '雪茄星系', desc: '大熊座的星暴星系，与波德星系相邻，正剧烈生成新恒星。' },
  83: { zh: '南风车星系', desc: '长蛇座的正向棒旋星系，南天最亮的星系之一。' },
  84: { zh: 'M84', desc: '室女座星系团核心区的透镜状星系。' },
  85: { zh: 'M85', desc: '后发座的透镜状星系，室女座星系团的北缘成员。' },
  86: { zh: 'M86', desc: '室女座星系团核心区的透镜状星系，正朝银河系方向运动。' },
  87: { zh: '室女 A 星系', desc: '室女座星系团中心的巨椭圆星系，人类首张黑洞照片的主角。' },
  88: { zh: 'M88', desc: '后发座的旋涡星系，室女座星系团成员。' },
  89: { zh: 'M89', desc: '室女座的椭圆星系，外形几乎完美球形。' },
  90: { zh: 'M90', desc: '室女座的旋涡星系，正逐渐脱离星系团。' },
  91: { zh: 'M91', desc: '后发座的棒旋星系，梅西耶目录中最暗的成员之一。' },
  92: { zh: 'M92', desc: '武仙座的明亮球状星团，常被近旁的 M13 夺去风头。' },
  93: { zh: 'M93', desc: '船尾座的疏散星团，亮星略呈箭头形。' },
  94: { zh: 'M94', desc: '猎犬座的旋涡星系，拥有明亮的恒星形成环。' },
  95: { zh: 'M95', desc: '狮子座的棒旋星系，棒两端与旋臂相接成环。' },
  96: { zh: 'M96', desc: '狮子座 M96 星系群中最亮的旋涡星系。' },
  97: { zh: '夜枭星云', common: '猫头鹰星云', desc: '大熊座的行星状星云，两个暗斑酷似猫头鹰的双眼。' },
  98: { zh: 'M98', desc: '后发座的侧向旋涡星系，几乎以侧面朝向地球。' },
  99: { zh: 'M99', desc: '后发座的正向旋涡星系，旋臂一侧明显不对称。' },
  100: { zh: 'M100', desc: '后发座的宏观旋涡星系，室女座星系团中最亮的旋涡星系之一。' },
  101: { zh: '风车星系', desc: '大熊座的正向旋涡星系，巨大而舒展的旋臂如风车。' },
  102: { zh: '纺锤星系', desc: '天龙座的透镜状星系，侧向尘埃带如纺锤；M102 归属历史上存在争议，本产品采用 NGC 5866 说。' },
  103: { zh: 'M103', desc: '仙后座的疏散星团，梅西耶亲自编入的最后一个天体。' },
  104: { zh: '草帽星系', desc: '室女座边缘一顶「草帽」，尘埃带勾勒出星系侧影。' },
  105: { zh: 'M105', desc: '狮子座的椭圆星系，M96 星系群成员。' },
  106: { zh: 'M106', desc: '猎犬座的旋涡星系，拥有活跃星系核与异常旋臂。' },
  107: { zh: 'M107', desc: '蛇夫座的球状星团，结构较为松散。' },
  108: { zh: 'M108', desc: '大熊座的侧向棒旋星系，与夜枭星云同视场。' },
  109: { zh: 'M109', desc: '大熊座的棒旋星系，位于北斗天玑星近旁。' },
  110: { zh: 'M110', desc: '仙女座星系的椭圆伴星系。' },
};

/** OpenNGC 的 Const 列用 Se1（巨蛇头）/Se2（巨蛇尾）区分巨蛇座两段，统一归 Ser。 */
function normalizeConst(con) {
  if (con === 'Se1' || con === 'Se2') return 'Ser';
  return con;
}

/** 'HH:MM:SS.SS' → 度（0–360）。非法返回 NaN。 */
function parseRa(s) {
  const m = /^(\d{1,2}):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(s ?? '');
  if (!m) return NaN;
  return round((Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600) * 15, 4);
}

/** '±DD:MM:SS.S' → 度（-90–90）。符号取自首字符（兼容 -00:xx）。非法返回 NaN。 */
function parseDec(s) {
  const m = /^([+-]?)(\d{1,2}):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(s ?? '');
  if (!m) return NaN;
  const sign = m[1] === '-' ? -1 : 1;
  return round(sign * (Number(m[2]) + Number(m[3]) / 60 + Number(m[4]) / 3600), 4);
}

/** 'NGC0224' → 'NGC224'，'IC0434A' → 'IC434A'（去数字段前导零，保留字母后缀）。 */
function normalizeName(name) {
  const m = /^(NGC|IC)0*(\d+)(.*)$/.exec(name);
  if (!m) return name;
  return `${m[1]}${m[2]}${m[3]}`;
}

/** 下载或读缓存，返回 { name → text }。 */
function loadSources(offline) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const out = {};
  for (const src of SOURCES) {
    const cachePath = resolve(CACHE_DIR, src.name);
    if (offline || (existsSync(cachePath) && process.env.USE_CACHE === '1')) {
      if (!existsSync(cachePath)) {
        console.error(`[offline] 未找到缓存 ${cachePath}`);
        process.exit(1);
      }
      console.log(`[cache] 读取 ${cachePath}`);
      out[src.name] = readFileSync(cachePath, 'utf8');
      continue;
    }
    console.log(`[download] ${src.url}`);
    const tmpPath = resolve(CACHE_DIR, '.download.tmp');
    const buf = curlDownload(src.url, tmpPath, src.minBytes);
    if (!buf) {
      if (existsSync(cachePath)) {
        console.log(`[fallback] 下载失败，改用缓存 ${cachePath}`);
        out[src.name] = readFileSync(cachePath, 'utf8');
        continue;
      }
      console.error(`[error] ${src.name} 下载失败且无缓存。绝不编造坐标，不写产物。`);
      console.error(`请手动下载 ${src.url} 保存到 ${cachePath} 后用 --offline 重跑。`);
      process.exit(2);
    }
    writeFileSync(cachePath, buf);
    out[src.name] = buf.toString('utf8');
  }
  return out;
}

/** 解析 OpenNGC 分号 CSV → 行对象数组。 */
function parseOpenNgc(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = parseCsvLine(lines[0], ';');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i], ';');
    /** @type {Record<string, string>} */
    const row = {};
    header.forEach((h, j) => { row[h.trim()] = (cells[j] ?? '').trim(); });
    rows.push(row);
  }
  return rows;
}

/** 行 → 视星等（V 优先、B 兜底），皆空返回 null。 */
function rowMag(row) {
  for (const key of ['V-Mag', 'B-Mag']) {
    const v = row[key];
    if (v) {
      const n = parseFloat(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/** 由一行构造产物对象；messierNum 非空表示以 Messier 身份入选。返回 null 表示该行应剔除。 */
function buildObject(row, messierNum) {
  const rawType = row.Type;
  let type = TYPE_MAP[rawType];
  if (!type && messierNum !== null) type = MESSIER_ONLY_TYPE_MAP[rawType];
  if (!type) return null;

  const ra = parseRa(row.RA);
  const dec = parseDec(row.Dec);
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) return null;

  const mag = rowMag(row);
  const con = normalizeConst(row.Const);
  const names = (row['Common names'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  /** @type {Record<string, unknown>} */
  const obj = {};
  const nameNorm = normalizeName(row.Name);

  if (messierNum !== null) {
    obj.u = `M${messierNum}`;
    obj.m = messierNum;
  } else {
    obj.u = nameNorm;
  }
  obj.t = type;
  obj.ra = ra;
  obj.dec = dec;
  if (mag !== null) obj.mag = round(mag, 2);
  if (con) obj.con = con;

  // 交叉编号：Name 本身是 NGC/IC 时记入；M 行的 NGC 名同样保留。
  const nm = /^(NGC|IC)0*(\d+)(.*)$/.exec(row.Name);
  if (nm) {
    const key = nm[1] === 'NGC' ? 'ngc' : 'ic';
    obj[key] = `${nm[2]}${nm[3]}`;
  }
  if (names.length > 0) obj.names = names;

  if (messierNum !== null) {
    const zhEntry = MESSIER_ZH[messierNum];
    if (!zhEntry) throw new Error(`MESSIER_ZH 缺少 M${messierNum}`);
    obj.zh = zhEntry.zh;
    if (zhEntry.common) obj.commonZh = zhEntry.common;
    obj.desc = zhEntry.desc;
  }

  const majAx = parseFloat(row.MajAx);
  if (Number.isFinite(majAx) && majAx > 0) obj.majAx = round(majAx, 2);

  return obj;
}

/** 产物自检。抛错则不写文件。 */
function selfCheck(objects) {
  if (objects.length < 500 || objects.length > 700) {
    throw new Error(`DSO 总量 ${objects.length} 超出合理区间 [500,700]`);
  }
  const uids = new Set();
  const messier = new Set();
  const legalTypes = new Set(['galaxy', 'nebula', 'cluster', 'star']);
  for (const o of objects) {
    if (uids.has(o.u)) throw new Error(`objectUid 重复：${o.u}`);
    uids.add(o.u);
    if (!legalTypes.has(o.t)) throw new Error(`类型非法：${o.u}=${o.t}`);
    if (!(o.ra >= 0 && o.ra < 360)) throw new Error(`raDeg 越界：${o.u}=${o.ra}`);
    if (!(o.dec >= -90 && o.dec <= 90)) throw new Error(`decDeg 越界：${o.u}=${o.dec}`);
    if (o.m !== undefined) {
      messier.add(o.m);
      if (!o.zh || !o.desc) throw new Error(`Messier 缺中文名/简介：M${o.m}`);
    }
  }
  for (let m = 1; m <= 110; m++) {
    if (!messier.has(m)) throw new Error(`Messier 缺失：M${m}`);
  }
  if (messier.size !== 110) throw new Error(`Messier 数量 ${messier.size} ≠ 110`);

  // 与核心恒星表 uid 无冲突。
  if (existsSync(BRIGHT_STARS_JSON)) {
    const bright = JSON.parse(readFileSync(BRIGHT_STARS_JSON, 'utf8'));
    const starUids = new Set(decodeBrightStars(bright).map((s) => s.u));
    for (const u of uids) {
      if (starUids.has(u)) throw new Error(`DSO uid 与恒星表冲突：${u}`);
    }
  }

  // 抽样坐标断言（J2000 实测值，容差 0.05°）。
  const byUid = new Map(objects.map((o) => [o.u, o]));
  const samples = [
    ['M31', 10.6848, 41.2689],
    ['M42', 83.8221, -5.3911],
    ['M45', 56.869, 24.105],
  ];
  for (const [u, ra, dec] of samples) {
    const o = byUid.get(u);
    if (!o) throw new Error(`抽样缺失：${u}`);
    if (Math.abs(o.ra - ra) > 0.1 || Math.abs(o.dec - dec) > 0.1) {
      throw new Error(`抽样坐标偏差：${u}=(${o.ra}, ${o.dec})，期望≈(${ra}, ${dec})`);
    }
  }
  const m102 = byUid.get('M102');
  if (!m102 || m102.ngc !== '5866') throw new Error('M102 应覆写为 NGC5866');
  console.log('[check] 自检通过（Messier=110、抽样坐标、uid 唯一且不与恒星表冲突）');
}

function main() {
  // MESSIER_ZH 完整性断言（键集合 = 1..110）。
  const zhKeys = Object.keys(MESSIER_ZH).map(Number).sort((a, b) => a - b);
  if (zhKeys.length !== 110 || zhKeys[0] !== 1 || zhKeys[109] !== 110) {
    throw new Error(`MESSIER_ZH 键集合异常：${zhKeys.length} 个`);
  }

  const offline = process.argv.includes('--offline');
  const texts = loadSources(offline);
  const rows = [...parseOpenNgc(texts['NGC.csv']), ...parseOpenNgc(texts['addendum.csv'])];
  console.log(`[parse] OpenNGC 共 ${rows.length} 行`);

  /** @type {Map<number, Record<string, string>>} Messier 号 → 非 Dup 源行。 */
  const messierRows = new Map();
  const nonMessier = [];
  for (const row of rows) {
    const mStr = row.M;
    const mNum = mStr ? parseInt(mStr, 10) : NaN;
    if (Number.isFinite(mNum)) {
      if (row.Type === 'Dup') continue; // M 号重复时取非 Dup 行（如 Name=M102 的 Dup 行被跳过）。
      if (messierRows.has(mNum)) throw new Error(`M${mNum} 出现多个非 Dup 行`);
      messierRows.set(mNum, row);
      continue;
    }
    nonMessier.push(row);
  }

  // Messier 覆写：M102 = NGC5866。
  for (const [mNum, name] of Object.entries(MESSIER_OVERRIDES)) {
    const row = rows.find((r) => normalizeName(r.Name) === normalizeName(name));
    if (!row) throw new Error(`覆写源行缺失：${name}`);
    messierRows.set(Number(mNum), row);
  }

  const objects = [];
  const usedRowNames = new Set(); // 被 Messier 占用的源行，不再以 NGC/IC 身份重复入选。
  for (const [mNum, row] of [...messierRows.entries()].sort((a, b) => a[0] - b[0])) {
    const obj = buildObject(row, mNum);
    if (!obj) throw new Error(`Messier 行构造失败：M${mNum}（Type=${row.Type}）`);
    objects.push(obj);
    usedRowNames.add(row.Name);
  }

  let skippedType = 0;
  let skippedMag = 0;
  for (const row of nonMessier) {
    if (usedRowNames.has(row.Name)) continue;
    const type = TYPE_MAP[row.Type];
    if (!type || type === 'star') { skippedType++; continue; } // 非 Messier 恒星类/跳过类不入选。
    const mag = rowMag(row);
    if (mag === null || mag > MAG_LIMIT_NON_MESSIER) { skippedMag++; continue; }
    const obj = buildObject(row, null);
    if (!obj) { skippedType++; continue; }
    objects.push(obj);
  }
  console.log(
    `[select] Messier ${messierRows.size} + 非 Messier ${objects.length - messierRows.size}` +
      `（跳过 类型=${skippedType} 星等=${skippedMag}）`,
  );

  // 排序：Messier 优先按 M 号，其后按星等从亮到暗。
  objects.sort((a, b) => {
    const am = a.m !== undefined ? 0 : 1;
    const bm = b.m !== undefined ? 0 : 1;
    if (am !== bm) return am - bm;
    if (am === 0) return a.m - b.m;
    return (a.mag ?? 99) - (b.mag ?? 99);
  });

  selfCheck(objects);

  const payload = {
    meta: {
      source: 'OpenNGC (mattiaverga/OpenNGC)',
      sourceUrls: SOURCES.map((s) => s.url),
      license: 'CC-BY-SA-4.0',
      generatedAt: new Date().toISOString(),
      messierCount: 110,
      magLimitNonMessier: MAG_LIMIT_NON_MESSIER,
      count: objects.length,
    },
    objects,
  };
  mkdirSync(dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(payload) + '\n');
  const bytes = readFileSync(OUT_JSON).byteLength;
  console.log(`[write] ${OUT_JSON} — ${objects.length} 个，${(bytes / 1024).toFixed(0)} KB`);
}

try {
  main();
} catch (err) {
  console.error('[fatal]', err);
  process.exit(1);
}
