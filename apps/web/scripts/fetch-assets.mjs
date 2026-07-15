// @ts-check
/**
 * 宇宙 V3 影像资产下载脚本（开发期手动执行，产物提交进仓库，不挂 turbo build 管线）。
 *
 * 下载三组资产到 apps/web/public/：
 *   milkyway — NASA SVS Deep Star Maps 2020 银河全景（赤道坐标 equirectangular，4k + 2k）
 *   dso      — 36 个著名 Messier 天体真实照片（Wikimedia Commons 缩图，PD / CC-BY / CC-BY-SA）
 *   planets  — 9 体行星/日月贴图 + 土星环（Solar System Scope，CC-BY-4.0）
 *
 * 并由同一清单（单一事实源）生成 public/credits.json 与 docs/credits.md，
 * 只登记当前磁盘上实际存在且校验通过的文件，登记不可能与实际文件漂移。
 *
 * 用法：
 *   node apps/web/scripts/fetch-assets.mjs [--force] [--only milkyway|dso|planets] [--dry-run]
 *
 * 执行环境注意（均经实测）：
 *   - curl 天然遵守 HTTPS_PROXY；NODE_EXTRA_CA_CERTS 存在时传 --cacert。
 *   - commons.wikimedia.org 经代理直连 OK（Special:FilePath 有 302 重定向链，需 -L）。
 *   - svs.gsfc.nasa.gov 本环境 TLS 证书过期（curl exit 60），绝不用作下载 URL，仅作来源出处登记。
 *   - Special:FilePath 的 ?width= 会被桶化（如请求 640 实际返回 960 宽），
 *     故以 magic bytes + 字节区间校验为准，实际像素仅解析告警。
 *   - solarsystemscope.com 偶发 202 + HTML 节流页，脚本按失败处理并重试。
 *
 * 零依赖：仅 Node 内置 + 系统 curl（模式沿用 packages/astro-data/scripts/etl-utils.mjs 先例，
 * 本地内联 helper 保持 web 自包含，不跨包 import）。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, '..');
const PUBLIC_DIR = join(WEB_ROOT, 'public');
const REPO_ROOT = resolve(WEB_ROOT, '..', '..');
const DOCS_DIR = join(REPO_ROOT, 'docs');

/** 二进制总预算（textures/** + dso-photos/** 合计），预留 1MB 余量于 20MB 红线。 */
const BUDGET_BYTES = 19 * 1024 * 1024;

// ---------------------------------------------------------------------------
// 资产清单（单一事实源：credits.json / docs/credits.md 全部字段由此派生）
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} AssetSpec
 * @property {string} out 相对 public/ 的落盘路径
 * @property {string} url 主下载 URL
 * @property {string[]} [fallbackUrls] 备选下载 URL（主 URL 失败时依序尝试）
 * @property {string} title 中文名称（credits 展示）
 * @property {string|null} objectUid 关联天体 uid（银河/行星贴图为 null 或 EPH- uid）
 * @property {string} author 作者/署名
 * @property {string} license 许可
 * @property {string} sourceUrl 来源出处页
 * @property {string} fileUrl 文件页/直链出处
 * @property {number} minBytes 校验下限（小于视为错误页）
 * @property {number} maxBytes 校验上限（超预算保护）
 * @property {'jpg'|'png'} magic 文件魔数类型
 */

/** Commons Special:FilePath 缩图 URL（文件名原样传入，此处统一编码）。 */
function commonsThumb(fileName, width) {
  const enc = encodeURIComponent(fileName);
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${enc}${width ? `?width=${width}` : ''}`;
}

/** Commons 文件页 URL。 */
function commonsPage(fileName) {
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(fileName.replace(/ /g, '_'))}`;
}

// —— A. 银河全景（NASA SVS Deep Star Maps 2020，celestial/赤道坐标版，RA=0h 居中、RA 向左增）——
const STARMAP_FILE = 'Deep Star Maps 2020 – Starmap 2020 64k.jpg';
const STARMAP_META = {
  author: 'NASA/GSFC Scientific Visualization Studio (Ernie Wright)；星表数据 Gaia DR2: ESA/Gaia/DPAC',
  license: 'Public Domain / NASA（要求署名 Gaia 数据来源）',
  sourceUrl: 'https://svs.gsfc.nasa.gov/4851',
  fileUrl: commonsPage(STARMAP_FILE),
};

/** @type {AssetSpec[]} */
const MILKYWAY_ASSETS = [
  {
    out: 'textures/milkyway/starmap-2020-4k.jpg',
    url: commonsThumb(STARMAP_FILE, 4096),
    title: 'Deep Star Maps 2020 银河全景 4k（天球赤道坐标）',
    objectUid: null,
    minBytes: 500 * 1024,
    maxBytes: 2.5 * 1024 * 1024,
    magic: 'jpg',
    ...STARMAP_META,
  },
  {
    // 注：Commons 桶化实测 ?width=2048/2000 都会返回 3840 宽大图，1920 才命中 1920×960 桶。
    out: 'textures/milkyway/starmap-2020-2k.jpg',
    url: commonsThumb(STARMAP_FILE, 1920),
    title: 'Deep Star Maps 2020 银河全景 2k（低配设备）',
    objectUid: null,
    minBytes: 120 * 1024,
    maxBytes: 1024 * 1024,
    magic: 'jpg',
    ...STARMAP_META,
  },
];

// —— B. DSO 真实照片（36 个 Messier，Commons 缩图 ≤800px，PD / CC-BY / CC-BY-SA，均逐文件署名）——
/**
 * @type {Array<{uid:string, zh:string, file:string, author:string, license:string}>}
 * 与 packages/astro-data 的 DSO_IMAGE_META 一一对应（uid → imageKey = uid 小写）。
 * Phase 10 扩容条目（M82…M15）均经 Commons imageinfo API 逐文件核验许可与作者；
 * 核验不过（改名/删除/非白名单许可）者脚本跳过，运行时该天体自动回落程序化艺术图，绝不编造署名。
 */
const DSO_PHOTOS = [
  { uid: 'M31', zh: '仙女座星系', file: 'Andromeda Galaxy (with h-alpha).jpg', author: 'Adam Evans', license: 'CC BY 2.0' },
  { uid: 'M33', zh: '三角座星系', file: 'VST snaps a very detailed view of the Triangulum Galaxy.jpg', author: 'ESO', license: 'CC BY 4.0' },
  { uid: 'M42', zh: '猎户座大星云', file: 'Orion Nebula - Hubble 2006 mosaic 18000.jpg', author: 'NASA, ESA, M. Robberto (STScI/ESA) & HST Orion Treasury Team', license: 'Public Domain' },
  { uid: 'M45', zh: '昴星团', file: 'Pleiades large.jpg', author: 'NASA, ESA, AURA/Caltech, Palomar Observatory', license: 'Public Domain' },
  { uid: 'M8', zh: '礁湖星云', file: 'VST images the Lagoon Nebula.jpg', author: 'ESO/VPHAS+ team', license: 'CC BY 4.0' },
  { uid: 'M16', zh: '鹰状星云', file: 'Eagle Nebula from ESO.jpg', author: 'ESO', license: 'CC BY 4.0' },
  { uid: 'M17', zh: '欧米伽星云', file: 'ESO-The Omega Nebula-phot-25a-09-fullres.jpg', author: 'ESO', license: 'CC BY 4.0' },
  { uid: 'M20', zh: '三叶星云', file: 'ESO-Trifid Nebula.jpg', author: 'ESO', license: 'CC BY 3.0' },
  { uid: 'M27', zh: '哑铃星云', file: 'M27, NGC 6853, Dumbbell Nebula (noao-02185).jpg', author: 'Bill Schoening/NOIRLab/NSF/AURA', license: 'CC BY 4.0' },
  { uid: 'M51', zh: '涡状星系', file: 'Messier51 sRGB.jpg', author: 'NASA & ESA (Hubble)', license: 'Public Domain' },
  { uid: 'M57', zh: '环状星云', file: 'M57 The Ring Nebula.JPG', author: 'Hubble Heritage Team (AURA/STScI/NASA)', license: 'Public Domain' },
  { uid: 'M13', zh: '武仙座大星团', file: 'Heart of M13 Hercules Globular Cluster.jpg', author: 'ESA/Hubble and NASA', license: 'Public Domain' },
  { uid: 'M81', zh: '波德星系', file: 'Messier 81 HST.jpg', author: 'NASA, ESA, Hubble Heritage Team', license: 'Public Domain' },
  { uid: 'M101', zh: '风车星系', file: 'M101 hires STScI-PRC2006-10a.jpg', author: 'ESA & NASA (Hubble)', license: 'CC BY 4.0' },
  { uid: 'M104', zh: '草帽星系', file: 'M104 ngc4594 sombrero galaxy hi-res.jpg', author: 'NASA/ESA & Hubble Heritage Team', license: 'Public Domain' },
  { uid: 'M1', zh: '蟹状星云', file: 'Crab Nebula.jpg', author: 'NASA, ESA, J. Hester & A. Loll (ASU)', license: 'Public Domain' },
  // —— Phase 10 扩容（16→36）：星系 ——
  { uid: 'M82', zh: '雪茄星系', file: 'M82 HST ACS 2006-14-a-large_web.jpg', author: 'NASA, ESA, Hubble Heritage Team (STScI/AURA)', license: 'Public Domain' },
  { uid: 'M63', zh: '葵花星系', file: 'M63 (NGC 5055).jpg', author: 'NASA/ESA, Hubble Legacy Archive (STScI)', license: 'Public Domain' },
  { uid: 'M64', zh: '黑眼星系', file: 'M64 (The Black Eye Galaxy) (noao-m64chadwell).jpg', author: 'KPNO/NOIRLab/NSF/AURA/B. Chadwell/F. Haase', license: 'CC BY 4.0' },
  { uid: 'M83', zh: '南风车星系', file: 'Messier83 - Heic1403a.jpg', author: 'NASA, ESA, Hubble Heritage Team (STScI/AURA)', license: 'Public Domain' },
  { uid: 'M94', zh: '猫眼星系', file: 'Starburst galaxy Messier 94.jpg', author: 'ESA/Hubble & NASA', license: 'CC BY 4.0' },
  { uid: 'M106', zh: '梅西耶106', file: 'Messier 106 visible and infrared composite.jpg', author: 'NASA, ESA, Hubble Heritage Team (STScI/AURA) & R. Gendler', license: 'Public Domain' },
  { uid: 'M74', zh: '幻影星系', file: 'Messier 74 by HST.jpg', author: 'NASA, ESA & Hubble Heritage (STScI/AURA)-ESA/Hubble', license: 'Public Domain' },
  { uid: 'M87', zh: '室女A星系', file: 'Messier 87 Hubble WikiSky.jpg', author: 'NASA, STScI, WikiSky', license: 'Public Domain' },
  { uid: 'M65', zh: '梅西耶65', file: 'Messier 65 through the years.jpg', author: 'ESA/Hubble & NASA', license: 'Public Domain' },
  { uid: 'M66', zh: '梅西耶66', file: 'Phot-33c-03-fullres.jpg', author: 'ESO', license: 'CC BY 4.0' },
  { uid: 'M77', zh: '梅西耶77', file: 'Messier 77 spiral galaxy by HST.jpg', author: 'NASA, ESA & A. van der Hoeven', license: 'Public Domain' },
  { uid: 'M108', zh: '梅西耶108', file: 'Messier108 - SDSS DR 14 (panorama).jpg', author: 'Sloan Digital Sky Survey', license: 'CC BY 4.0' },
  { uid: 'M109', zh: '梅西耶109', file: 'M109 (noao-m109hatfield).jpg', author: 'KPNO/NOIRLab/NSF/AURA/G. Hatfield & F. Haase', license: 'CC BY 4.0' },
  { uid: 'M110', zh: '梅西耶110', file: 'Not So Dead After All (48763200193).jpg', author: 'European Space Agency', license: 'CC BY 2.0' },
  // —— Phase 10 扩容（16→36）：星云 / 星团 ——
  { uid: 'M76', zh: '小哑铃星云', file: 'Messier 76 – The Little Dumbbell Nebula in Perseus.jpg', author: 'Tom Wildoner', license: 'CC BY-SA 4.0' },
  { uid: 'M97', zh: '夜枭星云', file: 'M97, NGC 3587 (noao-m97).jpg', author: 'NOIRLab/NSF/AURA', license: 'CC BY 4.0' },
  { uid: 'M78', zh: '梅西耶78', file: 'Messier 78.jpg', author: 'ESO/Igor Chekalin', license: 'CC BY 4.0' },
  { uid: 'M43', zh: '德梅兰星云', file: 'M43 HST.jpg', author: 'NASA, ESA, M. Robberto (STScI/ESA) & HST Orion Treasury Team', license: 'Public Domain' },
  { uid: 'M2', zh: '梅西耶2', file: 'Messier 2 Hubble WikiSky.jpg', author: 'NASA, STScI, WikiSky', license: 'Public Domain' },
  { uid: 'M15', zh: '梅西耶15', file: 'Messier 15 HST.jpg', author: 'ESA/Hubble & NASA', license: 'Public Domain' },
];

/** @type {AssetSpec[]} */
const DSO_ASSETS = DSO_PHOTOS.map((d) => ({
  out: `dso-photos/${d.uid.toLowerCase()}.jpg`,
  url: commonsThumb(d.file, 800),
  title: `${d.zh} ${d.uid}`,
  objectUid: d.uid,
  author: d.author,
  license: d.license,
  sourceUrl: commonsPage(d.file),
  fileUrl: commonsThumb(d.file, 800),
  minBytes: 20 * 1024,
  maxBytes: 800 * 1024,
  magic: 'jpg',
}));

// —— C. 行星/日月贴图（Solar System Scope 2k，CC-BY-4.0；备选 Commons 镜像同许可）——
const SSS_META = {
  author: 'Solar System Scope (INOVE)',
  license: 'CC-BY-4.0',
  sourceUrl: 'https://www.solarsystemscope.com/textures/',
};

/** SSS 主源 + Commons 镜像备选（同一素材、同一许可，命中哪个登记哪个均成立）。 */
function sssAsset(key, sssName, title, uid, opts = {}) {
  const mirror = `Solarsystemscope texture 2k ${sssName.replace(/_/g, ' ')}`;
  const ext = opts.png ? 'png' : 'jpg';
  return {
    out: `textures/planets/${key}.${ext}`,
    url: `https://www.solarsystemscope.com/textures/download/2k_${sssName}.${ext}`,
    fallbackUrls: [commonsThumb(`${mirror}.${ext}`, opts.png ? undefined : 2048)],
    title,
    objectUid: uid,
    minBytes: opts.minBytes ?? 50 * 1024,
    maxBytes: opts.maxBytes ?? 1.5 * 1024 * 1024,
    magic: ext,
    fileUrl: `https://www.solarsystemscope.com/textures/download/2k_${sssName}.${ext}`,
    ...SSS_META,
  };
}

/** @type {AssetSpec[]} */
const PLANET_ASSETS = [
  sssAsset('sun', 'sun', '太阳表面贴图 2k', 'EPH-SUN'),
  sssAsset('moon', 'moon', '月面贴图 2k', 'EPH-MOON'),
  sssAsset('mercury', 'mercury', '水星表面贴图 2k', 'EPH-MERCURY'),
  sssAsset('venus', 'venus_atmosphere', '金星大气贴图 2k', 'EPH-VENUS'),
  sssAsset('mars', 'mars', '火星表面贴图 2k', 'EPH-MARS'),
  sssAsset('jupiter', 'jupiter', '木星表面贴图 2k', 'EPH-JUPITER'),
  sssAsset('saturn', 'saturn', '土星表面贴图 2k', 'EPH-SATURN'),
  // 土星环：径向条带 alpha PNG，内容极稀疏故字节数很小（实测约 12KB）。
  sssAsset('saturn_ring', 'saturn_ring_alpha', '土星环贴图（带 alpha）', 'EPH-SATURN', {
    png: true,
    minBytes: 4 * 1024,
    maxBytes: 300 * 1024,
  }),
  sssAsset('uranus', 'uranus', '天王星贴图 2k', 'EPH-URANUS'),
  sssAsset('neptune', 'neptune', '海王星贴图 2k', 'EPH-NEPTUNE'),
];

export const ASSET_GROUPS = {
  milkyway: MILKYWAY_ASSETS,
  dso: DSO_ASSETS,
  planets: PLANET_ASSETS,
};

/** 数据来源（固定登记，credits.json 的 dataSources 段）。 */
const DATA_SOURCES = [
  { title: 'HYG v4.1 星表', license: 'CC BY-SA 4.0（数据）', url: 'https://github.com/astronexus/HYG-Database' },
  { title: 'OpenNGC 深空天体目录', license: 'CC BY-SA 4.0（数据）', url: 'https://github.com/mattiaverga/OpenNGC' },
  { title: 'astronomy-engine 天文历表', license: 'MIT', url: 'https://github.com/cosinekitty/astronomy' },
];

// ---------------------------------------------------------------------------
// 下载与校验工具
// ---------------------------------------------------------------------------

/**
 * 用 curl 下载单个 URL 到临时文件。curl 天然遵守 HTTPS_PROXY；
 * NODE_EXTRA_CA_CERTS 存在时传 --cacert（etl-utils.mjs 先例，本地内联保持 web 自包含）。
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
function curlDownload(url, tmpPath) {
  const args = ['-sSL', '--max-time', '180', '--retry', '2', '-o', tmpPath, '-w', '%{http_code}'];
  const caBundle = process.env.NODE_EXTRA_CA_CERTS;
  if (caBundle && existsSync(caBundle)) args.push('--cacert', caBundle);
  args.push(url);
  const r = spawnSync('curl', args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (r.status !== 0) return { ok: false, reason: `curl 退出码 ${r.status}：${(r.stderr || '').trim()}` };
  const httpCode = (r.stdout || '').trim();
  if (httpCode && !httpCode.startsWith('2')) return { ok: false, reason: `HTTP ${httpCode}` };
  // 注：solarsystemscope 偶发 202 + HTML 节流页，交由 magic bytes 校验拦截。
  if (!existsSync(tmpPath)) return { ok: false, reason: '无输出文件' };
  return { ok: true };
}

const MAGIC = {
  jpg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47],
};

/** 校验 magic bytes（天然拦截 HTML 错误页/节流页）。 */
function checkMagic(buf, kind) {
  const m = MAGIC[kind];
  if (buf.length < m.length) return false;
  return m.every((b, i) => buf[i] === b);
}

/** 解析 JPEG SOF0/SOF1/SOF2 尺寸；失败返回 null（仅用于告警展示，不判失败）。 */
function jpegSize(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; }
    // 无长度段的 marker
    if (marker >= 0xd0 && marker <= 0xd9) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

/** 解析 PNG IHDR 尺寸。 */
function pngSize(buf) {
  if (buf.length < 24) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/**
 * 校验落盘文件是否可信：magic bytes + 字节区间。
 * @returns {{ok:boolean, reason?:string, size:number, dims:{w:number,h:number}|null}}
 */
function validateFile(path, spec) {
  const buf = readFileSync(path);
  const size = buf.length;
  if (!checkMagic(buf, spec.magic)) {
    return { ok: false, reason: `magic bytes 非 ${spec.magic}（疑似 HTML 错误页/节流页）`, size, dims: null };
  }
  const dims = spec.magic === 'jpg' ? jpegSize(buf) : pngSize(buf);
  if (size < spec.minBytes) return { ok: false, reason: `仅 ${fmtBytes(size)} < 下限 ${fmtBytes(spec.minBytes)}`, size, dims };
  if (size > spec.maxBytes) return { ok: false, reason: `${fmtBytes(size)} > 上限 ${fmtBytes(spec.maxBytes)}（超预算保护）`, size, dims };
  return { ok: true, size, dims };
}

function fmtBytes(n) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)}MB`;
  return `${(n / 1024).toFixed(0)}KB`;
}

// ---------------------------------------------------------------------------
// credits 生成（仅登记磁盘上实际存在且校验通过的文件）
// ---------------------------------------------------------------------------

const GROUP_LABEL = { milkyway: '银河底图', dso: '深空影像', planets: '行星贴图' };

function collectVerifiedAssets() {
  /** @type {Array<AssetSpec & {group:string, actualBytes:number, actualUrl?:string}>} */
  const verified = [];
  for (const [group, specs] of Object.entries(ASSET_GROUPS)) {
    for (const spec of specs) {
      const path = join(PUBLIC_DIR, spec.out);
      if (!existsSync(path)) continue;
      const v = validateFile(path, spec);
      if (!v.ok) continue;
      verified.push({ ...spec, group, actualBytes: v.size });
    }
  }
  return verified;
}

function writeCredits(verified) {
  const credits = {
    generatedAt: new Date().toISOString(),
    note: '本页登记站内使用的全部第三方影像与数据来源。星辰纪念为私人纪念服务，与 IAU 及任何官方命名机构无关。部分小角径深空天体的显示尺寸经放大以保证可见性。',
    assets: verified.map((a) => ({
      file: a.out,
      group: GROUP_LABEL[a.group] ?? a.group,
      title: a.title,
      objectUid: a.objectUid,
      author: a.author,
      license: a.license,
      sourceUrl: a.sourceUrl,
      fileUrl: a.fileUrl,
    })),
    dataSources: DATA_SOURCES,
  };
  const creditsPath = join(PUBLIC_DIR, 'credits.json');
  writeFileSync(creditsPath, JSON.stringify(credits, null, 2) + '\n', 'utf8');
  console.log(`✓ 已生成 ${creditsPath}（${verified.length} 条影像登记）`);

  // docs/credits.md（同源生成）
  const lines = [
    '# 影像与数据来源（致谢）',
    '',
    '> 本文件由 `apps/web/scripts/fetch-assets.mjs` 自动生成，与 `apps/web/public/credits.json` 同源。',
    '> 手工修改会在下次运行脚本时被覆盖，请改脚本内清单。',
    '',
    '星辰纪念为私人纪念服务，与 IAU 及任何官方命名机构无关。以下登记站内使用的全部第三方影像素材',
    '（仅采用 Public Domain 或 CC-BY 许可，CC-BY 素材已按要求署名）与开放数据来源。',
    '',
    `生成时间：${credits.generatedAt}`,
    '',
  ];
  for (const [group, label] of Object.entries(GROUP_LABEL)) {
    const items = verified.filter((a) => a.group === group);
    if (items.length === 0) continue;
    lines.push(`## ${label}`, '');
    lines.push('| 文件 | 名称 | 作者/署名 | 许可 | 来源 | 直链 |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const a of items) {
      lines.push(
        // 注：sourceUrl/fileUrl 在清单里已是编码完成的合法 URL，此处不可再 encodeURI（会二次编码 %20→%2520）。
        `| \`${a.out}\` | ${a.title} | ${a.author.replace(/\|/g, '\\|')} | ${a.license} | [来源页](${a.sourceUrl}) | [文件](${a.fileUrl}) |`,
      );
    }
    lines.push('');
  }
  lines.push('## 数据来源', '');
  lines.push('| 名称 | 许可 | 地址 |');
  lines.push('| --- | --- | --- |');
  for (const d of DATA_SOURCES) lines.push(`| ${d.title} | ${d.license} | ${d.url} |`);
  lines.push('');
  lines.push('## 展示口径注记', '');
  lines.push('- 小角径深空天体（如 M57 环状星云，真实角径仅约 1.3′）按真实尺寸渲染将不可见，站内显示尺寸经放大（0.6–1.0°），大角径天体（M31/M45 等）按真实角尺寸摆放。');
  lines.push('- 银河全景为 NASA SVS Deep Star Maps 2020 的天球赤道坐标版本，内含 Gaia DR2 星表渲染的微星场。');
  lines.push('- 行星贴图来自 Solar System Scope（CC-BY-4.0），部分为艺术加工的可视化贴图（如金星取大气层版本）。');
  lines.push('');
  const mdPath = join(DOCS_DIR, 'credits.md');
  writeFileSync(mdPath, lines.join('\n'), 'utf8');
  console.log(`✓ 已生成 ${mdPath}`);
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const dryRun = argv.includes('--dry-run');
  const onlyIdx = argv.indexOf('--only');
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : null;
  if (only && !ASSET_GROUPS[only]) {
    console.error(`--only 取值必须是 ${Object.keys(ASSET_GROUPS).join('|')}，收到：${only}`);
    process.exit(1);
  }

  const groups = only ? { [only]: ASSET_GROUPS[only] } : ASSET_GROUPS;
  const allSpecs = Object.entries(groups).flatMap(([g, specs]) => specs.map((s) => ({ ...s, group: g })));

  if (dryRun) {
    console.log(`— dry-run：${allSpecs.length} 个资产 —`);
    let est = 0;
    for (const s of allSpecs) {
      const path = join(PUBLIC_DIR, s.out);
      const onDisk = existsSync(path) ? statSync(path).size : 0;
      est += onDisk || s.maxBytes;
      console.log(`  ${s.out}  [${s.group}]  ${onDisk ? `已存在 ${fmtBytes(onDisk)}` : `预估上限 ${fmtBytes(s.maxBytes)}`}`);
      console.log(`    ← ${s.url}`);
    }
    console.log(`预算：实存/上限合计 ${fmtBytes(est)}（红线 ${fmtBytes(BUDGET_BYTES)}）`);
    return;
  }

  /** @type {Array<{out:string, reason:string}>} */
  const failures = [];
  let downloaded = 0;
  let skipped = 0;

  for (const spec of allSpecs) {
    const outPath = join(PUBLIC_DIR, spec.out);
    mkdirSync(dirname(outPath), { recursive: true });

    // 幂等：已存在且校验通过 → skip
    if (!force && existsSync(outPath)) {
      const v = validateFile(outPath, spec);
      if (v.ok) {
        console.log(`✓ 已存在 ${spec.out}（${fmtBytes(v.size)}${v.dims ? `，${v.dims.w}×${v.dims.h}` : ''}）`);
        skipped++;
        continue;
      }
      console.log(`! 已存在但校验失败（${v.reason}），重新下载 ${spec.out}`);
    }

    const urls = [spec.url, ...(spec.fallbackUrls ?? [])];
    const tmpPath = outPath + '.tmp';
    let done = false;
    let lastReason = '';
    for (const url of urls) {
      const isFallback = url !== spec.url;
      console.log(`↓ 下载 ${spec.out}${isFallback ? '（备选源）' : ''}`);
      console.log(`  ← ${url}`);
      const dl = curlDownload(url, tmpPath);
      if (!dl.ok) {
        lastReason = dl.reason;
        console.log(`  → 失败：${dl.reason}`);
        rmSync(tmpPath, { force: true });
        continue;
      }
      const v = validateFile(tmpPath, spec);
      if (!v.ok) {
        lastReason = v.reason ?? '校验失败';
        console.log(`  → 校验失败：${v.reason}`);
        rmSync(tmpPath, { force: true });
        continue;
      }
      renameSync(tmpPath, outPath);
      const dimStr = v.dims ? `，${v.dims.w}×${v.dims.h}` : '';
      console.log(`  ✓ 完成（${fmtBytes(v.size)}${dimStr}）`);
      // Commons ?width= 桶化：实际像素超 2200 长边仅告警（提示换更小 width 重跑），不判失败。
      if (v.dims && Math.max(v.dims.w, v.dims.h) > 2200 && !spec.out.includes('starmap-2020-4k')) {
        console.log(`  ! 警告：实际长边 ${Math.max(v.dims.w, v.dims.h)}px 偏大，可考虑更小 width 重跑`);
      }
      downloaded++;
      done = true;
      break;
    }
    if (!done) {
      failures.push({ out: spec.out, reason: lastReason || '全部候选 URL 失败' });
      console.log(`✗ 放弃 ${spec.out}（运行时该项降级为程序化视觉，不阻塞构建）`);
    }
  }

  // —— 预算守门（统计全部资产目录实际字节，与 --only 无关，守的是总红线）——
  let total = 0;
  /** @type {Array<{out:string, size:number}>} */
  const report = [];
  for (const specs of Object.values(ASSET_GROUPS)) {
    for (const spec of specs) {
      const p = join(PUBLIC_DIR, spec.out);
      if (!existsSync(p)) continue;
      const size = statSync(p).size;
      total += size;
      report.push({ out: spec.out, size });
    }
  }

  console.log('\n—— 资产总量报表 ——');
  for (const r of report.sort((a, b) => b.size - a.size)) {
    console.log(`  ${fmtBytes(r.size).padStart(9)}  ${r.out}`);
  }
  console.log(`  合计 ${fmtBytes(total)} / 预算 ${fmtBytes(BUDGET_BYTES)}`);

  if (total > BUDGET_BYTES) {
    console.error('\n✗ 二进制总量超预算！请更换更小分辨率来源后重跑。');
    process.exit(1);
  }

  // —— 生成 credits（仅登记实际存在且校验通过的文件）——
  const verified = collectVerifiedAssets();
  writeCredits(verified);

  // —— 汇总 ——
  console.log(`\n—— 完成：下载 ${downloaded}，跳过（已存在）${skipped}，失败 ${failures.length} ——`);
  if (failures.length > 0) {
    console.log('WARN 以下资产下载失败（运行时各层已有降级，绝不阻塞构建）：');
    for (const f of failures) console.log(`  ✗ ${f.out}：${f.reason}`);
  }
  if (downloaded + skipped === 0) {
    console.error('✗ 清单全灭（没有任何资产可用）');
    process.exit(1);
  }
}

main();
