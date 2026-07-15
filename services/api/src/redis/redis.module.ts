import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

/** 全局 Redis 模块：未配置 REDIS_URL 时优雅降级（noop）。 */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
