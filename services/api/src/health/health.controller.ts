import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/** 健康端点：自身可用即 200，依赖状态放 body。 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  health() {
    return {
      status: 'ok',
      service: 'star-memorial-api',
      version: '0.1.0',
      uptimeSec: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      deps: {
        db: this.prisma.isAvailable ? 'up' : 'down',
        redis: this.redis.getStatus(),
      },
    };
  }
}
