/** 星体数据公共类型。与后端 celestial_object 主表字段保持一致，便于多端与库表对齐。 */

export type CelestialObjectType =
  | 'star'
  | 'galaxy'
  | 'nebula'
  | 'cluster'
  | 'planet'
  | 'moon'
  | 'sun'
  // Phase 6B 纯类型加宽（向后兼容）：仅存在于 web 端常量目录行，绝不落库/seed。
  // api 按 string 存储、无对 type 的穷举依赖（已核）。三类一律 isNamable=false。
  | 'satellite'
  | 'asteroid'
  | 'comet';

/**
 * 一个天体的主数据。
 * 字段命名刻意贴近后端主表（celestial_object），方便前后端与小程序共用同一套模型。
 */
export interface CelestialObject {
  /** 稳定唯一标识，优先用星表编号，如 'HIP32349'。 */
  objectUid: string;
  /** 天体类型。 */
  type: CelestialObjectType;
  /** 英文主名，如 'Sirius'。 */
  nameEn: string;
  /** 中文主名，如 '天狼星'。 */
  nameZh: string;
  /** 别名集合（拜耳命名、旧称、俗称、中文简称等），用于搜索。 */
  aliases: string[];
  /** 拜耳/佛兰斯蒂德命名，如 'α CMa'。 */
  bayer?: string;
  /** 所属星座（英文）。 */
  constellation: string;
  /** 所属星座（中文）。 */
  constellationZh: string;
  /** 赤经，单位度（J2000，0–360）。 */
  raDeg: number;
  /** 赤纬，单位度（J2000，-90–90）。 */
  decDeg: number;
  /** 视星等（越小越亮）。 */
  magnitude: number;
  /** 距离，单位光年；未知为 null。 */
  distanceLy: number | null;
  /**
   * 自行 RA 分量（mas/yr，已含 cosδ 因子——HYG 的 pmra 列约定，即切向真实角速率）。
   * 供恒星自行时光机（Phase 9B 深时模式）做星座形变渲染。可选，向后兼容；
   * 仅恒星携带（HYG 来源），深空/星历天体无此键。
   */
  pmRaMasYr?: number;
  /** 自行 Dec 分量（mas/yr）。可选，向后兼容，与 pmRaMasYr 成对出现。 */
  pmDecMasYr?: number;
  /** 光谱型，如 'A1V'。 */
  spectralType?: string;
  /** 各星表交叉编号，如 { hip: '32349', hd: '48915' }。 */
  catalogIds: Record<string, string>;
  /** 是否允许作为纪念命名对象。 */
  isNamable: boolean;
  /** 是否为「精选/著名」星体（首页展示、搜索优先）。 */
  isFeatured: boolean;
  /** 中文简介。 */
  descriptionZh?: string;
  /**
   * 中文俗名（如 M31「仙女座大星云」、M45「七姊妹星团」），用于展示与搜索。
   * 可选，向后兼容。
   */
  commonNameZh?: string;
  /**
   * 渲染优先级分档，0 最高（首屏必载），数值越小越优先。
   * 供前端渐进/分档加载（LOD）参考。可选，向后兼容。
   */
  renderPriority?: number;
  /**
   * 搜索排序次级键，越大越优先（著名加成 + 亮度加成）。
   * 主要为 Phase 3 落库后的 ORDER BY 预备，保证内存版与 DB 版排序一致。可选，向后兼容。
   */
  searchPriority?: number;
  /**
   * 数据来源标记，如 'handwritten'（手写精选）、'hyg-v41'（HYG 生成）、
   * 'handwritten-fallback'（HYG 不可用时的手写回退批次）、'openngc'（OpenNGC 深空天体）、
   * 'ephemeris'（历表天体）。可选，向后兼容。
   */
  sourceCatalog?: string;
  /**
   * 是否为星历天体（行星/太阳/月亮）：坐标不落库、由 @star/astro-ephem
   * 按观测时刻实时计算；raDeg/decDeg 仅为某一时刻的快照。可选，向后兼容。
   */
  isEphemeris?: boolean;
  /**
   * 真实影像键：对应 web 端 public/dso-photos/{imageKey}.jpg（著名深空天体的真实天文照片）。
   * 可选，向后兼容；仅 ~16 个著名 Messier 天体携带。
   */
  imageKey?: string;
  /**
   * 真实长轴角尺寸（度，由 OpenNGC MajAx 角分换算）。可选，向后兼容。
   */
  angularSizeDeg?: number;
  /**
   * 影像署名（如 'NASA, ESA, M. Robberto (STScI/ESA)，公有领域'），供 UI 就地署名（CC-BY 合规）。
   * 可选，与 imageKey 成对出现。
   */
  imageCredit?: string;
}

/** 搜索命中结果。 */
export interface StarSearchResult {
  object: CelestialObject;
  /** 相关性得分，越大越相关。 */
  score: number;
  /** 命中的字段类型，便于前端高亮说明。 */
  matchedOn: 'name' | 'alias' | 'bayer' | 'catalog' | 'constellation';
}
