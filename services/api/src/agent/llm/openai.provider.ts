import type {
  LlmCompletionParams,
  LlmCompletionResult,
  LlmProvider,
} from './llm-provider.types';

/**
 * OpenAI 兼容 provider（Chat Completions 协议）。
 *
 * 适配任意兼容 OpenAI `/chat/completions` 的网关（如自建代理、krill/codex 网关等）：
 * 只要提供 baseUrl（形如 https://host/v1，末尾不含 /chat/completions）+ apiKey + model。
 * 用内置 fetch，不引第三方 SDK。
 *
 * complete 只负责「能不能调通」；失败时抛错，由 CosmicLetterSkill.run 层 catch → 模板兜底。
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly kind = 'llm' as const;
  readonly modelName: string;
  private readonly baseUrl: string | null;
  private readonly apiKey: string | null;

  constructor(opts: { baseUrl?: string; apiKey?: string; model?: string }) {
    // 去掉末尾斜杠，统一拼 /chat/completions
    this.baseUrl = opts.baseUrl ? opts.baseUrl.replace(/\/+$/, '') : null;
    this.apiKey = opts.apiKey ?? null;
    this.modelName = opts.model ?? 'gpt-4o-mini';
  }

  isAvailable(): boolean {
    return this.baseUrl !== null && this.apiKey !== null;
  }

  async complete(params: LlmCompletionParams): Promise<LlmCompletionResult> {
    if (!this.baseUrl || !this.apiKey) {
      throw new Error('OpenAiCompatibleProvider 未配置 baseUrl/apiKey');
    }

    // system 作为首条 system 消息，其余对齐 OpenAI messages
    const messages = [
      { role: 'system' as const, content: params.system },
      ...params.messages,
    ];

    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.modelName,
        messages,
        max_tokens: params.maxTokens ?? 512,
        temperature: params.temperature ?? 0.8,
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`OpenAI 兼容端点返回 ${resp.status}: ${detail.slice(0, 200)}`);
    }

    const data = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text) throw new Error('OpenAI 兼容端点返回空内容');
    return { text, modelName: this.modelName };
  }
}
