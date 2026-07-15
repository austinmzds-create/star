import { OccasionType } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** POST /api/agent/skills/cosmic-letter/run 请求体。 */
export class CosmicLetterDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  starNameZh!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  constellationZh!: string;

  @IsEnum(OccasionType)
  occasion!: OccasionType;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  memorialName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  relationTo?: string;

  @IsOptional()
  @IsIn(['gentle', 'warm', 'solemn', 'hopeful'])
  tone?: 'gentle' | 'warm' | 'solemn' | 'hopeful';
}
