import { OccasionType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { IsCalendarDate, IsCodepointLength } from './create-registration.dto';

/** 情侣对中的单颗星单元。 */
export class CoupleUnitDto {
  @IsString()
  @IsNotEmpty({ message: 'starObjectUid 不能为空' })
  starObjectUid!: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsCodepointLength(1, 40, { message: '纪念名需为 1-40 个字符' })
  memorialName!: string;

  @IsOptional()
  @IsString()
  @IsCodepointLength(0, 140, { message: '想说的话不能超过 140 字' })
  blessingText?: string;
}

/** POST /api/memorial/couple 请求体。 */
export class CreateCoupleDto {
  @IsDefined({ message: '缺少第一颗星 starA' })
  @IsObject({ message: 'starA 必须为对象' })
  @ValidateNested()
  @Type(() => CoupleUnitDto)
  starA!: CoupleUnitDto;

  @IsDefined({ message: '缺少第二颗星 starB' })
  @IsObject({ message: 'starB 必须为对象' })
  @ValidateNested()
  @Type(() => CoupleUnitDto)
  starB!: CoupleUnitDto;

  /** 场景，缺省 LOVE（情侣纪念）。两颗星共享。 */
  @IsOptional()
  @IsEnum(OccasionType, { message: '纪念场景不在允许范围内' })
  occasionType?: OccasionType;

  /** 关系/场景标签，如 '恋人'/'夫妻'，<=40 字，可选。 */
  @IsOptional()
  @IsString()
  @IsCodepointLength(0, 40, { message: '关系标签不能超过 40 字' })
  relationLabel?: string;

  /** 合并祝福语，<=140 字，可选。 */
  @IsOptional()
  @IsString()
  @IsCodepointLength(0, 140, { message: '祝福语不能超过 140 字' })
  coupleBlessing?: string;

  /** 纪念日期 YYYY-MM-DD，两颗星共享，可选。 */
  @IsOptional()
  @IsCalendarDate({ message: '纪念日期格式应为 YYYY-MM-DD 且为有效日期' })
  memorialDate?: string;

  @IsOptional()
  @IsEmail({}, { message: '联系邮箱格式不正确' })
  contactEmail?: string;
}
