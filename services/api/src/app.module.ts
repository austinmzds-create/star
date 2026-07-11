import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AgentModule } from './agent/agent.module';
import { AlbumModule } from './album/album.module';
import { CelestialModule } from './celestial/celestial.module';
import { CertificateModule } from './certificate/certificate.module';
import { HealthModule } from './health/health.module';
import { MemorialModule } from './memorial/memorial.module';
import { OrdersModule } from './orders/orders.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

/**
 * 应用根模块。
 * 配置直接读 process.env（本期不引 @nestjs/config 以减少依赖，Phase 3 可替换）。
 */
@Module({
  imports: [
    PrismaModule,
    RedisModule,
    HealthModule,
    CelestialModule,
    CertificateModule.forRoot(),
    MemorialModule,
    AgentModule,
    AlbumModule.forRoot(),
    OrdersModule,
    AdminModule,
  ],
})
export class AppModule {}
