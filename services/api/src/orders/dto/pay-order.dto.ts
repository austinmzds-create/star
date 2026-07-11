import { IsIn, IsOptional } from 'class-validator';

/** POST /api/orders/:orderNo/pay 请求体（可选）。 */
export class PayOrderDto {
  /** mock 支付结果，默认 success。 */
  @IsOptional()
  @IsIn(['success', 'fail'])
  outcome?: 'success' | 'fail';
}
