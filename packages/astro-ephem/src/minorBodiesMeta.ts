/**
 * 小天体（小行星/彗星）纯元数据 —— 零 astronomy-engine 依赖。
 *
 * 仅需名字/别名/颜色（搜索目录、信息卡文案）时请走
 * '@star/astro-ephem/minor-meta' 子入口，不把星历引擎拖进首屏 bundle。
 * 轨道根数与位置计算见 ./minorBodies（主入口导出）。
 *
 * 合规红线：小天体一律 isNamable=false（由 web 侧目录行落实），
 * 文案不含任何官方命名/产权暗示。
 */

/** 内置小天体 ID（小写英文，编译期闭集——根数常量表按此穷举）。 */
export type BuiltinMinorBodyId = 'ceres' | 'vesta' | 'pallas' | 'halley' | 'encke' | 'ponsbrooks';

/**
 * 小天体 ID（9C 起放宽为 string）：内置 6 体 + 运行时动态注册的彗星
 * （/api/v1/minor-bodies 源，registerMinorBody）。未注册 id 的查询仍抛错，
 * 类型放宽不改变运行时契约。
 */
export type MinorBodyId = string;

/** 小天体元数据（纯数据行）。 */
export interface MinorBodyMeta {
  id: MinorBodyId;
  /** 稳定唯一标识，统一 'MB-' 前缀，如 'MB-CERES'。 */
  objectUid: string;
  /** 天体分类：小行星 / 彗星。 */
  kind: 'asteroid' | 'comet';
  nameZh: string;
  nameEn: string;
  /** 别名（中英俗称），直接决定搜索体验。 */
  aliases: string[];
  /** 渲染主色（十六进制）。 */
  colorHex: string;
  /** 展示用典型视星等（哈雷当前位于远日点附近，极暗，取 ~28）。 */
  typicalMagnitude: number;
  /** 中文一句话科普（不含任何命名/产权暗示）。 */
  descriptionZh: string;
}

/** objectUid 统一前缀：小天体一律 'MB-' 开头。 */
export const MINOR_BODY_UID_PREFIX = 'MB-';

/** 判断某 objectUid 是否为小天体。 */
export function isMinorBodyUid(uid: string): boolean {
  return uid.startsWith(MINOR_BODY_UID_PREFIX);
}

/** 6 个内置小天体的元数据表（3 颗主带小行星 + 3 颗周期彗星）。 */
const MINOR_BODIES: readonly MinorBodyMeta[] = [
  {
    id: 'ceres',
    objectUid: 'MB-CERES',
    kind: 'asteroid',
    nameZh: '谷神星',
    nameEn: 'Ceres',
    aliases: ['谷神', '1 Ceres', 'Ceres'],
    colorHex: '#cfc4b2',
    typicalMagnitude: 8.7,
    descriptionZh:
      '主小行星带中最大的天体，1801 年发现的第 1 号小行星，现被归为矮行星，表面可能藏有冰层。',
  },
  {
    id: 'vesta',
    objectUid: 'MB-VESTA',
    kind: 'asteroid',
    nameZh: '灶神星',
    nameEn: 'Vesta',
    aliases: ['灶神', '4 Vesta', 'Vesta'],
    colorHex: '#e0d3b8',
    typicalMagnitude: 7.2,
    descriptionZh:
      '第 4 号小行星，主带中最亮的一颗，冲日时肉眼勉强可见，拥有分异的岩浆演化历史。',
  },
  {
    id: 'pallas',
    objectUid: 'MB-PALLAS',
    kind: 'asteroid',
    nameZh: '智神星',
    nameEn: 'Pallas',
    aliases: ['智神', '2 Pallas', 'Pallas'],
    colorHex: '#b9c4cf',
    typicalMagnitude: 9.0,
    descriptionZh:
      '第 2 号小行星，轨道倾角高达约 35°，在主带天体中独树一帜，是主带质量第三大的成员。',
  },
  {
    id: 'halley',
    objectUid: 'MB-HALLEY',
    kind: 'comet',
    nameZh: '哈雷彗星',
    nameEn: '1P/Halley',
    aliases: ['哈雷', '1P', 'Halley'],
    colorHex: '#a9d8e8',
    typicalMagnitude: 28.0,
    descriptionZh:
      '最著名的周期彗星，约 76 年回归一次，上次过近日点在 1986 年；目前位于远日点附近（约 35 AU），极其暗弱，仅示意其轨道位置，下次回归约在 2061 年。',
  },
  {
    id: 'encke',
    objectUid: 'MB-ENCKE',
    kind: 'comet',
    nameZh: '恩克彗星',
    nameEn: '2P/Encke',
    aliases: ['恩克', '2P', 'Encke'],
    colorHex: '#9fd8c8',
    // 展示用典型视星等：多数时间远离太阳、极暗；近日点前后（约每 3.3 年）
    // 可短暂亮至 6–8 等。取远离太阳时的量级作为常态展示值。
    typicalMagnitude: 18.0,
    descriptionZh:
      '已知公转周期最短的彗星，约 3.3 年绕太阳一圈，近日点深入水星轨道以内；金牛座流星雨的母体，回归频繁是观察彗星活动的经典样本。',
  },
  {
    id: 'ponsbrooks',
    objectUid: 'MB-PONSBROOKS',
    kind: 'comet',
    nameZh: '庞斯-布鲁克斯彗星',
    nameEn: '12P/Pons-Brooks',
    aliases: ['庞斯布鲁克斯', '庞斯-布鲁克斯', '12P', 'Pons-Brooks', '魔鬼彗星'],
    colorHex: '#bfe3a8',
    // 展示用典型视星等：2024-04 回归时曾亮至约 4–5 等，回归间隔期极暗。
    typicalMagnitude: 17.0,
    descriptionZh:
      '约 71 年回归一次的明亮周期彗星，2024 年 4 月回归时因彗核爆发喷出「角状」彗发被昵称为魔鬼彗星，是近年最受关注的回归彗星之一。',
  },
];

/** 动态注册的小天体元数据（9C，注册顺序稳定；内置 6 体恒在最前）。 */
const DYNAMIC_BODIES: MinorBodyMeta[] = [];

/** 列出全部小天体元数据（内置 6 体 + 动态注册，只读快照）。 */
export function listMinorBodies(): readonly MinorBodyMeta[] {
  return DYNAMIC_BODIES.length === 0 ? MINOR_BODIES : [...MINOR_BODIES, ...DYNAMIC_BODIES];
}

/** 仅列出内置 6 体（回退语义/测试基线）。 */
export function listBuiltinMinorBodies(): readonly MinorBodyMeta[] {
  return MINOR_BODIES;
}

const BY_UID = new Map<string, MinorBodyMeta>(MINOR_BODIES.map((b) => [b.objectUid, b]));
const BY_ID = new Map<MinorBodyId, MinorBodyMeta>(MINOR_BODIES.map((b) => [b.id, b]));

/**
 * 注册一个动态小天体的元数据（9C，/api/v1/minor-bodies 动态彗星）。
 * 幂等：同 id 重复注册直接忽略（feed 每次启动全量拉取，去重责任在此收口）。
 * 校验：uid 必须 'MB-' 前缀且不与既有冲突——违约抛错（编程错误，非数据降级）。
 */
export function registerMinorBodyMeta(meta: MinorBodyMeta): void {
  if (BY_ID.has(meta.id)) return; // 幂等
  if (!meta.objectUid.startsWith(MINOR_BODY_UID_PREFIX)) {
    throw new Error(`小天体 uid 必须以 ${MINOR_BODY_UID_PREFIX} 开头: ${meta.objectUid}`);
  }
  if (BY_UID.has(meta.objectUid)) {
    throw new Error(`小天体 uid 冲突: ${meta.objectUid}`);
  }
  DYNAMIC_BODIES.push(meta);
  BY_UID.set(meta.objectUid, meta);
  BY_ID.set(meta.id, meta);
}

/** 按 id 取元数据（id 为受限联合类型，必命中）。 */
export function getMinorBodyMeta(id: MinorBodyId): MinorBodyMeta {
  const meta = BY_ID.get(id);
  if (!meta) throw new Error(`未知小天体: ${id}`);
  return meta;
}

/** objectUid → MinorBodyId 反查；非小天体 uid 抛错（调用方应先用 isMinorBodyUid 判定）。 */
export function minorUidToId(objectUid: string): MinorBodyId {
  const meta = BY_UID.get(objectUid);
  if (!meta) throw new Error(`不是小天体 objectUid: ${objectUid}`);
  return meta.id;
}
