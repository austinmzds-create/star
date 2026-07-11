import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** POST /api/admin/registrations/:registrationNo/reject 请求体。 */
export class RejectRegistrationDto {
  /** 拒绝原因（落 reviewNote，内部字段）。 */
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty({ message: '拒绝原因 reason 不能为空' })
  @MaxLength(200, { message: '拒绝原因不能超过 200 字' })
  reason!: string;
}
