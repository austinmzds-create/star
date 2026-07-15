import type { LlmProvider } from './llm/llm-provider.types';

/** Skill 执行上下文：由 AgentService 注入，Skill 不直接持有 Nest DI。 */
export interface SkillContext {
  /** 选定的 LLM provider（Anthropic 或 Template 降级）。 */
  readonly llm: LlmProvider;
}

/** Skill 产出：内容 + 元信息。mode 用于前端提示「AI 生成 / 模板生成」。 */
export interface SkillResult<TOutput = unknown> {
  readonly output: TOutput;
  /** 'llm' = 真调 Anthropic 成功；'template' = 无 key 或调用失败走模板。 */
  readonly mode: 'llm' | 'template';
  /** 实际模型名，落 agent_task.modelName。 */
  readonly modelName: string;
}

/**
 * Skill 契约：纯内容生产者。
 * 设计红线：Skill 绝不写核心业务表（memorial/certificate/order 等），只返回内容；
 * 持久化仅由 AgentService 写 agent_task（产出物表）。
 */
export interface Skill<TInput = unknown, TOutput = unknown> {
  /** 稳定技能码，如 'cosmic-letter'。注册表主键、落库 skillCode。 */
  readonly code: string;
  /**
   * 输入校验+收窄：把控制器/内部调用传入的 unknown 解析为强类型 TInput。
   * 校验失败必须抛 AppError(VALIDATION_FAILED)。同时作为「inputSchema」的运行时体现。
   */
  parseInput(raw: unknown): Promise<TInput>;
  /** 执行技能，返回内容 + 元信息。允许读只读数据（如星表），禁止写业务表。 */
  run(input: TInput, ctx: SkillContext): Promise<SkillResult<TOutput>>;
}

/** 注册表契约。 */
export interface ISkillRegistry {
  get(code: string): Skill | undefined;
  has(code: string): boolean;
  list(): string[];
}
