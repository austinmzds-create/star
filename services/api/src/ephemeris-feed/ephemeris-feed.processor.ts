import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { EphemerisFeedService } from './ephemeris-feed.service';
import { FEED_QUEUE, JOB_REFRESH_MINOR_BODIES, JOB_REFRESH_TLE } from './feed.constants';

/**
 * 星历订阅 BullMQ worker：仅在有 Redis 时注册（模式同 CertificateProcessor）。
 * 抛错即触发 BullMQ 重试；重试期间端点继续用最后成功批次服务（优雅降级）。
 */
@Processor(FEED_QUEUE)
export class EphemerisFeedProcessor extends WorkerHost {
  private readonly logger = new Logger(EphemerisFeedProcessor.name);

  constructor(private readonly feed: EphemerisFeedService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    this.logger.log(`处理星历刷新 job：${job.name}`);
    switch (job.name) {
      case JOB_REFRESH_MINOR_BODIES:
        return this.feed.refreshMinorBodies();
      case JOB_REFRESH_TLE:
        // repeatable 间隔本身已 ≥6h，force 跳过进程内节流（节流是防手工高频误触）
        return this.feed.refreshTle({ force: true });
      default:
        this.logger.warn(`未知 job：${job.name}（忽略）`);
        return null;
    }
  }
}
