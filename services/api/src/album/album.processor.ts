import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { ALBUM_QUEUE } from './album.constants';
import { AlbumService } from './album.service';

/** 纪念册 BullMQ worker：仅在有 Redis 时注册。rethrow=true 触发 BullMQ 重试。 */
@Processor(ALBUM_QUEUE)
export class AlbumProcessor extends WorkerHost {
  private readonly logger = new Logger(AlbumProcessor.name);

  constructor(private readonly svc: AlbumService) {
    super();
  }

  async process(job: Job<{ albumRecordId: string; registrationId: string }>): Promise<unknown> {
    this.logger.log(`处理纪念册 job ${job.id}: ${job.data.albumRecordId}`);
    return this.svc.generateAndPersist(job.data.albumRecordId, job.data.registrationId, {
      rethrow: true,
    });
  }
}
