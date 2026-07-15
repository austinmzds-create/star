import { RegistrationStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

/** GET /api/admin/registrations 查询参数。 */
export class ListRegistrationsQuery {
  /** 可选状态过滤；缺省返回全部状态。 */
  @IsOptional()
  @IsEnum(RegistrationStatus, { message: 'status 不在允许范围内' })
  status?: RegistrationStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page 必须为整数' })
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'pageSize 必须为整数' })
  @Min(1)
  @Max(100)
  pageSize: number = 20;
}
