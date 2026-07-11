/** 坐标/场景/日期格式化。纯函数。 */

/** RA 度 → 'HHh MMm SS.Ss'。raDeg∈[0,360) ÷15 = 小时。 */
export function formatRa(raDeg: number): string {
  // 归一化到 [0,360)
  let deg = raDeg % 360;
  if (deg < 0) deg += 360;
  const hoursTotal = deg / 15;
  const hh = Math.floor(hoursTotal);
  const minTotal = (hoursTotal - hh) * 60;
  const mm = Math.floor(minTotal);
  const ss = (minTotal - mm) * 60;
  return `${pad2(hh)}h ${pad2(mm)}m ${padSeconds(ss)}s`;
}

/** Dec 度 → '±DD° MM′ SS″'。 */
export function formatDec(decDeg: number): string {
  const sign = decDeg < 0 ? '-' : '+';
  const abs = Math.abs(decDeg);
  const dd = Math.floor(abs);
  const minTotal = (abs - dd) * 60;
  const mm = Math.floor(minTotal);
  const ss = Math.round((minTotal - mm) * 60);
  // 秒进位处理
  let dd2 = dd;
  let mm2 = mm;
  let ss2 = ss;
  if (ss2 >= 60) {
    ss2 -= 60;
    mm2 += 1;
  }
  if (mm2 >= 60) {
    mm2 -= 60;
    dd2 += 1;
  }
  return `${sign}${dd2}° ${pad2(mm2)}′ ${pad2(ss2)}″`;
}

/** OccasionType 码 → 中文标签（复用与 web 一致的码表）。 */
export const OCCASION_ZH: Record<string, string> = {
  LOVE: '情侣纪念',
  BIRTHDAY: '生日',
  WEDDING: '婚礼',
  GRADUATION: '毕业',
  NEWBORN: '宝宝出生',
  PET_MEMORIAL: '宠物纪念',
  IN_MEMORIAM: '逝者纪念',
  OTHER: '其他',
};

/** 场景码 → 中文，未知码回退原码。 */
export function formatOccasion(code: string): string {
  return OCCASION_ZH[code] ?? code;
}

/** ISO 日期字符串（'YYYY-MM-DD' 或完整 ISO）|null → 'YYYY年MM月DD日' | ''。 */
export function formatDateZh(iso: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '';
  return `${m[1]}年${m[2]}月${m[3]}日`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 秒保留一位小数，两位整数补零，如 6.7 → '06.7'。 */
function padSeconds(s: number): string {
  const rounded = Math.round(s * 10) / 10;
  const fixed = rounded.toFixed(1);
  return Number(fixed) < 10 ? `0${fixed}` : fixed;
}
