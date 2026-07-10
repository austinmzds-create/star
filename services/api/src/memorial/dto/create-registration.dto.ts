import { OccasionType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';

/**
 * 按 Unicode 码点计数的长度校验装饰器。
 * class-validator 的 @Length 按 UTF-16 code unit 计，40 个含 emoji 的字符会被误判，
 * 因此用 Array.from(value).length（码点计数，emoji/生僻字按 1 个字计）。
 */
export function IsCodepointLength(
  min: number,
  max: number,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isCodepointLength',
      target: object.constructor,
      propertyName: propertyName as string,
      constraints: [min, max],
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          const len = Array.from(value).length;
          return len >= min && len <= max;
        },
        defaultMessage(): string {
          return `长度需为 ${min}-${max} 个字符（按 Unicode 码点计）`;
        },
      },
    });
  };
}

/**
 * 'YYYY-MM-DD' 日历日期校验：格式 + 语义（2026-13-40 之类的假日期一并拒绝）。
 */
export function IsCalendarDate(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isCalendarDate',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
          const [y, m, d] = value.split('-').map(Number) as [number, number, number];
          const date = new Date(Date.UTC(y, m - 1, d));
          // Date 会把 13 月/40 日自动进位，回读比对可识别假日期
          return (
            date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
          );
        },
        defaultMessage(): string {
          return '纪念日期格式应为 YYYY-MM-DD 且为有效日期';
        },
      },
    });
  };
}

/** POST /api/memorial/registrations 请求体。 */
export class CreateRegistrationDto {
  @IsString()
  @IsNotEmpty({ message: 'starObjectUid 不能为空' })
  starObjectUid!: string;

  /** 1-40 个 Unicode 码点（emoji/生僻字按 1 个字计）。 */
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsCodepointLength(1, 40, { message: '纪念名需为 1-40 个字符' })
  memorialName!: string;

  @IsEnum(OccasionType, { message: '纪念场景不在允许范围内' })
  occasionType!: OccasionType;

  /** 'YYYY-MM-DD'，可选 */
  @IsOptional()
  @IsCalendarDate({ message: '纪念日期格式应为 YYYY-MM-DD 且为有效日期' })
  memorialDate?: string;

  @IsOptional()
  @IsString()
  @IsCodepointLength(0, 140, { message: '想说的话不能超过 140 字' })
  blessingText?: string;

  @IsOptional()
  @IsString()
  @IsCodepointLength(0, 2000, { message: '故事文本不能超过 2000 字' })
  storyText?: string;

  @IsOptional()
  @IsEmail({}, { message: '联系邮箱格式不正确' })
  contactEmail?: string;
}
