// @ts-check
/**
 * 离线 ETL 脚本：下载 HYG Database v41 → 三层产出。
 *   核心层 mag ≤ 6.5 → src/generated/bright-stars.json（随包，短键对象格式，lean——
 *     只含坐标/星等/距离/光谱/编号/名称，不带 pm 等增强字段，控制主 chunk 体积）
 *   扩展层 6.5 < mag ≤ 7.5 → apps/web/public/data/stars-extended.json（懒加载，列式紧凑格式）
 *   增强层（Phase 9C）→ src/generated/star-extras.json（异步 chunk，byUid 记录）：
 *     pm/ci/变星幅度/聚星标记全部走这里，loadStarExtras() 动态 import 消费。
 *
 * 自行（Phase 9B 恒星自行时光机 → 9C 迁移至 star-extras）：
 *   HYG 的 pmra/pmdec 列（mas/yr；pmra 已含 cosδ 因子）——
 *   9B 曾透传进核心层（每星 +2 键，主页 First Load 593→748KB），9C 撤回：
 *   核心层回归 lean，pm 改进 star-extras.json（round 0.1 mas/yr）；
 *   扩展层保持 +2 列 int16 语义整数（单位 0.5 mas/yr，存值 = round(mas×2)，±32767 覆盖
 *   全表最大自行；缺测记 0 = 深时模式下不动）——扩展层本就是懒加载，不占主 chunk。
 *   已知数据源缺陷：HYG v41 把 |pm| 分量截断在 9999.99（字段宽度），受影响的只有
 *   Barnard 星（HIP87937，实测 pmdec≈+10362 mas/yr）——其 mag=9.54 本就在两层之外，
 *   对产物无影响；如未来扩层需谨记此截断。
 *
 * star-extras.json 字段（HYG 隐藏字段解禁，r-data §1/§4）：
 *   p: [pmra, pmdec]（mas/yr，round 0.1）；c: ci（B−V 色指数，round 0.01）；
 *   v: [varMin, varMax]（变星幅度两端视星等，HYG 语义：varMin=最暗、varMax=最亮，
 *      round 0.01；仅 var 变星命名列非空时写出，避免 HYG 对非变星也填 min/max 的噪声）；
 *   m: 1（聚星/双星系统：base 非空 或 comp≠1 或 同一 comp_primary 组内成员 >1）；
 *   n: IAU-CSN 官方星名（由 build-star-names.mjs 二次写入，本脚本重跑时原样保留）。
 *   覆盖范围 = 核心层全部 uid + 手写目录里核心层外的星（比邻星 HIP70890）。
 *
 * 手动/低频人工运行，三个产物均提交入库；运行时（前端/后端）不联网。
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
const OUT_EXTRAS_JSON = resolve(PKG_ROOT, 'src/generated/star-extras.json');

/**
 * 核心层（mag≤6.5）之外仍需 star-extras 覆盖的 HIP 号：
 * 手写精选目录里超出核心层阈值的星（比邻星 mag 11.13）。取值同源 HYG CSV。
 */
const EXTRAS_HIP_ALLOWLIST = new Set(['70890']);

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

/** 解析 CSV 文本 → { coreStars, extStars, extras }（两遍解析：先聚星分组，再按 mag 分流）。 */
function parseHyg(csvText) {
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) throw new Error('CSV 内容异常（行数不足）');
  const header = parseCsvLine(lines[0]);
  const col = {};
  header.forEach((name, i) => { col[name.trim()] = i; });

  // 必需列存在性校验（9C 增强字段列一并强校验：上游删列必须显式失败，绝不静默产出残缺 extras）。
  for (const need of ['id', 'ra', 'dec', 'mag', 'con', 'ci', 'var', 'var_min', 'var_max', 'comp', 'comp_primary', 'base']) {
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

  // —— 第一遍（全表 12 万行）：comp_primary 分组计数——同组成员 >1 即聚星系统。
  // 伴星常暗于核心层阈值（天狼 B mag 8.4），只有全表统计才能给主星打上聚星标记。
  const primaryGroupCount = new Map();
  for (let li = 1; li < lines.length; li++) {
    const raw = lines[li];
    if (!raw) continue;
    const row = parseCsvLine(raw);
    const cp = get(row, 'comp_primary');
    if (cp) primaryGroupCount.set(cp, (primaryGroupCount.get(cp) ?? 0) + 1);
  }

  const stars = [];
  const extStars = [];
  /** star-extras.json 的 byUid 记录（uid → { p?, c?, v?, m? }）。 */
  const extras = {};
  let skippedMag = 0;
  let skippedOrphan = 0;
  let skippedCoord = 0;

  for (let li = 1; li < lines.length; li++) {
    const raw = lines[li];
    if (!raw) continue;
    const row = parseCsvLine(raw);

    const id = get(row, 'id');
    if (id === '0') continue; // 太阳 Sol。

    const hip = get(row, 'hip');
    // 允许名单星（比邻星）超出扩展层阈值仍要产 extras 记录，先于 mag 过滤判定。
    const isAllowlisted = hip !== undefined && EXTRAS_HIP_ALLOWLIST.has(hip);

    const magStr = get(row, 'mag');
    const magNum = magStr === undefined ? NaN : parseFloat(magStr);
    if (!Number.isFinite(magNum) || (magNum > MAG_EXT && !isAllowlisted)) { skippedMag++; continue; }

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

    // 自行（mas/yr，HYG pmra 列已含 cosδ）：缺测 → undefined（核心层省键 / 扩展层记 0）。
    const pmraStr = get(row, 'pmra');
    const pmdecStr = get(row, 'pmdec');
    const pmraNum = pmraStr === undefined ? NaN : parseFloat(pmraStr);
    const pmdecNum = pmdecStr === undefined ? NaN : parseFloat(pmdecStr);
    const hasPm = Number.isFinite(pmraNum) && Number.isFinite(pmdecNum);

    // —— 增强层记录（9C star-extras）：核心层 uid + 允许名单星。uid 规则与核心层一致。——
    // 注意先于扩展层分流：允许名单星（mag 11）不进任何渲染层，但必须有 extras 记录。
    const inCore = magNum <= MAG_CORE;
    if (inCore || isAllowlisted) {
      let uidForExtras;
      if (hip) uidForExtras = 'HIP' + hip;
      else if (hd) uidForExtras = 'HD' + hd;
      else if (hr) uidForExtras = 'HR' + hr;
      if (uidForExtras) {
        /** @type {Record<string, unknown>} */
        const ex = {};
        if (hasPm) ex.p = [round(pmraNum, 1), round(pmdecNum, 1)];
        const ciStr = get(row, 'ci');
        const ciNum = ciStr === undefined ? NaN : parseFloat(ciStr);
        if (Number.isFinite(ciNum)) ex.c = round(ciNum, 2);
        // 变星幅度：仅 var 命名列非空才写（HYG 对非变星也会填 var_min/var_max，属噪声）。
        const varName = get(row, 'var');
        const vMinStr = get(row, 'var_min');
        const vMaxStr = get(row, 'var_max');
        const vMin = vMinStr === undefined ? NaN : parseFloat(vMinStr);
        const vMax = vMaxStr === undefined ? NaN : parseFloat(vMaxStr);
        if (varName && Number.isFinite(vMin) && Number.isFinite(vMax)) {
          ex.v = [round(vMin, 2), round(vMax, 2)];
        }
        // 聚星判定：base 非空 / comp≠1 / 同 comp_primary 组成员 >1（第一遍全表统计）。
        const base = get(row, 'base');
        const comp = get(row, 'comp');
        const compPrimary = get(row, 'comp_primary');
        const multiple =
          !!base ||
          (comp !== undefined && comp !== '1') ||
          (compPrimary !== undefined && (primaryGroupCount.get(compPrimary) ?? 0) > 1);
        if (multiple) ex.m = 1;
        if (Object.keys(ex).length > 0) extras[uidForExtras] = ex;
      }
    }

    // —— 扩展层分流：仅渲染用途，只留坐标/星等/光谱主类 + 自行（列式存储，见 writeExtended）——
    if (magNum > MAG_CORE) {
      if (!inCore && isAllowlisted && magNum > MAG_EXT) continue; // 允许名单星只产 extras
      const spect = get(row, 'spect');
      const specClass = spect && /^[OBAFGKM]/i.test(spect) ? spect[0].toUpperCase() : '?';
      // int16 语义编码（0.5 mas/yr 单位）：round(mas×2)，钳到 ±32767。
      const enc = (v) => Math.max(-32767, Math.min(32767, Math.round(v * 2)));
      extStars.push({
        ra: round(raDeg, 3), // 0.001° = 3.6″，天球半径 1000 下远小于 1px（≈0.05°）。
        dec: round(decDeg, 3),
        mag: round(magNum, 2),
        spec: specClass,
        pmra: hasPm ? enc(pmraNum) : 0,
        pmdec: hasPm ? enc(pmdecNum) : 0,
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
    // 9C lean 纪律：pm 不再进核心层（见文件头注释），统一走 star-extras.json。
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
    `[parse] 核心层 ${stars.length} 颗 + 扩展层 ${extStars.length} 颗 + extras ${Object.keys(extras).length} 条；` +
      `跳过 mag=${skippedMag} 孤儿=${skippedOrphan} 坐标=${skippedCoord}`,
  );
  return { coreStars: stars, extStars, extras };
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
  // 9C lean 纪律：核心层绝不允许再带 pm 键（防回归——pm 已迁 star-extras.json）。
  for (const s of stars) {
    if ('pmra' in s || 'pmdec' in s) {
      throw new Error(`核心层出现 pm 键（应走 star-extras.json）：${s.u}`);
    }
  }
  console.log('[check] 核心层自检通过（含天狼星/织女星抽样 + lean 无 pm 键断言）');
}

/** 增强层（star-extras）产物自检。抛错则不写文件。期望值 = 缓存 CSV 实值（python 核实 2026-07-15）。 */
function selfCheckExtras(extras) {
  const n = Object.keys(extras).length;
  if (n < 7000 || n > 11000) {
    throw new Error(`extras 条数 ${n} 超出合理区间 [7000,11000]，疑似解析崩坏`);
  }
  // 自行抽样（迁自 9B 核心层自检）：HIP32349 pmra=-546.01 pmdec=-1223.08；HIP91262 pmra=201.02。
  const sirius = extras['HIP32349'];
  if (!sirius?.p || Math.abs(sirius.p[0] - -546.0) > 1 || Math.abs(sirius.p[1] - -1223.1) > 1) {
    throw new Error(`extras 抽样失败：天狼星 p=${JSON.stringify(sirius?.p)}（期望≈[-546.0,-1223.1]）`);
  }
  const vega = extras['HIP91262'];
  if (!vega?.p || Math.abs(vega.p[0] - 201.0) > 1) {
    throw new Error(`extras 抽样失败：织女星 p=${JSON.stringify(vega?.p)}（期望 pmra≈201.0）`);
  }
  // ci 抽样：天狼星 ci=0.009→0.01；北极星 ci=0.636→0.64（Ballesteros 反解温度的输入）。
  if (sirius.c === undefined || Math.abs(sirius.c - 0.01) > 0.011) {
    throw new Error(`extras 抽样失败：天狼星 ci=${sirius.c}（期望≈0.01）`);
  }
  const polaris = extras['HIP11767'];
  if (!polaris || polaris.c === undefined || Math.abs(polaris.c - 0.64) > 0.011) {
    throw new Error(`extras 抽样失败：北极星 ci=${polaris?.c}（期望≈0.64）`);
  }
  // 变星抽样：北极星 var=Alp，var_min=1.99 / var_max=1.95（HYG 语义：min=最暗）。
  if (!polaris.v || Math.abs(polaris.v[0] - 1.99) > 0.02 || Math.abs(polaris.v[1] - 1.95) > 0.02) {
    throw new Error(`extras 抽样失败：北极星 v=${JSON.stringify(polaris.v)}（期望≈[1.99,1.95]）`);
  }
  // 聚星抽样：天狼星 base='Gl 244' → m=1。
  if (sirius.m !== 1) throw new Error('extras 抽样失败：天狼星应标记聚星 m=1');
  // 允许名单：比邻星（核心层外）必须有记录且带 pm（-3775.6/768.2）与 ci（1.807→1.81）。
  const proxima = extras['HIP70890'];
  if (!proxima?.p || Math.abs(proxima.p[0] - -3775.6) > 1 || proxima.c === undefined) {
    throw new Error(`extras 抽样失败：比邻星记录缺失或不完整 ${JSON.stringify(proxima)}`);
  }
  // 值域检查。
  for (const [uid, ex] of Object.entries(extras)) {
    if (ex.p !== undefined) {
      if (!Array.isArray(ex.p) || ex.p.length !== 2 || !ex.p.every((x) => Number.isFinite(x) && Math.abs(x) < 10500)) {
        throw new Error(`extras pm 非法：${uid}=${JSON.stringify(ex.p)}`);
      }
    }
    if (ex.c !== undefined && !(Number.isFinite(ex.c) && ex.c > -1 && ex.c < 6)) {
      throw new Error(`extras ci 越界：${uid}=${ex.c}`);
    }
    if (ex.v !== undefined && (!Array.isArray(ex.v) || ex.v.length !== 2 || !ex.v.every(Number.isFinite))) {
      throw new Error(`extras v 非法：${uid}=${JSON.stringify(ex.v)}`);
    }
    if (ex.m !== undefined && ex.m !== 1) throw new Error(`extras m 非法：${uid}=${ex.m}`);
  }
  console.log(`[check] extras 自检通过（${n} 条，含天狼/织女/北极/比邻抽样）`);
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
    // 自行 int16 编码域检查（0.5 mas/yr 单位）。
    if (!Number.isInteger(s.pmra) || Math.abs(s.pmra) > 32767) {
      throw new Error(`扩展层 pmra 编码越界：${s.pmra}`);
    }
    if (!Number.isInteger(s.pmdec) || Math.abs(s.pmdec) > 32767) {
      throw new Error(`扩展层 pmdec 编码越界：${s.pmdec}`);
    }
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

  const { coreStars, extStars, extras } = parseHyg(csvText);
  selfCheck(coreStars);
  selfCheckExt(extStars);
  selfCheckExtras(extras);

  // 按 mag 升序（亮 → 暗）。
  coreStars.sort((a, b) => a.mag - b.mag);
  extStars.sort((a, b) => a.mag - b.mag);

  // —— 核心层列式化（9C First Load 回收）：对象数组 → 并行列数组。——
  // 每星 ~14 个重复短键在 8896 行上即 ~600KB 纯键名；列式后 gzip 从 325KB 降到
  // ~211KB（实测 2026-07-15），这是「主页 First Load 回落 ≤600KB」的决定性一步。
  // 空值哨兵：dist 0=未知（真实距离不为 0）；字符串列 ''=无。u 不落盘——由
  // hip/hd/hr 按同一优先级规则派生（catalog.ts 解码端同规则，ETL/解码单一约定）。
  const payload = {
    meta: {
      source: 'HYG Database v41 (astronexus/HYG-Database)',
      sourceUrl,
      license: 'CC BY-SA 4.0',
      generatedAt: new Date().toISOString(),
      magLimit: MAG_CORE,
      count: coreStars.length,
      format: 'columnar-v1', // 消费端（catalog.ts/姊妹 ETL）识别列式格式
    },
    n: coreStars.length,
    cols: {
      ra: coreStars.map((s) => s.ra),
      dec: coreStars.map((s) => s.dec),
      mag: coreStars.map((s) => s.mag),
      dist: coreStars.map((s) => (s.dist === null ? 0 : s.dist)),
      spect: coreStars.map((s) => s.spect ?? ''),
      con: coreStars.map((s) => s.con ?? ''),
      bayer: coreStars.map((s) => s.bayer ?? ''),
      flam: coreStars.map((s) => s.flam ?? ''),
      proper: coreStars.map((s) => s.proper ?? ''),
      bf: coreStars.map((s) => s.bf ?? ''),
      hip: coreStars.map((s) => s.hip ?? ''),
      hd: coreStars.map((s) => s.hd ?? ''),
      hr: coreStars.map((s) => s.hr ?? ''),
    },
  };

  mkdirSync(dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(payload) + '\n');
  const bytes = readFileSync(OUT_JSON).byteLength;
  console.log(`[write] ${OUT_JSON} — ${coreStars.length} 颗（列式），${(bytes / 1024).toFixed(0)} KB`);

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
    // 自行两列（int16 语义，0.5 mas/yr 单位；解码 mas/yr = 值 × 0.5）。
    pmra: extStars.map((s) => s.pmra),
    pmdec: extStars.map((s) => s.pmdec),
  };
  mkdirSync(dirname(OUT_EXT_JSON), { recursive: true });
  writeFileSync(OUT_EXT_JSON, JSON.stringify(extPayload) + '\n');
  const extBytes = readFileSync(OUT_EXT_JSON).byteLength;
  console.log(`[write] ${OUT_EXT_JSON} — ${extStars.length} 颗，${(extBytes / 1024).toFixed(0)} KB`);

  // —— 增强层 star-extras.json（9C）：byUid 短键记录，loadStarExtras() 异步 chunk 消费。——
  // iauName（n 键）由 build-star-names.mjs 二次写入；本脚本重跑时从旧产物原样保留，
  // 避免「重跑星表 → 官方星名清零」的顺序陷阱（两脚本可任意顺序重跑）。
  let preservedIau = 0;
  if (existsSync(OUT_EXTRAS_JSON)) {
    try {
      const prev = JSON.parse(readFileSync(OUT_EXTRAS_JSON, 'utf8'));
      for (const [uid, ex] of Object.entries(prev?.byUid ?? {})) {
        if (ex && typeof ex.n === 'string' && ex.n) {
          if (!extras[uid]) extras[uid] = {};
          extras[uid].n = ex.n;
          preservedIau++;
        }
      }
    } catch {
      console.warn('[warn] 旧 star-extras.json 解析失败，iauName 保留跳过（可重跑 build-star-names 补回）');
    }
  }
  const extrasPayload = {
    meta: {
      source: 'HYG Database v41 (astronexus/HYG-Database)',
      sourceUrl,
      license: 'CC BY-SA 4.0',
      generatedAt: new Date().toISOString(),
      count: Object.keys(extras).length,
      fields: {
        p: 'pm [pmRa, pmDec] mas/yr（pmRa 含 cosδ，round 0.1）',
        c: 'ci B−V 色指数（round 0.01）',
        v: '变星幅度 [varMin(最暗), varMax(最亮)] 视星等（仅 HYG var 命名列非空）',
        m: '1 = 双星/聚星系统（base 非空 / comp≠1 / comp_primary 组成员>1）',
        n: 'IAU-CSN 官方星名（build-star-names.mjs 写入，CC BY 4.0 署名 IAU）',
      },
      iauNamePreserved: preservedIau,
    },
    byUid: extras,
  };
  writeFileSync(OUT_EXTRAS_JSON, JSON.stringify(extrasPayload) + '\n');
  const extrasBytes = readFileSync(OUT_EXTRAS_JSON).byteLength;
  console.log(
    `[write] ${OUT_EXTRAS_JSON} — ${Object.keys(extras).length} 条（保留 iauName ${preservedIau} 条），` +
      `${(extrasBytes / 1024).toFixed(0)} KB`,
  );
  console.log('完成。请更新 src/generated/README.md 的生成时间与行数。');
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
