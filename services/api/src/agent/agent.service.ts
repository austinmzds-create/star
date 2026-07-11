import { Inject, Injectable, Logger } from '@nestjs/common';
import { AgentTaskStatus } from '@prisma/client';
import { AppError, ErrorCodes } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { LLM_PROVIDER, type LlmProvider } from './llm/llm-provider.types';
import { SkillRegistry } from './skill.registry';
import type { SkillResult } from './skill.types';

export interface RunSkillResult<T = unknown> {
  /** = agentTask.id（本期无独立 taskNo 字段）；DB 不可用时为 'unpersisted'。 */
  taskNo: string;
  output: T;
  mode: 'llm' | 'template';
}

/**
 * Agent 任务服务：同步执行 skill 并把过程落 agent_task（产出物表）。
 * Phase 3 接 BullMQ：可把 runSkill 拆为 enqueue + worker，本期同步。
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: SkillRegistry,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  /** 创建一条 QUEUED 状态的技能任务（保留：内部编排/Phase 3 队列用）。 */
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

  /**
   * 同步执行一个 skill，并把过程落 agent_task。
   * DB 不可用/落库失败：仍执行 skill 返回内容（内容不依赖 DB），落库降级为跳过并 warn，
   * taskNo 返回 'unpersisted'——保证用户能拿到来信预览（商业价值优先）。
   */
  async runSkill<T = unknown>(skillCode: string, rawInput: unknown): Promise<RunSkillResult<T>> {
    const skill = this.registry.getOrThrow(skillCode);
    const input = await skill.parseInput(rawInput);

    const started = Date.now();
    const task = await this.tryCreateRunning(skillCode, input);

    try {
      const result: SkillResult = await skill.run(input, { llm: this.llm });
      const durationMs = Date.now() - started;
      await this.tryFinish(task?.id, {
        status: AgentTaskStatus.SUCCEEDED,
        outputJson: result.output as object,
        modelName: result.modelName,
        durationMs,
      });
      return { taskNo: task?.id ?? 'unpersisted', output: result.output as T, mode: result.mode };
    } catch (e) {
      const durationMs = Date.now() - started;
      const message = e instanceof Error ? e.message : String(e);
      await this.tryFinish(task?.id, {
        status: AgentTaskStatus.FAILED,
        error: message.slice(0, 500),
        durationMs,
      });
      if (e instanceof AppError) throw e;
      this.logger.error(`skill ${skillCode} 执行失败: ${message}`);
      throw new AppError(ErrorCodes.SKILL_FAILED, '技能执行失败，请稍后重试');
    }
  }

  private async tryCreateRunning(skillCode: string, input: unknown) {
    if (!this.prisma.isAvailable) {
      this.logger.warn(`DB 不可用，skill ${skillCode} 任务不落库`);
      return null;
    }
    try {
      return await this.prisma.agentTask.create({
        data: { skillCode, inputJson: input as object, status: AgentTaskStatus.RUNNING },
      });
    } catch (e) {
      this.logger.warn(`agent_task 落库失败（忽略，不阻断）: ${(e as Error).message}`);
      return null;
    }
  }

  private async tryFinish(id: string | undefined, data: Record<string, unknown>): Promise<void> {
    if (!id) return;
    await this.prisma.agentTask
      .update({ where: { id }, data })
      .catch((e) => this.logger.warn(`agent_task 回写失败: ${(e as Error).message}`));
  }
}
