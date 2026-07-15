// @ts-check
/**
 * 离线 ETL 脚本（Phase 9C 公信力数据）：IAU-CSN 官方星名入库。
 *
 * 数据源：IAU Division C · Working Group on Star Names（WGSN）
 *   《IAU Catalog of Star Names（IAU-CSN）》——恒星专名的唯一官方来源。
 *   主源：https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt（WGSN 秘书 E. Mamajek 维护）
 *   备源：mirandadam/iau-starnames 的逐字镜像（GitHub raw，路径 2026-07-15 实测 200）
 *   两源同为原始 IAU-CSN.txt 定宽文本，共用同一解析器；全部失败则【非零退出】，
 *   绝不编造星名（合规红线：ETL 失败不产出假数据）。
 *
 * 许可（逐字记录）：IAU 官网内容统一 CC BY 4.0 ——
 *   “All IAU-produced products (Images, Videos, Texts) are released under Creative
 *    Commons Attribution (i.e. free to use in all perpetuity, world-wide, as long
 *    as the source is mentioned).”（IAU-CSN.txt 文件头原文）
 *   展示侧署名：「官方星名来自 IAU Catalog of Star Names（IAU WGSN，CC BY 4.0）」。
 *
 * 产出：
 *   1. 就地更新 src/generated/star-extras.json：按 HIP join 我们目录 uid（'HIP'+hip），
 *      命中条目写入 n 键（iauName，取带变音符版本 Name/Diacritics，UTF-8）。
 *      依赖 build-catalog.mjs 先产出 star-extras.json（无则非零退出）。
 *   2. src/generated/iau-csn-meta.json：版本（文件头 Last updated）、批准日期范围、
 *      条数、join 命中数、retrievedAt——数据来源页 / data_source 溯源表的单一事实源。
 *
 * 解析（定宽 + 尾部正则混合，2026-07-15 实读文件核实格式）：
 *   - 注释行以 '#' 开头；文件头有一行以 '$' 开头的续行（源文件笔误），一并跳过。
 *   - Name/ASCII 为第 0-17 列、Name/Diacritics 第 18-35 列（含多词名如 Polaris Australis）。
 *   - 行尾以正则捕获 …mag bnd HIP HD RA Dec Date [notes]：HIP/HD 为数字或 '_'。
 *
 * 用法：
 *   node scripts/build-star-names.mjs            下载并生成
 *   node scripts/build-star-names.mjs --offline  读取本地缓存 .cache/IAU-CSN.txt
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { curlDownload } from './etl-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const CACHE_DIR = resolve(__dirname, '.cache');
const CACHE_TXT = resolve(CACHE_DIR, 'IAU-CSN.txt');
const EXTRAS_JSON = resolve(PKG_ROOT, 'src/generated/star-extras.json');
const OUT_META_JSON = resolve(PKG_ROOT, 'src/generated/iau-csn-meta.json');

const CSN_URLS = [
  // 主源：WGSN 官方文本（pas.rochester.edu，2026-07-15 实测可达，454 条）
  'https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt',
  // 备源：mirandadam/iau-starnames 镜像（同一 .txt，2026-07-15 实测 200）
  'https://raw.githubusercontent.com/mirandadam/iau-starnames/master/catalog_data/IAU-CSN.txt',
  // 备源 2：cyschneck/iau-star-names 仓库亦维护同文件镜像（路径未实测，最后兜底）
  'https://raw.githubusercontent.com/cyschneck/iau-star-names/main/data/IAU-CSN.txt',
];

/** 依次尝试下载 IAU-CSN.txt，第一个成功即止。返回 { text, url } 或 null。 */
function downloadCsn() {
  mkdirSync(CACHE_DIR, { recursive: true });
  const tmpPath = resolve(CACHE_DIR, '.csn-download.tmp');
  for (const url of CSN_URLS) {
    console.log(`[download] 尝试 ${url}`);
    const buf = curlDownload(url, tmpPath, 30_000); // 全量文件 ~70KB，30KB 下限防错误页
    if (!buf) continue;
    const text = buf.toString('utf8');
    // 内容嗅探：必须像 IAU-CSN（标题行 + Vega 行），防镜像路径被换成别的东西
    if (!text.includes('IAU Catalog of Star Names') || !text.includes('Vega')) {
      console.log('  → 内容不符（缺标题/Vega），跳过');
      continue;
    }
    console.log(`  → 成功，${(buf.byteLength / 1024).toFixed(0)} KB`);
    return { text, url };
  }
  return null;
}

/**
 * 解析 IAU-CSN.txt → { rows, lastUpdated }。
 * row = { nameAscii, name, hip, hd, raDeg, decDeg, dateApproved }。
 * @param {string} text
 */
function parseCsn(text) {
  const lines = text.split(/\r?\n/);
  /** @type {{ nameAscii: string; name: string; hip: string|null; hd: string|null; raDeg: number; decDeg: number; dateApproved: string }[]} */
  const rows = [];
  let lastUpdated = null;
  // 行尾结构：mag bnd HIP HD RA Dec Date [notes]（HIP/HD 为数字或 '_'；
  // 脉冲星条目 Geminga/Lich 的 mag 与 bnd 也是 '_'，2026-07-15 实读核实）
  const tailRe =
    /\s([\d.+-]+|_)\s+([A-Za-z_])\s+(\d+|_)\s+(\d+|_)\s+([-+]?\d+\.\d+)\s+([-+]?\d+\.\d+)\s+(\d{4}-\d{2}-\d{2})\s*\*?\s*$/;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith('#') || line.startsWith('$')) {
      const m = line.match(/Last updated (\d{4}-\d{2}-\d{2})/);
      if (m) lastUpdated = m[1];
      continue;
    }
    const tm = line.match(tailRe);
    if (!tm) {
      // 数据行必须可解析；打印后计为格式异常（结尾统一校验行数下限）
      console.warn(`[warn] 无法解析的行（已跳过）：${line.slice(0, 60)}…`);
      continue;
    }
    const nameAscii = line.slice(0, 18).trim();
    const name = line.slice(18, 36).trim() || nameAscii;
    if (!nameAscii) continue;
    const hip = tm[3] === '_' ? null : tm[3];
    const hd = tm[4] === '_' ? null : tm[4];
    const raDeg = parseFloat(tm[5]);
    const decDeg = parseFloat(tm[6]);
    if (!Number.isFinite(raDeg) || raDeg < 0 || raDeg >= 360 || !Number.isFinite(decDeg) || Math.abs(decDeg) > 90) {
      throw new Error(`IAU-CSN 坐标越界：${nameAscii} ra=${raDeg} dec=${decDeg}`);
    }
    rows.push({ nameAscii, name, hip, hd, raDeg, decDeg, dateApproved: tm[7] });
  }
  return { rows, lastUpdated };
}

/**
 * 抽样断言（合规纪律：先实读文件核对，再写死期望——以下三条 2026-07-15 对照
 * pas.rochester.edu 原文核实：Vega=HIP91262、Sirius=HIP32349、Polaris=HIP11767）。
 * 断言的是「解析结果与文件内容一致」：名字逐字符精确匹配。
 */
function selfCheck(rows) {
  if (rows.length < 400) {
    throw new Error(`IAU-CSN 解析仅 ${rows.length} 条（应 ≥400，2022-04 版本为 454 条），疑似解析崩坏`);
  }
  const byHip = new Map(rows.filter((r) => r.hip).map((r) => [r.hip, r]));
  const anchors = [
    { hip: '91262', name: 'Vega' },
    { hip: '32349', name: 'Sirius' },
    { hip: '11767', name: 'Polaris' },
  ];
  for (const a of anchors) {
    const row = byHip.get(a.hip);
    if (!row || row.name !== a.name || row.nameAscii !== a.name) {
      throw new Error(`抽样失败：HIP${a.hip} 期望名 '${a.name}'，实得 ${JSON.stringify(row)}`);
    }
  }
  // 名字唯一性（IAU 星名唯一；同名重复说明解析串列）
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.nameAscii)) throw new Error(`IAU-CSN 星名重复：${r.nameAscii}（疑似解析串列）`);
    seen.add(r.nameAscii);
  }
  console.log(`[check] IAU-CSN 解析自检通过（${rows.length} 条，Vega/Sirius/Polaris 抽样精确匹配）`);
}

function main() {
  const offline = process.argv.includes('--offline');
  let text;
  let sourceUrl = CSN_URLS[0];

  if (offline) {
    if (!existsSync(CACHE_TXT)) {
      console.error(`[offline] 未找到缓存 ${CACHE_TXT}`);
      process.exit(1);
    }
    console.log(`[offline] 读取缓存 ${CACHE_TXT}`);
    text = readFileSync(CACHE_TXT, 'utf8');
  } else {
    const dl = downloadCsn();
    if (!dl) {
      console.error('==========================================================');
      console.error('[error] IAU-CSN 全部数据源下载失败。绝不编造星名，不写任何产物。');
      console.error(`可手动下载 ${CSN_URLS[0]} 保存到 ${CACHE_TXT} 后运行 --offline。`);
      console.error('==========================================================');
      process.exit(2);
    }
    text = dl.text;
    sourceUrl = dl.url;
    writeFileSync(CACHE_TXT, text);
    console.log(`[cache] 已缓存到 ${CACHE_TXT}`);
  }

  const { rows, lastUpdated } = parseCsn(text);
  selfCheck(rows);

  // —— HIP join star-extras.json（build-catalog.mjs 的产物是宿主，无则先跑它）——
  if (!existsSync(EXTRAS_JSON)) {
    console.error(`[error] 未找到 ${EXTRAS_JSON}，请先运行 build-catalog.mjs`);
    process.exit(3);
  }
  const extrasPayload = JSON.parse(readFileSync(EXTRAS_JSON, 'utf8'));
  const byUid = extrasPayload?.byUid;
  if (!byUid || typeof byUid !== 'object') {
    console.error('[error] star-extras.json 结构异常（缺 byUid）');
    process.exit(3);
  }

  // 先清空旧 n 键（幂等重跑：上游删名/改名不留幽灵）
  for (const ex of Object.values(byUid)) {
    if (ex && typeof ex === 'object') delete ex.n;
  }
  let matched = 0;
  let unmatchedHip = 0;
  let noHip = 0;
  for (const r of rows) {
    if (!r.hip) { noHip++; continue; } // 系外行星宿主等无 HIP 条目：目录外，跳过
    const uid = 'HIP' + r.hip;
    const ex = byUid[uid];
    if (ex) {
      ex.n = r.name;
      matched++;
    } else {
      unmatchedHip++; // 有 HIP 但暗于核心层阈值（不在 extras 覆盖内），正常
    }
  }
  // join 命中断言：596/454 条官方名多为亮星，核心层（mag≤6.5）应命中大半
  if (matched < 300) {
    throw new Error(`IAU-CSN join 仅命中 ${matched} 条（应 ≥300），疑似 uid 规则不一致`);
  }
  // 抽样：三大锚点必须落入 extras
  for (const [uid, name] of [['HIP91262', 'Vega'], ['HIP32349', 'Sirius'], ['HIP11767', 'Polaris']]) {
    if (byUid[uid]?.n !== name) {
      throw new Error(`join 抽样失败：${uid} 应为 '${name}'，实得 '${byUid[uid]?.n}'`);
    }
  }

  extrasPayload.meta = {
    ...extrasPayload.meta,
    iauCsn: {
      source: 'IAU Catalog of Star Names (IAU-CSN), IAU WGSN',
      sourceUrl,
      license: 'CC BY 4.0（署名 IAU）',
      lastUpdated,
      matched,
      mergedAt: new Date().toISOString(),
    },
  };
  writeFileSync(EXTRAS_JSON, JSON.stringify(extrasPayload) + '\n');
  console.log(`[write] ${EXTRAS_JSON} — 写入 iauName ${matched} 条（CSN 无 HIP ${noHip} 条、HIP 超出覆盖 ${unmatchedHip} 条）`);

  // —— iau-csn-meta.json：溯源单一事实源（data_source 表 / 数据来源页直接消费）——
  const dates = rows.map((r) => r.dateApproved).sort();
  const meta = {
    code: `iau-csn-${(lastUpdated ?? 'unknown').replaceAll('-', '')}`,
    name: 'IAU Catalog of Star Names (IAU-CSN)',
    publisher: 'IAU Division C Working Group on Star Names (WGSN)',
    version: lastUpdated ? `Last updated ${lastUpdated}` : 'unknown',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    citationText:
      '官方星名来自 IAU Catalog of Star Names（IAU Working Group on Star Names，CC BY 4.0，署名 IAU）。' +
      '本服务的纪念命名为私人象征性纪念，非 IAU 官方命名；恒星唯一官方专名体系见 IAU-CSN。',
    homepageUrl: 'https://www.iau.org/public/themes/naming_stars/',
    downloadUrl: sourceUrl,
    retrievedAt: new Date().toISOString(),
    recordCount: rows.length,
    matchedCount: matched,
    approvalDateRange: [dates[0], dates[dates.length - 1]],
    refreshPolicy: 'static-build',
  };
  writeFileSync(OUT_META_JSON, JSON.stringify(meta, null, 2) + '\n');
  console.log(`[write] ${OUT_META_JSON} — ${rows.length} 条官方名，批准日期 ${dates[0]} ~ ${dates[dates.length - 1]}`);
  console.log('完成。请更新 src/generated/README.md。');
}

main();
