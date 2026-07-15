import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Logger, Module } from '@nestjs/common';
import type { ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { CelestialModule } from '../celestial/celestial.module';
import { AssetController } from './asset.controller';
import { CERT_QUEUE } from './certificate.constants';
import { CertificateController } from './certificate.controller';
import { CertificateProcessor } from './certificate.processor';
import { CertificateService } from './certificate.service';
import { LocalStorage } from './storage/local-storage';
import { OssStorage } from './storage/oss-storage';
import { STORAGE_SERVICE, type StorageService } from './storage/storage.types';

/** OSS 占位值检测：占位/含 placeholder 视为未配置。 */
function isPlaceholder(v: string | undefined): boolean {
  if (!v) return true;
  const s = v.trim();
  if (s === '') return true;
  return (
    s === 'your-access-key-id' ||
    s === 'your-access-key-secret' ||
    s.includes('placeholder')
  );
}

/**
 * 存储工厂：STORAGE_DRIVER 显式优先；auto 时配了有效 OSS 用 OSS，否则本地。
 * OSS 构造失败（ali-oss 未安装等）→ 落回 LocalStorage 并 warn。
 * 本地容器无 OSS 配置或占位值 → 必然 LocalStorage。
 */
export function storageFactory(): StorageService {
  const driver = process.env.STORAGE_DRIVER ?? 'auto';
  if (driver === 'local' || driver === 'dataurl') {
    return new LocalStorage();
  }
  const ossConfigured =
    !isPlaceholder(process.env.OSS_REGION) &&
    !isPlaceholder(process.env.OSS_BUCKET) &&
    !isPlaceholder(process.env.OSS_ACCESS_KEY_ID) &&
    !isPlaceholder(process.env.OSS_ACCESS_KEY_SECRET);
  if (driver === 'oss' || (driver === 'auto' && ossConfigured)) {
    try {
      return new OssStorage();
    } catch (e) {
      Logger.warn(`OSS 初始化失败，降级本地存储: ${(e as Error).message}`, 'CertificateModule');
      return new LocalStorage();
    }
  }
  return new LocalStorage();
}

const hasRedis = !!process.env.REDIS_URL;

/**
 * 证书模块（global 动态模块，app.module 注册一次）。
 * 有 REDIS_URL → 挂 BullMQ + Processor；无则完全不 import BullModule，@Optional 注入得 undefined → 同步路径。
 */
@Module({})
export class CertificateModule {
  static forRoot(): DynamicModule {
    const bullImports = hasRedis
      ? [
          BullModule.forRootAsync({
            useFactory: () => ({
              // BullMQ 要求 maxRetriesPerRequest: null。cast 规避 monorepo 内 ioredis 版本双份的类型偏差。
              connection: new IORedis(process.env.REDIS_URL!, {
                maxRetriesPerRequest: null,
              }) as unknown as ConnectionOptions,
            }),
          }),
          BullModule.registerQueue({ name: CERT_QUEUE }),
        ]
      : [];
    const bullProviders = hasRedis ? [CertificateProcessor] : [];

    return {
      module: CertificateModule,
      global: true,
      imports: [CelestialModule, ...bullImports],
      controllers: [CertificateController, AssetController],
      providers: [
        CertificateService,
        { provide: STORAGE_SERVICE, useFactory: storageFactory },
        ...bullProviders,
      ],
      exports: [CertificateService],
    };
  }
}
