/**
 * 深空天体（DSO）百科档案：类型模板 + Messier 手工精确表。
 *
 * OpenNGC 无距离/年龄列，能确定给出的只有两层：
 * 1. 类别模板（球状/疏散/发射/反射/行星状/超新星遗迹/星系）——命运与氛围文案；
 * 2. MESSIER_FACTS 手工表——著名天体的真实距离/年龄/恒星数（覆盖模板）。
 * 恒星物理量（温度/质量/半径等）对 DSO 无意义，一律 null（字段级不猜）。
 *
 * 合规红线：全部为科普事实文案，禁止「拥有/购买/产权/官方/认证/永久」（spec 断言）。
 */
import type { CelestialObject } from './types';
import {
  bestMonthFromRa,
  lightDepartText,
  lightDepartYearFrom,
  southernSkyNote,
  visibilityFromMag,
  type PhysicalProfile,
} from './physics';

/** DSO 类别（stage 字段取值）。 */
export type DsoKind =
  | 'globular_cluster'
  | 'open_cluster'
  | 'emission_nebula'
  | 'reflection_nebula'
  | 'planetary_nebula'
  | 'supernova_remnant'
  | 'galaxy';

interface DsoTemplate {
  /** 命运文案（fate/fateDesc）。 */
  fate: string;
  /** 氛围/科普一句话（进 funFacts）。 */
  ambience: string;
}

/** 类别模板：命运 + 氛围，各类通用兜底。 */
const DSO_TEMPLATES: Record<DsoKind, DsoTemplate> = {
  globular_cluster: {
    fate: '将绕着银河系中心存续极漫长的岁月，在潮汐与恒星逃逸中极缓慢地蒸发',
    ambience: '球状星团多是上百亿年高龄的长者，几乎与银河系同龄',
  },
  open_cluster: {
    fate: '数亿年内将被银河系的潮汐力逐渐拉散，成员各奔东西、汇入星海',
    ambience: '疏散星团里的恒星诞生于同一片星云，像终将散落天涯的同窗',
  },
  emission_nebula: {
    fate: '这是恒星的摇篮：数百万年后将被新生恒星的星风与辐射吹散',
    ambience: '发光的气体中，新的太阳正在被点亮',
  },
  reflection_nebula: {
    fate: '它自身并不发光，待近旁的恒星远去或尘埃散尽，这抹微光便会暗下去',
    ambience: '尘埃反射着邻近恒星的光，泛出蓝白色的微光',
  },
  planetary_nebula: {
    fate: '抛出的外壳将在数万年内消散于星际空间，只留下中心一颗白矮星',
    ambience: '这是类太阳恒星谢幕时抛出的外衣，也是太阳约 50 亿年后的预演',
  },
  supernova_remnant: {
    fate: '将持续膨胀并融入星际介质，锻造好的重元素会成为下一代恒星的原料',
    ambience: '大质量恒星以爆发谢幕，把一生锻造的元素归还给星际',
  },
  galaxy: {
    fate: '将持续造星，直到气体耗尽，或与邻近的星系并合成新的家园',
    ambience: '这是一座由亿万颗恒星组成的岛屿宇宙',
  },
};

interface MessierFact {
  kind: DsoKind;
  /** 距离（光年，真实测量常用值）。 */
  distLy: number;
  /** 已知年龄（Gyr，仅星团类有可靠值）。 */
  ageGyr?: number;
  /** 手工事实（真实数值，直接进 funFacts）。 */
  facts: string[];
  /** 覆盖模板的专属命运文案。 */
  fate?: string;
}

/** 著名 Messier 天体手工精确表（真实数值；uid 命中则覆盖模板）。 */
const MESSIER_FACTS: Record<string, MessierFact> = {
  M1: {
    kind: 'supernova_remnant', distLy: 6500,
    facts: ['它是 1054 年超新星爆发的残骸——宋代天文志里的「天关客星」，至今约 970 岁', '中心的脉冲星每秒自转约 30 次'],
    fate: '正以约 1500 km/s 的速度膨胀，终将消散、融入星际空间',
  },
  M2: { kind: 'globular_cluster', distLy: 37500, ageGyr: 12.5, facts: ['年龄约 125 亿年，聚集着约 15 万颗恒星'] },
  M3: { kind: 'globular_cluster', distLy: 33900, ageGyr: 11.4, facts: ['年龄约 114 亿年，约 50 万颗恒星挤在一团'] },
  M4: { kind: 'globular_cluster', distLy: 7200, ageGyr: 12.2, facts: ['年龄约 122 亿年，是离我们最近的球状星团之一'] },
  M5: { kind: 'globular_cluster', distLy: 24500, ageGyr: 13, facts: ['年龄约 130 亿年，成员超过 10 万颗'] },
  M6: { kind: 'open_cluster', distLy: 1600, ageGyr: 0.094, facts: ['年龄约 9400 万年，约 120 颗成员星，形似一只蝴蝶'] },
  M7: { kind: 'open_cluster', distLy: 980, ageGyr: 0.2, facts: ['年龄约 2 亿年，约 80 颗成员星'] },
  M8: { kind: 'emission_nebula', distLy: 4100, facts: ['正在孕育新的恒星，跨度约 110×50 光年'] },
  M11: { kind: 'open_cluster', distLy: 6200, ageGyr: 0.25, facts: ['年龄约 2.5 亿年，约 2900 颗成员星，是最致密的疏散星团之一'] },
  M13: { kind: 'globular_cluster', distLy: 22200, ageGyr: 11.65, facts: ['年龄约 116.5 亿年，约 30 万颗恒星'] },
  M15: { kind: 'globular_cluster', distLy: 33600, ageGyr: 12.9, facts: ['年龄约 129 亿年，中心可能藏着一个中等质量黑洞'] },
  M16: { kind: 'emission_nebula', distLy: 7000, facts: ['年龄约 550 万年，著名的「创生之柱」就在这里'] },
  M17: { kind: 'emission_nebula', distLy: 5500, facts: ['银河系里最活跃的大质量恒星工厂之一'] },
  M20: { kind: 'emission_nebula', distLy: 4100, facts: ['包含已知最年轻的恒星形成区之一（约 30 万年）'] },
  M27: { kind: 'planetary_nebula', distLy: 1360, facts: ['外壳抛出至今约 1 万年——这也是太阳未来的预演'] },
  M31: {
    kind: 'galaxy', distLy: 2540000,
    facts: ['约 1 万亿颗恒星，是本星系群最大的星系'],
    fate: '约 40-45 亿年后将与银河系相遇并合，融成一个巨大的椭圆星系',
  },
  M33: { kind: 'galaxy', distLy: 2730000, facts: ['约 400 亿颗恒星，本星系群第三大星系'] },
  M42: { kind: 'emission_nebula', distLy: 1344, facts: ['年龄不足 300 万年，正孕育着上千颗原恒星'] },
  M44: { kind: 'open_cluster', distLy: 577, ageGyr: 0.65, facts: ['年龄约 6-7 亿年，约 1000 颗成员星'] },
  M45: {
    kind: 'open_cluster', distLy: 444, ageGyr: 0.1,
    facts: ['年龄约 1 亿年，约 1000 颗成员星'],
    fate: '约 2.5 亿年后将在银河系潮汐中解体，七姊妹终将各奔东西',
  },
  M51: { kind: 'galaxy', distLy: 23000000, facts: ['正与伴星系 NGC 5195 缓慢并合，旋臂因此格外壮丽'] },
  M57: { kind: 'planetary_nebula', distLy: 2500, facts: ['外壳抛出至今约 7000 年'] },
  M64: { kind: 'galaxy', distLy: 17000000, facts: ['「黑眼星系」：外盘的气体竟在反向旋转'] },
  M67: { kind: 'open_cluster', distLy: 2700, ageGyr: 4, facts: ['年龄约 40 亿年，是已知最古老的疏散星团之一'] },
  M78: { kind: 'reflection_nebula', distLy: 1350, facts: ['全天最亮的反射星云'] },
  M81: { kind: 'galaxy', distLy: 11800000, facts: ['约 2500 亿颗恒星'] },
  M82: { kind: 'galaxy', distLy: 12000000, facts: ['星暴星系：造星速率约是银河系的 10 倍'] },
  M87: { kind: 'galaxy', distLy: 53500000, facts: ['数万亿颗恒星；中心黑洞约 65 亿倍太阳质量，是人类第一张黑洞照片的主角'] },
  M92: { kind: 'globular_cluster', distLy: 26700, ageGyr: 13.2, facts: ['年龄约 132 亿年，是已知最古老的星团之一'] },
  M97: { kind: 'planetary_nebula', distLy: 2030, facts: ['外壳抛出至今约 8000 年，两个暗斑像猫头鹰的双眼'] },
  M101: { kind: 'galaxy', distLy: 21000000, facts: ['约 1 万亿颗恒星，直径约 17 万光年，比银河系还大'] },
  M104: { kind: 'galaxy', distLy: 29000000, facts: ['草帽星系：中心黑洞约 10 亿倍太阳质量'] },
};

/** 类别判定：手工表 > 类型 galaxy > descriptionZh 关键词 > 类型兜底。 */
function detectKind(obj: CelestialObject): DsoKind {
  const hand = MESSIER_FACTS[obj.objectUid];
  if (hand) return hand.kind;
  if (obj.type === 'galaxy') return 'galaxy';
  const desc = obj.descriptionZh ?? '';
  if (desc.includes('超新星遗迹')) return 'supernova_remnant';
  if (desc.includes('行星状')) return 'planetary_nebula';
  if (desc.includes('反射')) return 'reflection_nebula';
  if (desc.includes('球状')) return 'globular_cluster';
  if (desc.includes('疏散')) return 'open_cluster';
  if (desc.includes('星系')) return 'galaxy';
  if (obj.type === 'cluster') return 'open_cluster';
  return 'emission_nebula';
}

/**
 * DSO 百科档案。恒星物理量一律 null；stage=类别、fate/fateDesc=命运文案，
 * funFacts = 手工事实 + 光出发年份 + 氛围一句话（+ 深南天标注）。
 */
export function deriveDsoProfile(
  obj: CelestialObject,
  opts?: { nowYear?: number },
): PhysicalProfile {
  const nowYear = opts?.nowYear ?? new Date().getFullYear();
  const kind = detectKind(obj);
  const template = DSO_TEMPLATES[kind];
  const hand = MESSIER_FACTS[obj.objectUid];

  const distLy = hand?.distLy ?? obj.distanceLy ?? null;
  const lightDepartYear = lightDepartYearFrom(distLy, nowYear);
  const fate = hand?.fate ?? template.fate;

  const funFacts: string[] = [...(hand?.facts ?? [])];
  if (lightDepartYear != null) {
    funFacts.push(
      `它离我们约 ${distLy! >= 1e4 ? `${Math.round(distLy! / 1e4)} 万` : Math.round(distLy!)} 光年——今晚看到的这片光，出发于${lightDepartText(lightDepartYear)}`,
    );
  }
  funFacts.push(template.ambience);
  const southNote = southernSkyNote(obj.decDeg);
  if (southNote) funFacts.push(southNote);

  return {
    tempK: null,
    massSolar: null,
    radiusSolar: null,
    luminositySolar: null,
    ageGyr: hand?.ageGyr ?? null,
    lifespanGyr: null,
    remainingGyr: null,
    stage: kind,
    fate,
    fateDesc: fate,
    colorDesc: '',
    lightDepartYear,
    absoluteMag: null,
    bestMonth: bestMonthFromRa(obj.raDeg),
    visibility: visibilityFromMag(obj.magnitude),
    funFacts,
  };
}
