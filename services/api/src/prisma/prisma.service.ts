import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppError, ErrorCodes } from '../common/errors/app-error';

/**
 * PrismaClient 封装：启动时探测连接，失败不 crash 进程——
 * health/celestial（内存目录）仍可服务，仅需要 DB 的接口返回 503。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private available = false;

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.available = true;
    } catch (e) {
      Logger.warn(
        `数据库连接失败，纪念登记接口将返回 503：${(e as Error).message}`,
        'PrismaService',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect().catch(() => undefined);
  }

  get isAvailable(): boolean {
    return this.available;
  }

  /** 需要 DB 的服务在每个方法入口调用；无 DB 时抛业务错误而非底层 Prisma 报错。 */
  ensureAvailable(): void {
    if (!this.available) {
      throw new AppError(ErrorCodes.DB_UNAVAILABLE, '数据库暂不可用，请稍后重试');
    }
  }
}
