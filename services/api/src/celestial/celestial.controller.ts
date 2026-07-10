import { Controller, Get, Param, Query } from '@nestjs/common';
import { CelestialService } from './celestial.service';
import { SearchCelestialQuery } from './dto/search-celestial.query';

/** 天体查询接口：搜索 + 详情。 */
@Controller('celestial')
export class CelestialController {
  constructor(private readonly celestial: CelestialService) {}

  /** GET /api/celestial/search?q=&limit= —— 注意：必须先于 :objectUid 路由声明。 */
  @Get('search')
  search(@Query() query: SearchCelestialQuery) {
    const items = this.celestial.search(query.q, query.limit ?? 8);
    return { query: query.q, items, count: items.length };
  }

  /** GET /api/celestial/:objectUid */
  @Get(':objectUid')
  getByUid(@Param('objectUid') objectUid: string) {
    return { object: this.celestial.getByUid(objectUid) };
  }
}
