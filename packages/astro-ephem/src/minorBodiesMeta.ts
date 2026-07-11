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

/** 内置小天体 ID（小写英文）。 */
export type MinorBodyId = 'ceres' | 'vesta' | 'pallas' | 'halley';

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

/** 4 个内置小天体的元数据表（3 颗主带小行星 + 哈雷彗星）。 */
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
];

/** 列出全部 4 个小天体元数据（只读）。 */
export function listMinorBodies(): readonly MinorBodyMeta[] {
  return MINOR_BODIES;
}

const BY_UID = new Map<string, MinorBodyMeta>(MINOR_BODIES.map((b) => [b.objectUid, b]));
const BY_ID = new Map<MinorBodyId, MinorBodyMeta>(MINOR_BODIES.map((b) => [b.id, b]));

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
