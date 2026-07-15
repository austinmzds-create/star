import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateCoupleDto } from './dto/create-couple.dto';
import { CreateRegistrationDto } from './dto/create-registration.dto';
import { MemorialService } from './memorial.service';

/** 纪念登记接口：创建 / 凭编号查询 / 公开纪念页 / 情侣双星。 */
@Controller('memorial')
export class MemorialController {
  constructor(private readonly memorial: MemorialService) {}

  /** POST /api/memorial/registrations（201） */
  @Post('registrations')
  create(@Body() dto: CreateRegistrationDto) {
    return this.memorial.create(dto);
  }

  /** POST /api/memorial/couple（201） */
  @Post('couple')
  createCouple(@Body() dto: CreateCoupleDto) {
    return this.memorial.createCouple(dto);
  }

  /** GET /api/memorial/couple/public/:coupleSlug */
  @Get('couple/public/:coupleSlug')
  findCouplePublic(@Param('coupleSlug') coupleSlug: string) {
    return this.memorial.findCouplePublicBySlug(coupleSlug);
  }

  /** GET /api/memorial/registrations/:registrationNo */
  @Get('registrations/:registrationNo')
  findByNo(@Param('registrationNo') registrationNo: string) {
    return this.memorial.findByRegistrationNo(registrationNo);
  }

  /** GET /api/memorial/public/:publicSlug */
  @Get('public/:publicSlug')
  findPublic(@Param('publicSlug') publicSlug: string) {
    return this.memorial.findPublicBySlug(publicSlug);
  }
}
