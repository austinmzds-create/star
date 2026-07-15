/** 展示层格式化：度数、方向、赤经赤纬、日期、星等。纯函数。 */

/** 保留整数度（用于引导角、方位角显示）。 */
export function degInt(deg: number): number {
  return Math.round(deg);
}

/** 度数带 ° 号，可指定小数位。 */
export function degText(deg: number, digits = 0): string {
  return `${deg.toFixed(digits)}°`;
}

/** 赤经（度）→ 时分秒文本，如 06h45m09s。 */
export function raToHms(raDeg: number): string {
  const totalHours = ((raDeg % 360) + 360) % 360 / 15;
  const h = Math.floor(totalHours);
  const mFloat = (totalHours - h) * 60;
  const m = Math.floor(mFloat);
  const s = Math.round((mFloat - m) * 60);
  // 处理进位
  let hh = h;
  let mm = m;
  let ss = s;
  if (ss === 60) {
    ss = 0;
    mm += 1;
  }
  if (mm === 60) {
    mm = 0;
    hh = (hh + 1) % 24;
  }
  return `${pad2(hh)}h${pad2(mm)}m${pad2(ss)}s`;
}

/** 赤纬（度）→ 度分秒文本，如 -16°43'。 */
export function decToDms(decDeg: number): string {
  const sign = decDeg < 0 ? '-' : '+';
  const abs = Math.abs(decDeg);
  const d = Math.floor(abs);
  const m = Math.round((abs - d) * 60);
  let dd = d;
  let mm = m;
  if (mm === 60) {
    mm = 0;
    dd += 1;
  }
  return `${sign}${dd}°${pad2(mm)}'`;
}

/** 赤经赤纬合并文本，用于星卡片。 */
export function raDecText(raDeg: number, decDeg: number): string {
  return `赤经 ${raToHms(raDeg)} · 赤纬 ${decToDms(decDeg)}`;
}

/** 星等文本（越小越亮）。 */
export function magnitudeText(mag: number): string {
  return `视星等 ${mag.toFixed(2)}`;
}

/** Date → HH:mm（本地时间）。 */
export function hhmm(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** ISO 日期字符串 → 友好中文，如 2026年7月11日。空返回空串。 */
export function dateZh(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
