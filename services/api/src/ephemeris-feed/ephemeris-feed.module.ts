import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import type { ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { EphemerisFeedController } from './ephemeris-feed.controller';
import { EphemerisFeedProcessor } from './ephemeris-feed.processor';
import { EphemerisFeedService } from './ephemeris-feed.service';
import { FEED_QUEUE } from './feed.constants';

const hasRedis = !!process.env.REDIS_URL;

/**
 * 星历订阅模块（镜像 CertificateModule.forRoot 的 BullMQ conditional 模式）。
 * 有 REDIS_URL → 挂 BullMQ repeatable job + Processor；
 * 无则不 import BullModule，@Optional 注入 undefined → service 退化为进程内定时器
 * （启动先拉一次 + setInterval，见 EphemerisFeedService.onApplicationBootstrap）。
 */
@Module({})
export class EphemerisFeedModule {
  static forRoot(): DynamicModule {
    const bull = hasRedis
      ? [
          BullModule.forRootAsync({
            useFactory: () => ({
              // BullMQ 要求 maxRetriesPerRequest: null。cast 规避 monorepo 内 ioredis 版本双份的类型偏差。
              connection: new IORedis(process.env.REDIS_URL!, {
                maxRetriesPerRequest: null,
              }) as unknown as ConnectionOptions,
            }),
          }),
          BullModule.registerQueue({ name: FEED_QUEUE }),
        ]
      : [];
    const bullProviders = hasRedis ? [EphemerisFeedProcessor] : [];

    return {
      module: EphemerisFeedModule,
      imports: [...bull],
      controllers: [EphemerisFeedController],
      providers: [EphemerisFeedService, ...bullProviders],
      exports: [EphemerisFeedService],
    };
  }
}
