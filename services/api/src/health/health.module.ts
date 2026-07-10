import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/** 健康检查模块（无 service，controller 直接注入全局 Prisma/Redis）。 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
