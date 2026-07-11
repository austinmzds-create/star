import { IsOptional, IsString, MaxLength } from 'class-validator';

/** GET /api/celestial/:objectUid 查询参数。 */
export class GetCelestialQuery {
  /** 观测时刻（epoch 毫秒或 ISO 8601），缺省为服务端当前时刻；仅影响星历天体的实时坐标。 */
  @IsOptional()
  @IsString()
  @MaxLength(40, { message: '时间参数 at 不能超过 40 个字符' })
  at?: string;
}
