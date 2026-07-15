/**
 * 星历订阅接口的对外响应形状 —— 跨域冻结契约（Phase 9C）：
 * 「后端数据服务」域实现，「数据层」域（apps/web / @star/astro-ephem）消费。
 * 任何字段增删必须双方同步，勿单方面修改。
 */

/** 单个小天体的轨道根数（JPL SBDB 原值透传，后端不算轨道）。 */
export interface MinorBodyDto {
  /** 稳定标识：彗星编号去符号（'1P'、'C2023A3'），小行星小写英文名（'ceres'）。 */
  id: string;
  /** 上游全名，如 'C/2023 A3 (Tsuchinshan-ATLAS)'。 */
  name: string;
  /** 中文名（仅公认中文名，缺省省略）。 */
  nameZh?: string;
  kind: 'comet' | 'asteroid';
  /** 根数历元（儒略日 TDB）。 */
  epochJd: number;
  /** 偏心率（彗星可略 >1；近抛物线求解由数据层 e∈[0,1.2] 覆盖）。 */
  e: number;
  /** 近日点距离（AU）——彗星 q/tp 参数化主参数。 */
  qAu?: number;
  /** 半长轴（AU）——双曲线轨道为 SBDB 原样负值。 */
  aAu?: number;
  iDeg: number;
  /** 升交点黄经 Ω（度）。 */
  omDeg: number;
  /** 近日点幅角 ω（度）。 */
  wDeg: number;
  /** 近日点通过时刻（儒略日 TDB）。 */
  tpJd?: number;
  /** 历元平近点角（度）。 */
  maDeg?: number;
  /** 彗星总星等参数 M1。 */
  m1?: number;
  /** 彗核星等参数 M2。 */
  m2?: number;
}

/** GET /api/v1/minor-bodies 响应。 */
export interface MinorBodiesResponse {
  /** 本批次数据的抓取/生成时刻（ISO）。 */
  updatedAt: string;
  source: 'jpl-sbdb';
  bodies: MinorBodyDto[];
}

/** 单颗卫星的 TLE。 */
export interface TleSatDto {
  /**
   * 与 web 卫星 uid 对齐：著名卫星 'SAT-ISS' | 'SAT-TIANGONG' | 'SAT-HST'；
   * 星链动态条目 'SAT-STARLINK-{norad}'（前端按 'SAT-STARLINK-' 前缀分档）。
   */
  id: string;
  /** 上游名称行，如 'ISS (ZARYA)' / 'STARLINK-31234'。 */
  name: string;
  nameZh?: string;
  /** TLE 第一行（69 字符，mod-10 校验通过）。 */
  l1: string;
  /** TLE 第二行（69 字符，mod-10 校验通过）。 */
  l2: string;
  /**
   * 分组（可选，向后兼容）：'famous'=三颗内置著名卫星，'starlink'=星链组成员。
   * 前端亦可仅凭 id 前缀分档；本字段仅为便利。缺省视为 'famous'。
   */
  group?: 'famous' | 'starlink';
}

/** GET /api/v1/tle 响应。 */
export interface TleResponse {
  updatedAt: string;
  source: 'celestrak';
  sats: TleSatDto[];
}
