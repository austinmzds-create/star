import { Module } from '@nestjs/common';
import { CelestialController } from './celestial.controller';
import { CelestialService } from './celestial.service';

/** 天体模块：搜索/详情，本期由 @star/astro-data 内存目录支撑。 */
@Module({
  controllers: [CelestialController],
  providers: [CelestialService],
  exports: [CelestialService],
})
export class CelestialModule {}
