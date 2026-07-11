import type {
  LlmCompletionParams,
  LlmCompletionResult,
  LlmProvider,
} from './llm-provider.types';

/**
 * 通用降级 provider：无 LLM 时回显最后一条 user 内容（防误用）。
 * 分场景来信模板由具体 skill（CosmicLetterSkill）自持——skill 知道 occasion，模板是其私有知识。
 */
export class TemplateProvider implements LlmProvider {
  readonly kind = 'template' as const;
  readonly modelName = 'template';

  isAvailable(): boolean {
    return true;
  }

  async complete(params: LlmCompletionParams): Promise<LlmCompletionResult> {
    const last = params.messages.at(-1)?.content ?? '';
    return { text: last, modelName: this.modelName };
  }
}
