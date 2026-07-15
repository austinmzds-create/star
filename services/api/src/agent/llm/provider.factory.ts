import { Logger } from '@nestjs/common';
import { AnthropicProvider } from './anthropic.provider';
import { LLM_PROVIDER, type LlmProvider } from './llm-provider.types';
import { OpenAiCompatibleProvider } from './openai.provider';
import { TemplateProvider } from './template.provider';

/**
 * 启动期选 provider，优先级：
 *   1. OpenAI 兼容网关（OPENAI_API_KEY + OPENAI_BASE_URL）——支持自建/代理网关（如 codex gpt-5.5）
 *   2. Anthropic（ANTHROPIC_API_KEY）→ claude-sonnet-5
 *   3. Template 降级
 * 运行期调用失败的二次回退在 CosmicLetterSkill.run 内处理（catch → 模板）。
 */
export function createLlmProvider(): LlmProvider {
  const openaiKey = process.env.OPENAI_API_KEY;
  const openaiBase = process.env.OPENAI_BASE_URL;
  if (openaiKey && openaiBase) {
    const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
    Logger.log(`LLM provider = OpenAI 兼容(${model} @ ${openaiBase})`, 'LlmProvider');
    return new OpenAiCompatibleProvider({ baseUrl: openaiBase, apiKey: openaiKey, model });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    Logger.log('LLM provider = Anthropic(claude-sonnet-5)', 'LlmProvider');
    return new AnthropicProvider(anthropicKey);
  }

  Logger.warn('未配置 LLM（OpenAI/Anthropic）密钥，宇宙来信降级为模板生成', 'LlmProvider');
  return new TemplateProvider();
}

export const llmProviderFactory = {
  provide: LLM_PROVIDER,
  useFactory: createLlmProvider,
};
