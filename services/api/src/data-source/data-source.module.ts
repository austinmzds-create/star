import { Module } from '@nestjs/common';
import { DataSourceController } from './data-source.controller';
import { DataSourceService } from './data-source.service';

/** 数据来源模块：溯源主数据查询（PrismaModule 全局，无需显式 import）。 */
@Module({
  controllers: [DataSourceController],
  providers: [DataSourceService],
  exports: [DataSourceService],
})
export class DataSourceModule {}
