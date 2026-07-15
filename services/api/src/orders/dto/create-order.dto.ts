import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** POST /api/orders 请求体。无金额字段——金额只在服务端从 SKU_CATALOG 取。 */
export class CreateOrderDto {
  @IsString()
  @IsNotEmpty({ message: 'skuCode 不能为空' })
  skuCode!: string;

  /** requiresRegistration=true 的 SKU 必填。 */
  @IsOptional()
  @IsString()
  registrationNo?: string;
}
