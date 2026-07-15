import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** GET /api/celestial/search 查询参数。 */
export class SearchCelestialQuery {
  @IsString()
  @IsNotEmpty({ message: '查询词 q 不能为空' })
  @MaxLength(64, { message: '查询词 q 不能超过 64 个字符' })
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit 必须为整数' })
  @Min(1)
  @Max(50)
  limit?: number;

  /** 观测时刻（epoch 毫秒或 ISO 8601），缺省为服务端当前时刻；仅影响星历天体的实时坐标。 */
  @IsOptional()
  @IsString()
  @MaxLength(40, { message: '时间参数 at 不能超过 40 个字符' })
  at?: string;
}
