import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';

/** Agent 模块（占位）：本期无 controller，仅提供 AgentService 供内部编排调用。 */
@Module({
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
