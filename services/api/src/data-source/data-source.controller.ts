import { Controller, Get } from '@nestjs/common';
import { DataSourceService, type DataSourcesResponse } from './data-source.service';

/**
 * 数据来源接口（跨域契约）：GET /api/v1/data-sources —— 全量溯源表，
 * 「数据来源与版本」页与天体卡来源徽章弹层消费。
 * 全局前缀 /api 由 main.ts 设置，这里只声明 v1 段。
 */
@Controller('v1')
export class DataSourceController {
  constructor(private readonly dataSources: DataSourceService) {}

  @Get('data-sources')
  async listAll(): Promise<DataSourcesResponse> {
    return this.dataSources.listAll();
  }
}
