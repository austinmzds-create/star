import { Logger } from '@nestjs/common';
import { AnthropicProvider } from './anthropic.provider';
import { LLM_PROVIDER, type LlmProvider } from './llm-provider.types';
import { TemplateProvider } from './template.provider';

/**
 * 启动期选 provider：有 ANTHROPIC_API_KEY → Anthropic；否则 → Template 降级。
 * 运行期调用失败的二次回退在 CosmicLetterSkill.run 内处理（catch → 模板）。
 */
export function createLlmProvider(): LlmProvider {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    Logger.log('LLM provider = Anthropic(claude-sonnet-5)', 'LlmProvider');
    return new AnthropicProvider(key);
  }
  Logger.warn('未配置 ANTHROPIC_API_KEY，宇宙来信降级为模板生成', 'LlmProvider');
  return new TemplateProvider();
}

export const llmProviderFactory = {
  provide: LLM_PROVIDER,
  useFactory: createLlmProvider,
};
