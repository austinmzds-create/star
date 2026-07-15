/** LLM 抽象：AnthropicProvider（真调）/ TemplateProvider（降级）两实现。 */

/** 极简对话消息（仅 user/assistant，system 走独立参数——对齐 Anthropic Messages API）。 */
export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmCompletionParams {
  system: string;
  messages: LlmMessage[];
  /** 生成上限，来信约 200 字，给 512 token 足够。 */
  maxTokens?: number;
  temperature?: number;
}

export interface LlmCompletionResult {
  text: string;
  modelName: string;
}

/**
 * LLM 抽象。kind 让上层决定 SkillResult.mode。
 */
export interface LlmProvider {
  readonly kind: 'llm' | 'template';
  readonly modelName: string;
  complete(params: LlmCompletionParams): Promise<LlmCompletionResult>;
  /** provider 是否可用（Anthropic：有 key）。 */
  isAvailable(): boolean;
}

/** DI token，对齐 CONTENT_MODERATION 范式。module 用 factory 绑定。 */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
