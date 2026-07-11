import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

/** 后台审核模块。PrismaService 由全局 PrismaModule 提供，无需在此 import。 */
@Module({
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
})
export class AdminModule {}
