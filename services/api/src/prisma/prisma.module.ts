import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** 全局 Prisma 模块：所有需要 DB 的模块直接注入 PrismaService。 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
