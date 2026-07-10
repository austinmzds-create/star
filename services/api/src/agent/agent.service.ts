import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Agent 任务服务（占位）：AI 技能编排的持久化载体。
 * Phase 3 接 BullMQ：createTask 同时 enqueue（Redis），worker 消费后回写 outputJson/status。
 */
@Injectable()
export class AgentService {
  constructor(private readonly prisma: PrismaService) {}

  /** 创建一条 QUEUED 状态的技能任务，如 'certificate.copywriting' | 'story.generate'。 */
  async createTask(skillCode: string, inputJson: unknown, registrationId?: string) {
    this.prisma.ensureAvailable();
    return this.prisma.agentTask.create({
      data: {
        skillCode,
        inputJson: inputJson as object,
        ...(registrationId ? { registrationId } : {}),
      },
    });
  }
}
