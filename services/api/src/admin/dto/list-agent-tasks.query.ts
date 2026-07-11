import { AgentTaskStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

/** GET /api/admin/agent-tasks 查询参数。 */
export class ListAgentTasksQuery {
  @IsOptional()
  @IsEnum(AgentTaskStatus, { message: 'status 不在允许范围内' })
  status?: AgentTaskStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;
}
