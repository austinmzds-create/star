import { Controller, Get, Param, Query } from '@nestjs/common';
import type { CelestialObject, PhysicalProfile } from '@star/astro-data';
import { sourceKeyOf } from '../data-source/data-source.constants';
import { CelestialService, type EphemerisInfo } from './celestial.service';
import { parseAtParam } from './dto/at-param';
import { GetCelestialQuery } from './dto/get-celestial.query';
import { SearchCelestialQuery } from './dto/search-celestial.query';

/** 天体查询接口：搜索 + 详情。星历天体（行星/日月）坐标按 ?at= 时刻实时计算。 */
@Controller('celestial')
export class CelestialController {
  constructor(private readonly celestial: CelestialService) {}

  /**
   * GET /api/celestial/search?q=&limit=&at= —— 注意：必须先于 :objectUid 路由声明。
   * Phase 9C 溯源：每个命中项透出 sourceKey（data_source.key，来源徽章用；未知批次省略）。
   */
  @Get('search')
  search(@Query() query: SearchCelestialQuery) {
    const at = parseAtParam(query.at);
    const items = this.celestial.search(query.q, query.limit ?? 8, at).map((r) => {
      const sourceKey = sourceKeyOf(r.object.sourceCatalog);
      return { ...r, ...(sourceKey ? { sourceKey } : {}) };
    });
    return { query: query.q, items, count: items.length };
  }

  /**
   * GET /api/celestial/:objectUid?at= —— 星历天体响应额外带 ephemeris 实时坐标块（月亮含月相）；
   * 恒星/DSO 额外带 encyclopedia 百科档案块（search/listAll 不带，省载荷）。
   * Phase 9C 溯源：响应带 sourceKey（data_source.key）——来源徽章据此打 GET /api/v1/data-sources
   * 取机构/许可/致谢句原文；sourceCatalog 批次号未登记时省略（绝不猜测来源）。
   */
  @Get(':objectUid')
  getByUid(
    @Param('objectUid') objectUid: string,
    @Query() query: GetCelestialQuery,
  ): {
    object: CelestialObject;
    sourceKey?: string;
    ephemeris?: EphemerisInfo;
    encyclopedia?: PhysicalProfile;
  } {
    const at = parseAtParam(query.at);
    const object = this.celestial.getByUid(objectUid, at);
    const ephemeris = this.celestial.getEphemerisInfo(objectUid, at);
    const encyclopedia = this.celestial.getEncyclopedia(objectUid);
    const sourceKey = sourceKeyOf(object.sourceCatalog);
    return {
      object,
      ...(sourceKey ? { sourceKey } : {}),
      ...(ephemeris ? { ephemeris } : {}),
      ...(encyclopedia ? { encyclopedia } : {}),
    };
  }
}
