import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { llmProviderFactory } from './llm/provider.factory';
import { SkillRegistry } from './skill.registry';

/** Agent 模块：技能注册表 + LLM provider（工厂按 ANTHROPIC_API_KEY 选真调/模板）。 */
@Module({
  controllers: [AgentController],
  providers: [AgentService, SkillRegistry, llmProviderFactory],
  exports: [AgentService],
})
export class AgentModule {}
