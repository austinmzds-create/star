import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { AlbumService } from './album.service';

/**
 * 纪念册接口。前缀 api → /api/memorial/registrations/:registrationNo/album。
 * 与 MemorialController/CertificateController 共享 'memorial' 前缀不同路径（Nest 允许）。
 */
@Controller('memorial')
export class AlbumController {
  constructor(private readonly album: AlbumService) {}

  /** POST 触发纪念册生成（幂等）。异步入队/同步降级/已就绪同走此响应形状，202。 */
  @Post('registrations/:registrationNo/album')
  @HttpCode(202)
  trigger(@Param('registrationNo') registrationNo: string) {
    return this.album.enqueueOrRun(registrationNo);
  }

  /** GET 取纪念册状态与 URL（未触发时 status PENDING、albumUrl null）。 */
  @Get('registrations/:registrationNo/album')
  status(@Param('registrationNo') registrationNo: string) {
    return this.album.getByRegistrationNo(registrationNo);
  }
}
