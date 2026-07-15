import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { CERT_QUEUE } from './certificate.constants';
import { CertificateService } from './certificate.service';

/** 证书 BullMQ worker：仅在有 Redis 时注册。薄封装，rethrow=true 触发 BullMQ 重试。 */
@Processor(CERT_QUEUE)
export class CertificateProcessor extends WorkerHost {
  private readonly logger = new Logger(CertificateProcessor.name);

  constructor(private readonly svc: CertificateService) {
    super();
  }

  async process(job: Job<{ certRecordId: string; registrationId: string }>): Promise<unknown> {
    this.logger.log(`处理证书 job ${job.id}: ${job.data.certRecordId}`);
    return this.svc.generateAndPersist(job.data.certRecordId, job.data.registrationId, {
      rethrow: true,
    });
  }
}
