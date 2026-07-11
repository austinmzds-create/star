import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  FULL_CATALOG,
  searchCelestial,
  type CelestialObject,
  type StarSearchResult,
} from '@star/astro-data';
import {
  getEquatorial,
  getMoonPhase,
  isEphemerisUid,
  listEphemerisBodies,
  toCelestialObject,
  uidToBodyId,
  type MoonPhaseInfo,
} from '@star/astro-ephem';
import { AppError, ErrorCodes } from '../common/errors/app-error';

/** 测试注入用：自定义星表目录的 DI token（生产不提供，走默认精选星表）。 */
export const CELESTIAL_CATALOG_TOKEN = Symbol('CELESTIAL_CATALOG_TOKEN');

/** 星历天体的实时坐标附加块（详情接口对 isEphemeris 天体返回）。 */
export interface EphemerisInfo {
  raDeg: number;
  decDeg: number;
  /** 地心距离（天文单位 AU）。 */
  distanceAu: number;
  /** 坐标计算时刻（ISO 字符串）。 */
  computedAt: string;
  /** 月相信息（仅 EPH-MOON 有）。 */
  moonPhase?: MoonPhaseInfo;
}

/**
 * 天体查询服务。
 *
 * 数据源 = @star/astro-data 内存目录（恒星/深空天体，坐标固定）
 *        + @star/astro-ephem 星历天体（太阳/月亮/行星，坐标随时刻变化）。
 *
 * 星历天体约定：
 * - 目录里放构造时刻的快照（仅让元数据可被搜索索引收录），
 *   任何出口（search/getByUid）都会把 isEphemeris 命中项覆写为请求时刻的实时坐标；
 * - 覆写走浅拷贝，不改缓存目录本体——this.catalog 引用稳定，
 *   searchCelestial 的 WeakMap 索引只建一次，无性能回退。
 *
 * Phase 3 DB 化路径：将此类改为注入 PrismaService，search 走
 * celestial_name_alias.aliasNorm 的 pg_trgm 相似度 + searchPriority 加权，
 * getByUid 走 celestial_object 主表——接口签名不变，调用方无感。
 */
@Injectable()
export class CelestialService {
  /** 恒星/深空天体目录（坐标固定），listAll 只暴露这部分。 */
  private readonly fixedCatalog: CelestialObject[];
  /** 完整目录（含星历天体快照），供搜索与按 uid 查找。 */
  private readonly catalog: CelestialObject[];
  private readonly byUid: Map<string, CelestialObject>;

  constructor(
    @Optional() @Inject(CELESTIAL_CATALOG_TOKEN) catalog?: CelestialObject[],
  ) {
    // FULL_CATALOG = 恒星 + 深空天体（M31 等 DSO 可搜索可点击；DSO 一律 isNamable=false）
    this.fixedCatalog = catalog ?? FULL_CATALOG;
    // 星历天体快照：仅作搜索索引占位，出口前必刷新为实时坐标
    const eph = listEphemerisBodies().map((b) => toCelestialObject(b.bodyId, new Date()));
    this.catalog = [...this.fixedCatalog, ...eph];
    this.byUid = new Map(this.catalog.map((o) => [o.objectUid, o]));
  }

  /** 出口统一刷新：星历天体覆写为 at 时刻实时坐标（浅拷贝，不改缓存目录）。 */
  private withLiveCoords(obj: CelestialObject, at: Date): CelestialObject {
    if (!obj.isEphemeris || !isEphemerisUid(obj.objectUid)) return obj;
    const eq = getEquatorial(uidToBodyId(obj.objectUid), at);
    return { ...obj, raDeg: eq.raDeg, decDeg: eq.decDeg };
  }

  /** 按查询词搜索天体（中文名/英文名/别名/拜耳/星表编号/星座）；星历天体坐标按 at 时刻实时计算。 */
  search(q: string, limit = 8, at: Date = new Date()): StarSearchResult[] {
    return searchCelestial(q, { limit, catalog: this.catalog }).map((r) => ({
      ...r,
      object: this.withLiveCoords(r.object, at),
    }));
  }

  /**
   * 全量只读目录——仅坐标固定的恒星/深空天体，不含星历天体
   * （证书/纪念册的邻域星必须是恒星，星历快照坐标会过期，绝不外漏）。
   */
  listAll(): readonly CelestialObject[] {
    return this.fixedCatalog;
  }

  /** 按 objectUid 取天体，不存在抛 CELESTIAL_NOT_FOUND；星历天体坐标按 at 时刻实时计算。 */
  getByUid(objectUid: string, at: Date = new Date()): CelestialObject {
    const obj = this.byUid.get(objectUid);
    if (!obj) {
      throw new AppError(ErrorCodes.CELESTIAL_NOT_FOUND, `星体不存在: ${objectUid}`);
    }
    return this.withLiveCoords(obj, at);
  }

  /** 星历天体的实时坐标附加块；非星历天体返回 undefined（详情响应据此决定是否带 ephemeris 字段）。 */
  getEphemerisInfo(objectUid: string, at: Date = new Date()): EphemerisInfo | undefined {
    if (!isEphemerisUid(objectUid) || !this.byUid.has(objectUid)) return undefined;
    const bodyId = uidToBodyId(objectUid);
    const eq = getEquatorial(bodyId, at);
    const info: EphemerisInfo = {
      raDeg: eq.raDeg,
      decDeg: eq.decDeg,
      distanceAu: eq.distanceAu,
      computedAt: at.toISOString(),
    };
    if (bodyId === 'moon') info.moonPhase = getMoonPhase(at);
    return info;
  }

  /** 取可命名星体：存在性 + isNamable 校验，供 MemorialService 调用。星历天体 isNamable 恒为 false，必拦截。 */
  getNamableByUid(objectUid: string): CelestialObject {
    const obj = this.getByUid(objectUid);
    if (!obj.isNamable) {
      throw new AppError(
        ErrorCodes.CELESTIAL_NOT_NAMABLE,
        `该星体不可用于纪念命名: ${objectUid}`,
      );
    }
    return obj;
  }
}
