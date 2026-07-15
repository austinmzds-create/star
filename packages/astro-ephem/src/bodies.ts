/**
 * 星历天体元数据（纯数据，零 astronomy-engine 依赖）。
 *
 * 消费方只需要名字/颜色/别名时，可走 '@star/astro-ephem/bodies' 子入口，
 * 完全不把 astronomy-engine 拖进 bundle（web 首包优化）。
 *
 * 合规红线：行星/太阳/月亮一律 isNamable=false，绝不进入纪念命名池。
 */

/** 星历天体 ID（小写英文）。 */
export type EphemerisBodyId =
  | 'sun'
  | 'moon'
  | 'mercury'
  | 'venus'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune';

/** 星历天体元数据。 */
export interface EphemerisBodyMeta {
  bodyId: EphemerisBodyId;
  /** 稳定唯一标识，如 'EPH-MARS'（与 celestial_object.objectUid 对齐）。 */
  objectUid: string;
  /** 天体分类：太阳 / 月亮 / 行星。 */
  kind: 'sun' | 'moon' | 'planet';
  nameZh: string;
  nameEn: string;
  /** 别名（含中文古称、拉丁俗名），直接决定搜索体验。 */
  aliases: string[];
  /** 渲染主色（十六进制）。 */
  colorHex: string;
  /** 相对显示尺寸（视觉设定，非物理比例）。 */
  displaySize: number;
  /** 展示用典型视星等（详情卡可用实时亮度覆盖）。 */
  typicalMagnitude: number;
  /** 中文一句话科普（不含任何命名/产权暗示）。 */
  descriptionZh: string;
}

/** objectUid 统一前缀：星历天体一律 'EPH-' 开头。 */
export const EPHEMERIS_UID_PREFIX = 'EPH-';

/** 判断某 objectUid 是否为星历天体（api / web / seed 三处统一走此判定）。 */
export function isEphemerisUid(uid: string): boolean {
  return uid.startsWith(EPHEMERIS_UID_PREFIX);
}

/** 9 个星历天体的元数据表（太阳 + 月亮 + 除地球外的 7 颗行星）。 */
const EPHEMERIS_BODIES: readonly EphemerisBodyMeta[] = [
  {
    bodyId: 'sun',
    objectUid: 'EPH-SUN',
    kind: 'sun',
    nameZh: '太阳',
    nameEn: 'Sun',
    aliases: ['Sol', '日'],
    colorHex: '#FFF2CE',
    displaySize: 42,
    typicalMagnitude: -26.7,
    descriptionZh: '太阳系的中心恒星，一颗黄矮星，地球上一切光和热的源泉。',
  },
  {
    bodyId: 'moon',
    objectUid: 'EPH-MOON',
    kind: 'moon',
    nameZh: '月亮',
    nameEn: 'Moon',
    aliases: ['月球', 'Luna', '太阴', '婵娟'],
    colorHex: '#E8E9F0',
    displaySize: 38,
    typicalMagnitude: -12.7,
    descriptionZh: '地球唯一的天然卫星，盈亏圆缺周期约 29.5 天，自古寄托思念。',
  },
  {
    bodyId: 'mercury',
    objectUid: 'EPH-MERCURY',
    kind: 'planet',
    nameZh: '水星',
    nameEn: 'Mercury',
    aliases: ['辰星'],
    colorHex: '#B8A89A',
    displaySize: 10,
    typicalMagnitude: 0.0,
    descriptionZh: '离太阳最近的行星，只在晨昏时分短暂现身，古称辰星。',
  },
  {
    bodyId: 'venus',
    objectUid: 'EPH-VENUS',
    kind: 'planet',
    nameZh: '金星',
    nameEn: 'Venus',
    aliases: ['太白', '启明', '长庚', '太白金星'],
    colorHex: '#F5E7C8',
    displaySize: 16,
    typicalMagnitude: -4.1,
    descriptionZh: '全天最亮的行星，晨见称启明、昏见称长庚，古称太白。',
  },
  {
    bodyId: 'mars',
    objectUid: 'EPH-MARS',
    kind: 'planet',
    nameZh: '火星',
    nameEn: 'Mars',
    aliases: ['荧惑'],
    colorHex: '#E07850',
    displaySize: 14,
    typicalMagnitude: 0.7,
    descriptionZh: '太阳系第四颗行星，因表面氧化铁而呈红色，古称荧惑。',
  },
  {
    bodyId: 'jupiter',
    objectUid: 'EPH-JUPITER',
    kind: 'planet',
    nameZh: '木星',
    nameEn: 'Jupiter',
    aliases: ['岁星'],
    colorHex: '#E8C8A0',
    displaySize: 20,
    typicalMagnitude: -2.2,
    descriptionZh: '太阳系最大的行星，约十二年绕天一周，古人以之纪年，称岁星。',
  },
  {
    bodyId: 'saturn',
    objectUid: 'EPH-SATURN',
    kind: 'planet',
    nameZh: '土星',
    nameEn: 'Saturn',
    aliases: ['镇星', '填星'],
    colorHex: '#E5D5A8',
    displaySize: 18,
    typicalMagnitude: 0.6,
    descriptionZh: '拥有壮丽光环的巨行星，古称镇星（填星）。',
  },
  {
    bodyId: 'uranus',
    objectUid: 'EPH-URANUS',
    kind: 'planet',
    nameZh: '天王星',
    nameEn: 'Uranus',
    aliases: [],
    colorHex: '#A8D8E0',
    displaySize: 12,
    typicalMagnitude: 5.7,
    descriptionZh: '一颗躺着自转的冰巨星，呈淡青色，1781 年由望远镜发现。',
  },
  {
    bodyId: 'neptune',
    objectUid: 'EPH-NEPTUNE',
    kind: 'planet',
    nameZh: '海王星',
    nameEn: 'Neptune',
    aliases: [],
    colorHex: '#7098E8',
    displaySize: 12,
    typicalMagnitude: 7.9,
    descriptionZh: '太阳系最外侧的行星，深蓝色的冰巨星，先经笔尖计算而后被发现。',
  },
];

/** 列出全部 9 个星历天体元数据（只读）。 */
export function listEphemerisBodies(): readonly EphemerisBodyMeta[] {
  return EPHEMERIS_BODIES;
}

const BY_UID = new Map<string, EphemerisBodyMeta>(
  EPHEMERIS_BODIES.map((b) => [b.objectUid, b]),
);
const BY_BODY_ID = new Map<EphemerisBodyId, EphemerisBodyMeta>(
  EPHEMERIS_BODIES.map((b) => [b.bodyId, b]),
);

/** 按 bodyId 取元数据（bodyId 为受限联合类型，必命中）。 */
export function getEphemerisBodyMeta(bodyId: EphemerisBodyId): EphemerisBodyMeta {
  const meta = BY_BODY_ID.get(bodyId);
  if (!meta) throw new Error(`未知星历天体: ${bodyId}`);
  return meta;
}

/** objectUid → bodyId 反查；非星历 uid 抛错（调用方应先用 isEphemerisUid 判定）。 */
export function uidToBodyId(objectUid: string): EphemerisBodyId {
  const meta = BY_UID.get(objectUid);
  if (!meta) throw new Error(`不是星历天体 objectUid: ${objectUid}`);
  return meta.bodyId;
}
