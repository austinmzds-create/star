import Anthropic from '@anthropic-ai/sdk';
import type {
  LlmCompletionParams,
  LlmCompletionResult,
  LlmProvider,
} from './llm-provider.types';

/** 创意文案模型（宇宙来信用，任务书指定）。 */
const MODEL_SONNET = 'claude-sonnet-5';

/**
 * Anthropic 真调 provider。无 key → isAvailable() false（不 new SDK）。
 * complete 只负责「能不能调通」；调用失败的回退决策在 CosmicLetterSkill.run 层（catch → 模板）。
 */
export class AnthropicProvider implements LlmProvider {
  readonly kind = 'llm' as const;
  readonly modelName = MODEL_SONNET;
  private readonly client: Anthropic | null;

  constructor(apiKey: string | undefined) {
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  async complete(params: LlmCompletionParams): Promise<LlmCompletionResult> {
    if (!this.client) {
      throw new Error('AnthropicProvider 未配置 API key');
    }
    const resp = await this.client.messages.create({
      model: this.modelName,
      max_tokens: params.maxTokens ?? 512,
      temperature: params.temperature ?? 0.8,
      system: params.system,
      messages: params.messages,
    });
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!text) throw new Error('Anthropic 返回空内容');
    return { text, modelName: this.modelName };
  }
}
