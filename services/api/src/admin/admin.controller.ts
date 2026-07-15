import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { ListAgentTasksQuery } from './dto/list-agent-tasks.query';
import { ListRegistrationsQuery } from './dto/list-registrations.query';
import { RejectRegistrationDto } from './dto/reject-registration.dto';

/** 后台审核接口，全部经 AdminGuard（x-admin-token）鉴权。前缀最终为 /api/admin。 */
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /** GET /api/admin/registrations?status=&page=&pageSize= */
  @Get('registrations')
  listRegistrations(@Query() query: ListRegistrationsQuery) {
    return this.admin.listRegistrations(query);
  }

  /** POST /api/admin/registrations/:registrationNo/approve */
  @Post('registrations/:registrationNo/approve')
  approve(@Param('registrationNo') registrationNo: string) {
    return this.admin.approve(registrationNo);
  }

  /** POST /api/admin/registrations/:registrationNo/reject */
  @Post('registrations/:registrationNo/reject')
  reject(
    @Param('registrationNo') registrationNo: string,
    @Body() dto: RejectRegistrationDto,
  ) {
    return this.admin.reject(registrationNo, dto.reason);
  }

  /** GET /api/admin/agent-tasks?status=&page=&pageSize= */
  @Get('agent-tasks')
  listAgentTasks(@Query() query: ListAgentTasksQuery) {
    return this.admin.listAgentTasks(query);
  }
}
