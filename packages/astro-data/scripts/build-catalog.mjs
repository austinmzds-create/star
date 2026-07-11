// @ts-check
/**
 * 离线 ETL 脚本：下载 HYG Database v41 → 双层产出。
 *   核心层 mag ≤ 6.5 → src/generated/bright-stars.json（随包，短键对象格式不变）
 *   扩展层 6.5 < mag ≤ 7.5 → apps/web/public/data/stars-extended.json（懒加载，列式紧凑格式）
 *
 * 手动/低频人工运行，两个产物均提交入库；运行时（前端/后端）不联网。
 * 扩展层为纯渲染层：不进搜索索引、不可拾取、不含编号（详见 generated/README.md）。
 *
 * 用法：
 *   node scripts/build-catalog.mjs            下载 HYG 并生成
 *   node scripts/build-catalog.mjs --offline  读取本地缓存 .cache/hygdata.csv 生成
 *
 * 代理：Node 全局 fetch 默认不读 HTTPS_PROXY，且 undici 不作为可解析裸模块暴露；
 * 故下载走系统 curl（child_process），curl 天然遵守 HTTPS_PROXY / https_proxy。
 * 若 TLS 校验失败，设 NODE_EXTRA_CA_CERTS 指向代理 CA（如 /root/.ccr/ca-bundle.crt）后重跑，
 * 或让 curl 读 CURL_CA_BUNDLE（本脚本会把 NODE_EXTRA_CA_CERTS 传给 curl 的 --cacert）。
 *
 * 零新增依赖：仅用 Node 内置能力（fs/path/url/zlib）+ 系统 curl。
 */

import { gunzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { curlDownload, parseCsvLine, round } from './etl-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const CACHE_DIR = resolve(__dirname, '.cache');
const CACHE_CSV = resolve(CACHE_DIR, 'hygdata.csv');
const OUT_JSON = resolve(PKG_ROOT, 'src/generated/bright-stars.json');
const OUT_EXT_JSON = resolve(PKG_ROOT, '../../apps/web/public/data/stars-extended.json');

const MAG_CORE = 6.5; // 核心层阈值：mag ≤ 6.5，约 9000 颗（随包）。
const MAG_EXT = 7.5; // 扩展层阈值：6.5 < mag ≤ 7.5，约 17000 颗（web 懒加载）。

const HYG_URLS = [
  'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv',
  'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v42.csv',
  'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v40.csv',
  'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v38.csv',
  'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v37.csv',
  'https://raw.githubusercontent.com/astronexus/HYG-Database/master/hygdata_v3.csv',
  'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hygdata_v3.csv',
  'https://raw.githubusercontent.com/astronexus/HYG-Database/master/hyg/v3/hygdata_v3.csv',
  'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv.gz',
];

// HYG bayer 缩写 → Unicode 希腊字母。
const GREEK = {
  Alp: 'α', Bet: 'β', Gam: 'γ', Del: 'δ', Eps: 'ε', Zet: 'ζ', Eta: 'η', The: 'θ',
  Iot: 'ι', Kap: 'κ', Lam: 'λ', Mu: 'μ', Nu: 'ν', Xi: 'ξ', Omi: 'ο', Pi: 'π',
  Rho: 'ρ', Sig: 'σ', Tau: 'τ', Ups: 'υ', Phi: 'φ', Chi: 'χ', Psi: 'ψ', Ome: 'ω',
};

/** 依次尝试下载 HYG，第一个成功即止。返回 { text, url } 或抛错。 */
function downloadHyg() {
  mkdirSync(CACHE_DIR, { recursive: true });
  const tmpPath = resolve(CACHE_DIR, '.download.tmp');
  for (const url of HYG_URLS) {
    console.log(`[download] 尝试 ${url}`);
    const buf = curlDownload(url, tmpPath, 1_000_000); // HYG 全量 CSV 应远超 1MB。
    if (!buf) continue;
    const text = url.endsWith('.gz')
      ? gunzipSync(buf).toString('utf8')
      : buf.toString('utf8');
    console.log(`  → 成功，${(buf.byteLength / 1e6).toFixed(1)} MB`);
    return { text, url };
  }
  throw new Error('所有 HYG URL 下载失败');
}

/** 解析 CSV 文本 → { coreStars, extStars }（单次解析、按 mag 两路分流）。 */
function parseHyg(csvText) {
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) throw new Error('CSV 内容异常（行数不足）');
  const header = parseCsvLine(lines[0]);
  const col = {};
  header.forEach((name, i) => { col[name.trim()] = i; });

  // 必需列存在性校验。
  for (const need of ['id', 'ra', 'dec', 'mag', 'con']) {
    if (col[need] === undefined) throw new Error(`CSV 缺少必需列：${need}`);
  }

  /** 取列值，空串 → undefined。 */
  const get = (row, name) => {
    const idx = col[name];
    if (idx === undefined) return undefined;
    const v = row[idx];
    if (v === undefined) return undefined;
    const t = v.trim();
    return t === '' ? undefined : t;
  };

  const stars = [];
  const extStars = [];
  let skippedMag = 0;
  let skippedOrphan = 0;
  let skippedCoord = 0;

  for (let li = 1; li < lines.length; li++) {
    const raw = lines[li];
    if (!raw) continue;
    const row = parseCsvLine(raw);

    const id = get(row, 'id');
    if (id === '0') continue; // 太阳 Sol。

    const magStr = get(row, 'mag');
    const magNum = magStr === undefined ? NaN : parseFloat(magStr);
    if (!Number.isFinite(magNum) || magNum > MAG_EXT) { skippedMag++; continue; }

    const hip = get(row, 'hip');
    const hd = get(row, 'hd');
    const hr = get(row, 'hr');
    const gl = get(row, 'gl');
    // 孤儿剔除（核心/扩展层同规则，保数据质量；扩展层被剔的无编号暗星极少，可接受）。
    if (!hip && !hd && !hr) { skippedOrphan++; continue; }

    const raStr = get(row, 'ra');
    const decStr = get(row, 'dec');
    const raHours = raStr === undefined ? NaN : parseFloat(raStr);
    const decNum = decStr === undefined ? NaN : parseFloat(decStr);
    const raDeg = round(raHours * 15, 4);
    const decDeg = round(decNum, 4);
    if (
      !Number.isFinite(raDeg) || raDeg < 0 || raDeg >= 360 ||
      !Number.isFinite(decDeg) || decDeg < -90 || decDeg > 90
    ) { skippedCoord++; continue; }

    // —— 扩展层分流：仅渲染用途，只留坐标/星等/光谱主类（列式存储，见 writeExtended）——
    if (magNum > MAG_CORE) {
      const spect = get(row, 'spect');
      const specClass = spect && /^[OBAFGKM]/i.test(spect) ? spect[0].toUpperCase() : '?';
      extStars.push({
        ra: round(raDeg, 3), // 0.001° = 3.6″，天球半径 1000 下远小于 1px（≈0.05°）。
        dec: round(decDeg, 3),
        mag: round(magNum, 2),
        spec: specClass,
      });
      continue;
    }

    // 距离：pc → ly；100000 为 HYG 未知哨兵。
    const distStr = get(row, 'dist');
    const distPc = distStr === undefined ? NaN : parseFloat(distStr);
    const distanceLy = (!Number.isFinite(distPc) || distPc >= 100000)
      ? null
      : round(distPc * 3.26156, 1);

    const spect = get(row, 'spect');
    const con = get(row, 'con');
    const proper = get(row, 'proper');
    const bf = get(row, 'bf');
    const flam = get(row, 'flam');

    // objectUid 优先级 HIP > HD > HR > GL。
    let u;
    if (hip) u = 'HIP' + hip;
    else if (hd) u = 'HD' + hd;
    else if (hr) u = 'HR' + hr;
    else if (gl) u = 'GL' + gl.replace(/\s+/g, '');
    else continue; // 理论不达（已被孤儿剔除挡掉）。

    // bayer 希腊字母：HYG bayer 缩写（可能带尾部上标数字，如 "Alp2"）+ con。
    const bayerAbbrRaw = get(row, 'bayer');
    let bayer;
    if (bayerAbbrRaw && con) {
      const m = bayerAbbrRaw.match(/^([A-Za-z]+)(\d*)$/);
      const letter = m ? GREEK[m[1]] : undefined;
      if (letter) {
        const sup = m && m[2] ? m[2] : '';
        bayer = `${letter}${sup} ${con}`;
      }
    }

    /** @type {Record<string, unknown>} */
    const star = { u, ra: raDeg, dec: decDeg, mag: round(magNum, 2) };
    star.dist = distanceLy; // 明确写 null 以区别「无此键」。
    if (spect) star.spect = spect;
    if (con) star.con = con;
    if (bayer) star.bayer = bayer;
    if (flam) star.flam = flam;
    if (proper) star.proper = proper;
    else if (bf) star.bf = bf; // 无 proper 时保留 Bayer-Flamsteed 全名做名称回退/别名。
    if (hip) star.hip = hip;
    if (hd) star.hd = hd;
    if (hr) star.hr = hr;

    stars.push(star);
  }

  console.log(
    `[parse] 核心层 ${stars.length} 颗 + 扩展层 ${extStars.length} 颗；` +
      `跳过 mag=${skippedMag} 孤儿=${skippedOrphan} 坐标=${skippedCoord}`,
  );
  return { coreStars: stars, extStars };
}

/** 核心层产物自检。抛错则不写文件。 */
function selfCheck(stars) {
  if (stars.length < 7000 || stars.length > 11000) {
    throw new Error(`星数 ${stars.length} 超出合理区间 [7000,11000]，疑似解析崩坏`);
  }
  const byUid = new Map();
  for (const s of stars) {
    if (s.ra < 0 || s.ra >= 360) throw new Error(`raDeg 越界：${s.u}=${s.ra}`);
    if (s.dec < -90 || s.dec > 90) throw new Error(`decDeg 越界：${s.u}=${s.dec}`);
    if (byUid.has(s.u)) throw new Error(`objectUid 重复：${s.u}`);
    byUid.set(s.u, s);
  }
  // 抽样断言（用 HYG v41 实测值 + 容差；HYG 的 Sirius mag=-1.44，与手写 60 颗的 -1.46 略异）。
  const sirius = byUid.get('HIP32349');
  if (!sirius || Math.abs(sirius.mag - -1.44) > 0.05) {
    throw new Error(`抽样失败：天狼星 HIP32349 mag=${sirius && sirius.mag}（期望≈-1.44）`);
  }
  if (Math.abs(sirius.ra - 101.28) > 0.2) throw new Error(`抽样失败：天狼星 raDeg=${sirius.ra}（期望≈101.28）`);
  const vega = byUid.get('HIP91262');
  if (!vega || Math.abs(vega.mag - 0.03) > 0.02) {
    throw new Error(`抽样失败：织女星 HIP91262 mag=${vega && vega.mag}（期望≈0.03）`);
  }
  console.log('[check] 核心层自检通过（含天狼星/织女星抽样）');
}

/** 扩展层产物自检。抛错则不写文件。 */
function selfCheckExt(extStars) {
  if (extStars.length < 14000 || extStars.length > 20000) {
    throw new Error(`扩展层星数 ${extStars.length} 超出合理区间 [14000,20000]，疑似解析崩坏`);
  }
  for (const s of extStars) {
    if (!(s.mag > MAG_CORE && s.mag <= MAG_EXT + 0.005)) {
      throw new Error(`扩展层 mag 越界：${s.mag}（应在 (${MAG_CORE}, ${MAG_EXT}]）`);
    }
    if (s.ra < 0 || s.ra >= 360) throw new Error(`扩展层 raDeg 越界：${s.ra}`);
    if (s.dec < -90 || s.dec > 90) throw new Error(`扩展层 decDeg 越界：${s.dec}`);
    if (!/^[OBAFGKM?]$/.test(s.spec)) throw new Error(`扩展层光谱主类非法：${s.spec}`);
  }
  console.log('[check] 扩展层自检通过');
}

async function main() {
  const offline = process.argv.includes('--offline');
  let csvText;
  let sourceUrl = HYG_URLS[0];

  if (offline) {
    if (!existsSync(CACHE_CSV)) {
      console.error(`[offline] 未找到缓存 ${CACHE_CSV}`);
      process.exit(1);
    }
    console.log(`[offline] 读取缓存 ${CACHE_CSV}`);
    csvText = readFileSync(CACHE_CSV, 'utf8');
  } else if (existsSync(CACHE_CSV) && process.env.USE_CACHE === '1') {
    console.log(`[cache] USE_CACHE=1，读取缓存 ${CACHE_CSV}`);
    csvText = readFileSync(CACHE_CSV, 'utf8');
  } else {
    try {
      const dl = downloadHyg();
      csvText = dl.text;
      sourceUrl = dl.url;
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(CACHE_CSV, csvText);
      console.log(`[cache] 已缓存到 ${CACHE_CSV}`);
    } catch (err) {
      console.error('');
      console.error('==========================================================');
      console.error('[error] HYG 下载失败，且无本地缓存。');
      console.error('请手动下载 HYG v41 CSV：');
      console.error('  ' + HYG_URLS[0]);
      console.error(`保存到 ${CACHE_CSV}，然后运行：`);
      console.error('  node scripts/build-catalog.mjs --offline');
      console.error('绝不生成假坐标；未获真实数据不写 generated JSON。');
      console.error('（catalog.ts 已内置手写回退，缺 JSON 时仍可构建。）');
      console.error('==========================================================');
      process.exit(2);
    }
  }

  const { coreStars, extStars } = parseHyg(csvText);
  selfCheck(coreStars);
  selfCheckExt(extStars);

  // 按 mag 升序（亮 → 暗）。
  coreStars.sort((a, b) => a.mag - b.mag);
  extStars.sort((a, b) => a.mag - b.mag);

  const payload = {
    meta: {
      source: 'HYG Database v41 (astronexus/HYG-Database)',
      sourceUrl,
      license: 'CC BY-SA 4.0',
      generatedAt: new Date().toISOString(),
      magLimit: MAG_CORE,
      count: coreStars.length,
    },
    stars: coreStars,
  };

  mkdirSync(dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(payload) + '\n');
  const bytes = readFileSync(OUT_JSON).byteLength;
  console.log(`[write] ${OUT_JSON} — ${coreStars.length} 颗，${(bytes / 1024).toFixed(0)} KB`);

  // 扩展层：列式紧凑格式（四并行数组 + 光谱主类字符串），web 端页面空闲后 fetch。
  const extPayload = {
    meta: {
      source: 'HYG Database v41 (astronexus/HYG-Database)',
      sourceUrl,
      license: 'CC BY-SA 4.0',
      generatedAt: new Date().toISOString(),
      magRange: [MAG_CORE, MAG_EXT],
      count: extStars.length,
    },
    n: extStars.length,
    ra: extStars.map((s) => s.ra),
    dec: extStars.map((s) => s.dec),
    mag: extStars.map((s) => s.mag),
    spec: extStars.map((s) => s.spec).join(''),
  };
  mkdirSync(dirname(OUT_EXT_JSON), { recursive: true });
  writeFileSync(OUT_EXT_JSON, JSON.stringify(extPayload) + '\n');
  const extBytes = readFileSync(OUT_EXT_JSON).byteLength;
  console.log(`[write] ${OUT_EXT_JSON} — ${extStars.length} 颗，${(extBytes / 1024).toFixed(0)} KB`);
  console.log('完成。请更新 src/generated/README.md 的生成时间与行数。');
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
