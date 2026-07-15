// @ts-check
/**
 * 离线 ETL 脚本：下载 d3-celestial 星座连线 → 顶点匹配核心星表 → 产出
 * src/generated/constellation-lines.json（88 星座、以 objectUid 为端点的线段表）。
 *
 * 数据源（BSD-3-Clause，ofrohn/d3-celestial）：
 *   https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.lines.json
 *
 * 匹配算法：GeoJSON 顶点 [raDeg, decDeg]（RA 可能为负 → +360 归一）对核心层
 * bright-stars.json（mag ≤ 6.5）做球面角距最近邻（1°×1° 网格索引 + 5×5 邻域扫描），
 * 容差 0.5°；命中取该星 objectUid（HIP>HD>HR 规则天然继承——如 ξ UMa 经 HD98231 命中）。
 * 端点统一为 objectUid 而非裸 HIP：web 端 CATALOG_BY_UID.get(uid) 直取坐标，零转换。
 *
 * 任一端失配 → 丢弃该线段并计入 meta.droppedSegments；总体匹配率 < 97% 时非零退出
 * （防上游格式漂移静默劣化）。绝不编造坐标：下载失败且无缓存时非零退出。
 *
 * 用法：
 *   node scripts/build-constellation-lines.mjs            下载并生成
 *   node scripts/build-constellation-lines.mjs --offline  读取缓存 .cache/constellations.lines.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { curlDownload, decodeBrightStars } from './etl-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const CACHE_DIR = resolve(__dirname, '.cache');
const CACHE_JSON = resolve(CACHE_DIR, 'constellations.lines.json');
const OUT_JSON = resolve(PKG_ROOT, 'src/generated/constellation-lines.json');
const BRIGHT_STARS_JSON = resolve(PKG_ROOT, 'src/generated/bright-stars.json');
const CONSTELLATIONS_TS = resolve(PKG_ROOT, 'src/constellations.ts');

const SOURCE_URL =
  'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.lines.json';
const TOLERANCE_DEG = 0.5;
const MIN_MATCH_RATE = 0.97;

const DEG = Math.PI / 180;

/** 赤经/赤纬（度）→ 单位向量。 */
function toVec(raDeg, decDeg) {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const c = Math.cos(dec);
  return [c * Math.cos(ra), c * Math.sin(ra), Math.sin(dec)];
}

/** 两单位向量的球面角距（度）。 */
function angularDeg(a, b) {
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return Math.acos(dot) / DEG;
}

/** 下载或读缓存星座连线 GeoJSON。 */
function loadLines(offline) {
  mkdirSync(CACHE_DIR, { recursive: true });
  if (offline || (existsSync(CACHE_JSON) && process.env.USE_CACHE === '1')) {
    if (!existsSync(CACHE_JSON)) {
      console.error(`[offline] 未找到缓存 ${CACHE_JSON}`);
      process.exit(1);
    }
    console.log(`[cache] 读取 ${CACHE_JSON}`);
    return JSON.parse(readFileSync(CACHE_JSON, 'utf8'));
  }
  console.log(`[download] ${SOURCE_URL}`);
  const tmpPath = resolve(CACHE_DIR, '.download.tmp');
  const buf = curlDownload(SOURCE_URL, tmpPath, 10_000);
  if (!buf) {
    if (existsSync(CACHE_JSON)) {
      console.log(`[fallback] 下载失败，改用缓存 ${CACHE_JSON}`);
      return JSON.parse(readFileSync(CACHE_JSON, 'utf8'));
    }
    console.error('[error] 星座连线下载失败且无缓存。不写产物。');
    console.error(`请手动下载 ${SOURCE_URL} 保存到 ${CACHE_JSON} 后用 --offline 重跑。`);
    process.exit(2);
  }
  writeFileSync(CACHE_JSON, buf);
  return JSON.parse(buf.toString('utf8'));
}

/** 从 constellations.ts 提取全 88 个 IAU 缩写键（避免脚本重复维护一份清单）。 */
function loadConstellationAbbrs() {
  const src = readFileSync(CONSTELLATIONS_TS, 'utf8');
  const abbrs = new Set();
  const re = /^\s{2}([A-Z][A-Za-z]{1,2}):\s*\{\s*en:/gm;
  let m;
  while ((m = re.exec(src)) !== null) abbrs.add(m[1]);
  if (abbrs.size !== 88) {
    throw new Error(`constellations.ts 缩写提取到 ${abbrs.size} 个，期望 88`);
  }
  return abbrs;
}

/** 构建核心星表的 1°×1° 网格空间索引。 */
function buildStarIndex(stars) {
  /** @type {Map<string, Array<{ u: string, vec: number[] }>>} */
  const grid = new Map();
  for (const s of stars) {
    const key = `${Math.floor(s.ra)},${Math.floor(s.dec)}`;
    let cell = grid.get(key);
    if (!cell) { cell = []; grid.set(key, cell); }
    cell.push({ u: s.u, vec: toVec(s.ra, s.dec) });
  }
  return grid;
}

/** 最近邻查找：5×5 邻域扫描 + 容差判定。返回 objectUid 或 null。 */
function nearestStar(grid, raDeg, decDeg) {
  const vec = toVec(raDeg, decDeg);
  const ra0 = Math.floor(raDeg);
  const dec0 = Math.floor(decDeg);
  let best = null;
  let bestDist = Infinity;
  for (let dr = -2; dr <= 2; dr++) {
    for (let dd = -2; dd <= 2; dd++) {
      const ra = ((ra0 + dr) % 360 + 360) % 360; // RA 环回。
      const dec = dec0 + dd;
      if (dec < -90 || dec > 89) continue;
      const cell = grid.get(`${ra},${dec}`);
      if (!cell) continue;
      for (const s of cell) {
        const d = angularDeg(vec, s.vec);
        if (d < bestDist) { bestDist = d; best = s.u; }
      }
    }
  }
  return bestDist <= TOLERANCE_DEG ? best : null;
}

function main() {
  const offline = process.argv.includes('--offline');
  const geo = loadLines(offline);
  if (geo?.type !== 'FeatureCollection' || !Array.isArray(geo.features)) {
    throw new Error('星座连线 GeoJSON 结构异常');
  }

  const abbrs = loadConstellationAbbrs();

  if (!existsSync(BRIGHT_STARS_JSON)) {
    throw new Error(`缺少核心星表 ${BRIGHT_STARS_JSON}，请先运行 build-catalog.mjs`);
  }
  const bright = JSON.parse(readFileSync(BRIGHT_STARS_JSON, 'utf8'));
  const stars = decodeBrightStars(bright); // 9C 列式/旧行式双兼容
  console.log(`[pool] 匹配池 = 核心层 ${stars.length} 颗（mag ≤ ${bright.meta?.magLimit}）`);
  const grid = buildStarIndex(stars);

  // 按 id 合并 Feature（Ser 蛇头/蛇尾两条 Feature 合并 segments）。
  /** @type {Map<string, Array<[string, string]>>} */
  const byCon = new Map();
  let totalSegments = 0;
  let dropped = 0;
  const droppedDetails = [];

  for (const feature of geo.features) {
    const con = feature.id;
    if (!abbrs.has(con)) throw new Error(`未知星座缩写：${con}`);
    let segments = byCon.get(con);
    if (!segments) { segments = []; byCon.set(con, segments); }

    const geom = feature.geometry;
    const polylines = geom.type === 'MultiLineString' ? geom.coordinates
      : geom.type === 'LineString' ? [geom.coordinates] : null;
    if (!polylines) throw new Error(`几何类型异常：${con}=${geom.type}`);

    for (const line of polylines) {
      // 逐顶点匹配（RA 可能为负 → +360 归一）。
      const uids = line.map(([ra, dec]) => nearestStar(grid, ra < 0 ? ra + 360 : ra, dec));
      for (let i = 0; i + 1 < line.length; i++) {
        totalSegments++;
        const a = uids[i];
        const b = uids[i + 1];
        if (!a || !b || a === b) {
          dropped++;
          droppedDetails.push(
            `${con} (${line[i][0]},${line[i][1]})→(${line[i + 1][0]},${line[i + 1][1]})` +
              `：${!a ? '起点失配' : !b ? '终点失配' : '自环'}`,
          );
          continue;
        }
        segments.push([a, b]);
      }
    }
  }

  const matchRate = (totalSegments - dropped) / totalSegments;
  console.log(
    `[match] 线段 ${totalSegments}，丢弃 ${dropped}，匹配率 ${(matchRate * 100).toFixed(2)}%`,
  );
  for (const d of droppedDetails) console.log(`  [dropped] ${d}`);
  if (matchRate < MIN_MATCH_RATE) {
    throw new Error(`匹配率 ${(matchRate * 100).toFixed(2)}% < ${MIN_MATCH_RATE * 100}%，疑似上游格式漂移`);
  }

  // 自检：88 星座全覆盖、无空段、无自环（构造期已剔）。
  if (byCon.size !== 88) throw new Error(`星座数 ${byCon.size} ≠ 88`);
  for (const abbr of abbrs) {
    if (!byCon.has(abbr)) throw new Error(`星座缺失：${abbr}`);
    const segs = byCon.get(abbr);
    if (segs.length === 0) throw new Error(`星座无可绘线段：${abbr}`);
    for (const [a, b] of segs) {
      if (a === b) throw new Error(`自环段：${abbr} ${a}`);
    }
  }

  const constellations = [...byCon.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([con, segments]) => ({ con, segments }));
  const segmentCount = constellations.reduce((n, c) => n + c.segments.length, 0);

  const payload = {
    meta: {
      source: 'd3-celestial (ofrohn/d3-celestial)',
      sourceUrl: SOURCE_URL,
      license: 'BSD-3-Clause',
      generatedAt: new Date().toISOString(),
      matchToleranceDeg: TOLERANCE_DEG,
      constellationCount: constellations.length,
      segmentCount,
      droppedSegments: dropped,
    },
    constellations,
  };
  mkdirSync(dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(payload) + '\n');
  const bytes = readFileSync(OUT_JSON).byteLength;
  console.log(`[write] ${OUT_JSON} — ${constellations.length} 星座 / ${segmentCount} 线段，${(bytes / 1024).toFixed(0)} KB`);
}

try {
  main();
} catch (err) {
  console.error('[fatal]', err);
  process.exit(1);
}
