import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import type { ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { AgentModule } from '../agent/agent.module';
import { CelestialModule } from '../celestial/celestial.module';
import { storageFactory } from '../certificate/certificate.module';
import { STORAGE_SERVICE } from '../certificate/storage/storage.types';
import { AlbumController } from './album.controller';
import { ALBUM_QUEUE } from './album.constants';
import { AlbumProcessor } from './album.processor';
import { AlbumService } from './album.service';

const hasRedis = !!process.env.REDIS_URL;

/**
 * 纪念册模块（镜像 CertificateModule.forRoot）。
 * 有 REDIS_URL → 挂 BullMQ + Processor；无则不 import BullModule，@Optional 注入 undefined → 同步路径。
 * STORAGE_SERVICE 复用 certificate 的 storageFactory（storage 无状态，两实例无副作用），零改动 certificate。
 */
@Module({})
export class AlbumModule {
  static forRoot(): DynamicModule {
    const bull = hasRedis
      ? [
          BullModule.forRootAsync({
            useFactory: () => ({
              connection: new IORedis(process.env.REDIS_URL!, {
                maxRetriesPerRequest: null,
              }) as unknown as ConnectionOptions,
            }),
          }),
          BullModule.registerQueue({ name: ALBUM_QUEUE }),
        ]
      : [];
    const bullProviders = hasRedis ? [AlbumProcessor] : [];

    return {
      module: AlbumModule,
      imports: [CelestialModule, AgentModule, ...bull],
      controllers: [AlbumController],
      providers: [
        AlbumService,
        { provide: STORAGE_SERVICE, useFactory: storageFactory },
        ...bullProviders,
      ],
      exports: [AlbumService],
    };
  }
}
