/** 赤经（度）-> 时分秒，如 "6h45m09s"。 */
export function formatRA(raDeg: number): string {
  const hoursTotal = (((raDeg % 360) + 360) % 360) / 15;
  const h = Math.floor(hoursTotal);
  const mTotal = (hoursTotal - h) * 60;
  const m = Math.floor(mTotal);
  const s = Math.round((mTotal - m) * 60);
  const mm = s === 60 ? m + 1 : m;
  const ss = s === 60 ? 0 : s;
  return `${h}h${String(mm).padStart(2, '0')}m${String(ss).padStart(2, '0')}s`;
}

/** 赤纬（度）-> 度分，如 "-16°43′"。 */
export function formatDec(decDeg: number): string {
  const sign = decDeg < 0 ? '-' : '+';
  const abs = Math.abs(decDeg);
  const d = Math.floor(abs);
  const m = Math.round((abs - d) * 60);
  const mm = m === 60 ? 0 : m;
  const dd = m === 60 ? d + 1 : d;
  return `${sign}${dd}°${String(mm).padStart(2, '0')}′`;
}

/** 距离（光年）-> 友好文本。 */
export function formatDistance(distanceLy: number | null): string {
  if (distanceLy == null) return '未知';
  if (distanceLy < 100) return `${distanceLy.toFixed(1)} 光年`;
  return `${Math.round(distanceLy).toLocaleString('zh-CN')} 光年`;
}

/** ISO 日期串 -> 中文日期，如 "2026年7月10日"；解析失败原样返回。 */
export function formatDateZh(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Shanghai',
  }).format(date);
}

/** 高度角/方位角格式化。 */
export function formatDegrees(deg: number): string {
  return `${deg.toFixed(1)}°`;
}

/** 以北京时间显示时刻（HH:mm）。 */
export function formatBeijingTime(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  }).format(date);
}
