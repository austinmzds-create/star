/**
 * 天体物理档案确定性推导（百科 Phase：encyclopedia）。
 *
 * 纯函数、零外部依赖：仅由目录字段（光谱型/视星等/距离/坐标）推导温度、光度、
 * 质量、半径、寿命、演化阶段、归宿等科普档案。同一输入永远同一输出（funFacts
 * 以 objectUid 的 FNV-1a 哈希做种子），DB seed 与内存目录共用单一真源。
 *
 * 跨域契约（已冻结，勿改签名）：derivePhysical(obj, opts?) → PhysicalProfile | null。
 * 无法推导的天体（星历行星/日月/卫星等）返回 null；字段级缺输入即该字段 null，不猜。
 *
 * 合规红线：全部输出为科普事实文案，禁止出现「拥有/购买/产权/官方/认证/永久」
 * 等命名售卖误导词（spec 有全量断言）。
 */
import type { CelestialObject } from './types';
import { deriveDsoProfile } from './dso-profiles';

/** 天体物理档案。数值字段未知一律 null；stage/fate/colorDesc 未知用空串（契约冻结为 string）。 */
export interface PhysicalProfile {
  /** 有效表面温度（K，整数）。 */
  tempK: number | null;
  /** 质量（太阳质量，质光关系反解，clamp 0.08-60）。 */
  massSolar: number | null;
  /** 半径（太阳半径，Stefan-Boltzmann 反解）。 */
  radiusSolar: number | null;
  /** 光度（太阳光度）。 */
  luminositySolar: number | null;
  /** 已度过年龄启发式估算（Gyr）；白矮星为 null（已走完恒星一生）。 */
  ageGyr: number | null;
  /** 主序寿命估算（Gyr）：t = 10·M^-2.5。 */
  lifespanGyr: number | null;
  /** 剩余寿命 = lifespanGyr - ageGyr（Gyr）。 */
  remainingGyr: number | null;
  /**
   * 演化阶段：恒星为 main_sequence/subgiant/giant/supergiant/white_dwarf；
   * DSO 为类别（globular_cluster/open_cluster/emission_nebula/reflection_nebula/
   * planetary_nebula/supernova_remnant/galaxy）。未知为 ''。
   */
  stage: string;
  /**
   * 归宿：恒星为枚举码 white_dwarf/supernova_neutron_star/supernova_black_hole；
   * DSO 直接给中文命运文案。未知为 ''。人类可读文案统一看 fateDesc。
   */
  fate: string;
  /** 归宿的中文文案（恒星含 8-25 M☉ 区间的不确定性对冲措辞）。 */
  fateDesc: string;
  /** 颜色印象，如「金黄如太阳」。未知为 ''。 */
  colorDesc: string;
  /** 今晚所见之光的出发年份（= nowYear - round(distLy)；≤0 表示公元前）。 */
  lightDepartYear: number | null;
  /** 绝对星等 Mv。 */
  absoluteMag: number | null;
  /** 最佳观测月（1-12，冲日/午夜中天月，由赤经推算）。 */
  bestMonth: number | null;
  /** 观测手段分级：naked_eye / binoculars / telescope / photo。 */
  visibility: string | null;
  /** 科普趣闻（每 uid 确定性挑选，含数值对比）。 */
  funFacts: string[];
}

// —— 内部工具（dso-profiles.ts 复用，经 index.ts 一并导出无妨）——

/** FNV-1a 32 位哈希：funFacts 挑选的确定性种子。 */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 最佳观测月：冲日/午夜中天所在月（Orion 85° → 12 月）。 */
export function bestMonthFromRa(raDeg: number): number {
  return ((Math.floor(((raDeg + 180) % 360) / 30) + 3) % 12) + 1;
}

/** 观测手段分级（视星等阈值）。 */
export function visibilityFromMag(mag: number): 'naked_eye' | 'binoculars' | 'telescope' | 'photo' {
  if (mag <= 6) return 'naked_eye';
  if (mag <= 9.5) return 'binoculars';
  if (mag <= 13) return 'telescope';
  return 'photo';
}

/** 光的出发年份 = nowYear - round(distLy)；≤0 表示公元前（展示时转「公元前 X 年」）。 */
export function lightDepartYearFrom(distLy: number | null, nowYear: number): number | null {
  if (distLy == null || !(distLy > 0)) return null;
  return nowYear - Math.round(distLy);
}

/** 出发年份的中文文案（公元前无 0 年：year≤0 → 公元前 1-year 年）。 */
export function lightDepartText(year: number): string {
  return year > 0 ? `公元 ${year} 年` : `公元前 ${1 - year} 年`;
}

/** 保留 n 位有效数字。 */
function sig(x: number, n = 3): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  const p = Math.ceil(Math.log10(Math.abs(x)));
  const f = 10 ** (n - p);
  return Math.round(x * f) / f;
}

/** 倍数的中文格式化：大数用 万/亿，小数保留意义位。 */
export function fmtTimes(x: number): string {
  if (x >= 1e8) return `${Math.round((x / 1e8) * 10) / 10} 亿`;
  if (x >= 1e4) return `${Math.round((x / 1e4) * 10) / 10} 万`;
  if (x >= 100) return String(Math.round(x));
  if (x >= 10) return String(Math.round(x * 10) / 10);
  return String(Math.round(x * 100) / 100);
}

/** 深南天标注：赤纬过南在中国大陆几乎不升出地平线。 */
export function southernSkyNote(decDeg: number): string | null {
  if (decDeg >= -55) return null;
  return `赤纬约 ${Math.round(decDeg)}°，位于深南天，在中国大陆几乎不会升上地平线`;
}

/** 从候选池确定性挑 n 条（同 uid 永远同结果）：FNV-1a 种子 + LCG 步进。 */
export function pickDeterministic(pool: string[], uid: string, n: number): string[] {
  const rest = [...pool];
  const out: string[] = [];
  let h = fnv1a(uid);
  while (out.length < n && rest.length > 0) {
    const idx = h % rest.length;
    out.push(rest.splice(idx, 1)[0]!);
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
  }
  return out;
}

// —— 光谱解析 ——

type SpectralClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M';

/** 光谱类字母 → 连续刻度基准（O0=0 … M9=69），锚点内插用。 */
const CLASS_INDEX: Record<SpectralClass, number> = { O: 0, B: 10, A: 20, F: 30, G: 40, K: 50, M: 60 };

interface ParsedSpect {
  whiteDwarf: boolean;
  classLetter: SpectralClass | null;
  /** 连续刻度位置（类基准 + 子类，缺子类按 5 取类中点）。 */
  scale: number | null;
  /** 光度级：Ia/Iab/Ib/II/III/IV/V（'I' 归入 Ia）。 */
  lumClass: string | null;
}

/**
 * 解析 HYG 脏光谱串：'A0m...'、'M1: comp'、'K2IIIp'、'B0.5IV'、'M1Ib + B2.5V' 等。
 * 白矮星判定收紧为 /^sd/ 与 /^D大写/：'dF3' 是旧记法的（主序）矮星，不能误判。
 */
function parseSpectralType(spect: string | undefined): ParsedSpect {
  const none: ParsedSpect = { whiteDwarf: false, classLetter: null, scale: null, lumClass: null };
  if (!spect) return none;
  const raw = spect.trim();
  if (/^sd/i.test(raw) || /^D[A-Z]/.test(raw) || raw === 'D') {
    return { whiteDwarf: true, classLetter: null, scale: null, lumClass: null };
  }
  // 先 strip 非 [OBAFGKM0-9IVab.]（大小写敏感：保留 Iab 的小写 ab，剔除 p/var/comp 等杂质）
  const cleaned = raw.replace(/[^OBAFGKM0-9IVab.]/g, '');
  const m = cleaned.match(/^([OBAFGKM])(\d(?:\.\d)?)?/);
  const classLetter = (m?.[1] as SpectralClass | undefined) ?? null;
  const sub = m?.[2] !== undefined ? Number.parseFloat(m[2]) : 5; // 缺子类取类中点
  const scale = classLetter ? CLASS_INDEX[classLetter] + sub : null;
  // 光度级从长到短匹配（III 先于 II 先于 I；IV 先于 I/V），只看主星（第一段）之后
  const rest = m ? cleaned.slice(m[0].length) : cleaned;
  const lm = rest.match(/Iab|Ia|Ib|IV|III|II|I|V/);
  const lumClass = lm ? (lm[0] === 'I' ? 'Ia' : lm[0]) : null;
  return { whiteDwarf: false, classLetter, scale, lumClass };
}

// —— 校准锚点（Pecaut & Mamajek 2013 主序）——

/** 有效温度锚点：[刻度, K]。 */
const TEMP_ANCHORS: readonly (readonly [number, number])[] = [
  [5, 42000], [9, 34500], [10, 31500], [12, 20600], [15, 15700], [18, 12300],
  [20, 9900], [22, 9100], [25, 8100], [27, 7920], [30, 7220], [35, 6510],
  [40, 5930], [42, 5770], [45, 5660], [48, 5490], [50, 5280], [52, 5010],
  [55, 4410], [60, 3850], [62, 3550], [65, 3060], [68, 2570],
];

/** 热改正 BC 锚点：[刻度, mag]。 */
const BC_ANCHORS: readonly (readonly [number, number])[] = [
  [5, -4.4], [10, -3.0], [15, -1.5], [20, -0.3], [25, -0.15], [30, -0.09],
  [40, -0.1], [45, -0.14], [50, -0.24], [55, -0.66], [60, -1.21], [65, -2.73], [68, -4.0],
];

/** 锚点线性内插（两端 clamp）。 */
function interpAnchors(x: number, anchors: readonly (readonly [number, number])[]): number {
  const first = anchors[0]!;
  if (x <= first[0]) return first[1];
  for (let i = 1; i < anchors.length; i++) {
    const hi = anchors[i]!;
    if (x <= hi[0]) {
      const lo = anchors[i - 1]!;
      return lo[1] + ((x - lo[0]) / (hi[0] - lo[0])) * (hi[1] - lo[1]);
    }
  }
  return anchors[anchors.length - 1]![1];
}

/** Ballesteros 公式：B-V 色指数 → 有效温度（generated JSON 暂无 ci 列，本轮仅留接口）。 */
function tempFromBv(bv: number): number {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}

/** 颜色印象（按光谱类；无光谱类时按温度分档兜底）。 */
const COLOR_DESC: Record<SpectralClass, string> = {
  O: '蓝紫炽热', B: '蓝白炽热', A: '银白通透', F: '黄白明净',
  G: '金黄如太阳', K: '橙红温暖', M: '深红如炭火',
};

function colorDescFromTemp(tempK: number): string {
  if (tempK >= 30000) return COLOR_DESC.O;
  if (tempK >= 10000) return COLOR_DESC.B;
  if (tempK >= 7300) return COLOR_DESC.A;
  if (tempK >= 6000) return COLOR_DESC.F;
  if (tempK >= 5300) return COLOR_DESC.G;
  if (tempK >= 3900) return COLOR_DESC.K;
  return COLOR_DESC.M;
}

// —— 主推导 ——

/** 星历/太阳系天体类型：坐标随时变、无恒星物理档案可推导 → 整体返回 null。 */
const NON_DERIVABLE_TYPES = new Set<CelestialObject['type']>([
  'planet', 'moon', 'sun', 'satellite', 'asteroid', 'comet',
]);

const LY_PER_PARSEC = 3.2616;
/** 太阳半径 → AU 换算（R☉ ≈ 0.00465 AU）。 */
const AU_PER_RSUN = 0.00465;
const SUN_TEMP_K = 5772;

/**
 * 推导一个天体的物理档案。
 * - 恒星：光谱/星等/距离 → 完整计算链（缺哪环哪环的字段为 null）。
 * - DSO（galaxy/nebula/cluster）：转 deriveDsoProfile（类型模板 + Messier 手工精确表）。
 * - 星历/太阳系天体：返回 null。
 * opts.nowYear 固定「现在」便于测试；opts.bv 为 B-V 色指数兜底温度（暂无数据源，留接口）。
 */
export function derivePhysical(
  obj: CelestialObject,
  opts?: { nowYear?: number; bv?: number },
): PhysicalProfile | null {
  if (obj.isEphemeris || NON_DERIVABLE_TYPES.has(obj.type)) return null;
  if (obj.type !== 'star') return deriveDsoProfile(obj, opts);

  const nowYear = opts?.nowYear ?? new Date().getFullYear();
  const dist = obj.distanceLy != null && obj.distanceLy > 0 ? obj.distanceLy : null;
  const parsed = parseSpectralType(obj.spectralType);

  // 1-2. 温度与颜色（光谱锚点优先，B-V 兜底；皆无 → null，后续 BC 取 0 近似）
  let tempK: number | null = null;
  if (!parsed.whiteDwarf && parsed.scale != null) {
    tempK = Math.round(interpAnchors(parsed.scale, TEMP_ANCHORS));
  } else if (!parsed.whiteDwarf && opts?.bv != null) {
    tempK = Math.round(tempFromBv(opts.bv));
  }
  const colorDesc = parsed.classLetter
    ? COLOR_DESC[parsed.classLetter]
    : tempK != null
      ? colorDescFromTemp(tempK)
      : '';

  // 3. 绝对星等（距离缺失 → 光度链全 null）
  const absoluteMag =
    dist != null ? Math.round((obj.magnitude - 5 * Math.log10(dist / LY_PER_PARSEC) + 5) * 100) / 100 : null;

  // 4. 光度：Mbol = Mv + BC，L = 10^((4.74-Mbol)/2.5)
  let luminositySolar: number | null = null;
  if (absoluteMag != null) {
    const bc = parsed.scale != null ? interpAnchors(parsed.scale, BC_ANCHORS) : 0;
    luminositySolar = sig(10 ** ((4.74 - (absoluteMag + bc)) / 2.5));
  }

  // 5. 质量：分段质光关系反解（白矮星不适用主序关系 → null）
  let massSolar: number | null = null;
  if (!parsed.whiteDwarf && luminositySolar != null) {
    const L = luminositySolar;
    const m = L < 0.033 ? (L / 0.23) ** (1 / 2.3) : L < 16 ? L ** (1 / 4) : (L / 1.4) ** (1 / 3.5);
    massSolar = sig(Math.min(60, Math.max(0.08, m)));
  }

  // 6. 主序寿命：t = 10·M^-2.5（大质量端 clamp 0.003 Gyr 防荒谬值）
  let lifespanGyr: number | null = null;
  if (massSolar != null) {
    const t = 10 * massSolar ** -2.5;
    lifespanGyr = sig(massSolar > 1.5 ? Math.max(0.003, t) : t);
  }

  // 7. 演化阶段：白矮星 > 光度级 > 缺级兜底（L > 10^4 视作超巨星，否则按主序）
  let stage: string;
  if (parsed.whiteDwarf) {
    stage = 'white_dwarf';
  } else if (parsed.lumClass === 'Ia' || parsed.lumClass === 'Iab' || parsed.lumClass === 'Ib') {
    stage = 'supergiant';
  } else if (parsed.lumClass === 'II' || parsed.lumClass === 'III') {
    stage = 'giant';
  } else if (parsed.lumClass === 'IV') {
    stage = 'subgiant';
  } else {
    stage = luminositySolar != null && luminositySolar > 1e4 ? 'supergiant' : 'main_sequence';
  }

  // 8. 归宿（按质量分段；8-25 M☉ 区间演化质量估算固有不确定，文案作对冲）
  let fate = '';
  let fateDesc = '';
  if (parsed.whiteDwarf) {
    fate = 'white_dwarf';
    fateDesc = '它已走完恒星的一生，如今是一颗白矮星，将在漫长岁月里缓慢冷却、暗淡下去';
  } else if (massSolar != null) {
    if (massSolar < 8) {
      fate = 'white_dwarf';
      fateDesc = '它终将膨胀为红巨星，把外壳抛成行星状星云，最后安静地收缩为一颗白矮星';
    } else if (massSolar < 20) {
      fate = 'supernova_neutron_star';
      fateDesc =
        '它终将以超新星爆发谢幕，多半留下一颗中子星，也可能是黑洞——这一质量区间的估算本就带着不确定';
    } else if (massSolar < 25) {
      fate = 'supernova_black_hole';
      fateDesc =
        '它终将以超新星爆发谢幕，很可能坍缩成黑洞，也可能留下中子星——这一质量区间的估算本就带着不确定';
    } else {
      fate = 'supernova_black_hole';
      fateDesc = '它终将以壮烈的超新星爆发谢幕，核心坍缩成一个黑洞';
    }
  }

  // 9. 半径：R/R☉ = √L · (5772/T)²
  let radiusSolar: number | null = null;
  if (luminositySolar != null && tempK != null) {
    radiusSolar = sig(Math.sqrt(luminositySolar) * (SUN_TEMP_K / tempK) ** 2);
  }

  // 10. 年龄启发式：主序取寿命中值；亚巨星/巨星/超巨星已近生涯尾声；白矮星不再计龄
  let ageGyr: number | null = null;
  if (lifespanGyr != null && stage !== 'white_dwarf') {
    ageGyr = sig(stage === 'main_sequence' ? 0.5 * lifespanGyr : 0.9 * lifespanGyr);
  }
  const remainingGyr = lifespanGyr != null && ageGyr != null ? sig(lifespanGyr - ageGyr) : null;

  // 12-13. 光出发年份 / 最佳观测月 / 可见性分级
  const lightDepartYear = lightDepartYearFrom(dist, nowYear);
  const bestMonth = bestMonthFromRa(obj.raDeg);
  const visibility = visibilityFromMag(obj.magnitude);

  // 14. funFacts：适用池 → FNV-1a(uid) 确定性挑 3 条；深南天标注额外附加
  const pool: string[] = [];
  if (radiusSolar != null) {
    pool.push(`它的体积约是太阳的 ${fmtTimes(radiusSolar ** 3)} 倍`);
    const rAu = radiusSolar * AU_PER_RSUN;
    if (rAu >= 0.39) {
      const planet = rAu >= 1.52 ? '火星' : rAu >= 1.0 ? '地球' : rAu >= 0.72 ? '金星' : '水星';
      pool.push(`如果把它放到太阳的位置，连${planet}的轨道都会被吞进去`);
    }
  }
  if (tempK != null) {
    pool.push(`表面温度约 ${tempK} K，约为太阳表面的 ${fmtTimes(tempK / SUN_TEMP_K)} 倍`);
  }
  if (luminositySolar != null) {
    pool.push(`它的发光本领约是太阳的 ${fmtTimes(luminositySolar)} 倍`);
  }
  if (lightDepartYear != null) {
    pool.push(`你今晚看到的这束星光，早在${lightDepartText(lightDepartYear)}就已出发`);
  }
  if (ageGyr != null && lifespanGyr != null && lifespanGyr > 0) {
    const pct = Math.min(99, Math.max(1, Math.round((ageGyr / lifespanGyr) * 100)));
    pool.push(`按主序寿命估算，它的一生已走过约 ${pct}%`);
  }
  const funFacts = pickDeterministic(pool, obj.objectUid, 3);
  const southNote = southernSkyNote(obj.decDeg);
  if (southNote) funFacts.push(southNote);

  return {
    tempK,
    massSolar,
    radiusSolar,
    luminositySolar,
    ageGyr,
    lifespanGyr,
    remainingGyr,
    stage,
    fate,
    fateDesc,
    colorDesc,
    lightDepartYear,
    absoluteMag,
    bestMonth,
    visibility,
    funFacts,
  };
}
