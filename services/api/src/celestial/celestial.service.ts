import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  CELESTIAL_CATALOG,
  searchCelestial,
  type CelestialObject,
  type StarSearchResult,
} from '@star/astro-data';
import { AppError, ErrorCodes } from '../common/errors/app-error';

/** 测试注入用：自定义星表目录的 DI token（生产不提供，走默认精选星表）。 */
export const CELESTIAL_CATALOG_TOKEN = Symbol('CELESTIAL_CATALOG_TOKEN');

/**
 * 天体查询服务。
 *
 * 本期数据源为 @star/astro-data 内存目录（与 web 前端共享同一份 searchCelestial 代码），
 * 零 DB 依赖、行为与前端完全一致。
 *
 * Phase 3 DB 化路径：将此类改为注入 PrismaService，search 走
 * celestial_name_alias.aliasNorm 的 pg_trgm 相似度 + searchPriority 加权，
 * getByUid 走 celestial_object 主表——接口签名不变，调用方无感。
 */
@Injectable()
export class CelestialService {
  private readonly catalog: CelestialObject[];
  private readonly byUid: Map<string, CelestialObject>;

  constructor(
    @Optional() @Inject(CELESTIAL_CATALOG_TOKEN) catalog?: CelestialObject[],
  ) {
    this.catalog = catalog ?? CELESTIAL_CATALOG;
    this.byUid = new Map(this.catalog.map((o) => [o.objectUid, o]));
  }

  /** 按查询词搜索星体（中文名/英文名/别名/拜耳/星表编号/星座）。 */
  search(q: string, limit = 8): StarSearchResult[] {
    return searchCelestial(q, { limit, catalog: this.catalog });
  }

  /** 按 objectUid 取星体，不存在抛 CELESTIAL_NOT_FOUND。 */
  getByUid(objectUid: string): CelestialObject {
    const obj = this.byUid.get(objectUid);
    if (!obj) {
      throw new AppError(ErrorCodes.CELESTIAL_NOT_FOUND, `星体不存在: ${objectUid}`);
    }
    return obj;
  }

  /** 取可命名星体：存在性 + isNamable 校验，供 MemorialService 调用。 */
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
