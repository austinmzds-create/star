// @ts-check
/**
 * ETL 公共工具：curl 下载（走 HTTPS_PROXY）、CSV 行解析、数值取整。
 * 供 build-catalog.mjs / build-dso.mjs / build-constellation-lines.mjs 复用。
 * 零新增依赖：仅 Node 内置 + 系统 curl。
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

/** 四舍五入到 n 位小数。 */
export function round(x, n) {
  const f = 10 ** n;
  return Math.round(x * f) / f;
}

/**
 * 解析一行 CSV → string[]。处理双引号包裹与转义双引号 ""。
 * @param {string} line
 * @param {string} [delim=','] 分隔符（OpenNGC 用 ';'）。
 */
export function parseCsvLine(line, delim = ',') {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === delim) { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * 用 curl 下载单个 URL 到临时文件，返回 Buffer 或 null（失败）。
 * curl 天然遵守 HTTPS_PROXY / https_proxy；NODE_EXTRA_CA_CERTS 会传给 --cacert。
 * @param {string} url
 * @param {string} tmpPath
 * @param {number} [minBytes=1000] 小于该字节数视为错误页，判失败。
 */
export function curlDownload(url, tmpPath, minBytes = 1000) {
  const args = ['-sSL', '--max-time', '120', '-o', tmpPath, '-w', '%{http_code}'];
  const caBundle = process.env.NODE_EXTRA_CA_CERTS;
  if (caBundle && existsSync(caBundle)) args.push('--cacert', caBundle);
  args.push(url);
  const r = spawnSync('curl', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (r.status !== 0) {
    console.log(`  → curl 退出码 ${r.status}：${(r.stderr || '').trim()}`);
    return null;
  }
  const httpCode = (r.stdout || '').trim();
  if (httpCode && !httpCode.startsWith('2')) {
    console.log(`  → HTTP ${httpCode}，跳过`);
    return null;
  }
  if (!existsSync(tmpPath)) return null;
  const buf = readFileSync(tmpPath);
  if (buf.byteLength < minBytes) {
    console.log(`  → 仅 ${buf.byteLength} 字节（疑似错误页），跳过`);
    return null;
  }
  return buf;
}
