import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import IORedis, { Redis } from 'ioredis';

export type RedisStatus = 'up' | 'down' | 'skipped';

/**
 * Redis 封装：REDIS_URL 未配置时整体降级为 noop（status = 'skipped'）。
 * 本期无业务消费者，仅 health 端点上报状态；Phase 3 BullMQ 复用该 client 配置。
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis | null = null;
  private status: RedisStatus = 'skipped';

  async onModuleInit(): Promise<void> {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.status = 'skipped';
      return;
    }
    this.client = new IORedis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => (times > 3 ? null : 1000),
    });
    // 避免未捕获 error 事件导致进程退出
    this.client.on('error', () => undefined);
    try {
      await this.client.connect();
      this.status = 'up';
    } catch (e) {
      Logger.warn(`Redis 连接失败，相关能力降级：${(e as Error).message}`, 'RedisService');
      this.status = 'down';
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit().catch(() => this.client?.disconnect());
    }
  }

  getStatus(): RedisStatus {
    return this.status;
  }

  getClient(): Redis | null {
    return this.client;
  }
}
