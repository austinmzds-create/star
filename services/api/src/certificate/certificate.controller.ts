import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CertificateService } from './certificate.service';

/**
 * 证书接口。前缀 api → 实际路径 /api/memorial/registrations/:registrationNo/certificate。
 * 与 MemorialController 共享 'memorial' 前缀不同路径（Nest 允许多 controller 共享前缀）。
 */
@Controller('memorial')
export class CertificateController {
  constructor(private readonly cert: CertificateService) {}

  /** POST 触发证书生成（幂等）。异步入队返回 202；同步降级/已就绪同样走此响应形状。 */
  @Post('registrations/:registrationNo/certificate')
  @HttpCode(202)
  trigger(@Param('registrationNo') registrationNo: string) {
    return this.cert.enqueueOrRun(registrationNo);
  }

  /** GET 取证书状态与 URL（未触发时 status PENDING、url null）。 */
  @Get('registrations/:registrationNo/certificate')
  status(@Param('registrationNo') registrationNo: string) {
    return this.cert.getByRegistrationNo(registrationNo);
  }
}
