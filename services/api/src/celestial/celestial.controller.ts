import { Controller, Get, Param, Query } from '@nestjs/common';
import type { CelestialObject } from '@star/astro-data';
import { CelestialService, type EphemerisInfo } from './celestial.service';
import { parseAtParam } from './dto/at-param';
import { GetCelestialQuery } from './dto/get-celestial.query';
import { SearchCelestialQuery } from './dto/search-celestial.query';

/** 天体查询接口：搜索 + 详情。星历天体（行星/日月）坐标按 ?at= 时刻实时计算。 */
@Controller('celestial')
export class CelestialController {
  constructor(private readonly celestial: CelestialService) {}

  /** GET /api/celestial/search?q=&limit=&at= —— 注意：必须先于 :objectUid 路由声明。 */
  @Get('search')
  search(@Query() query: SearchCelestialQuery) {
    const at = parseAtParam(query.at);
    const items = this.celestial.search(query.q, query.limit ?? 8, at);
    return { query: query.q, items, count: items.length };
  }

  /** GET /api/celestial/:objectUid?at= —— 星历天体响应额外带 ephemeris 实时坐标块（月亮含月相）。 */
  @Get(':objectUid')
  getByUid(
    @Param('objectUid') objectUid: string,
    @Query() query: GetCelestialQuery,
  ): { object: CelestialObject; ephemeris?: EphemerisInfo } {
    const at = parseAtParam(query.at);
    const object = this.celestial.getByUid(objectUid, at);
    const ephemeris = this.celestial.getEphemerisInfo(objectUid, at);
    return ephemeris ? { object, ephemeris } : { object };
  }
}
