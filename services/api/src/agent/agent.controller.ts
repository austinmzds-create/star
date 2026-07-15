import { Body, Controller, Post } from '@nestjs/common';
import { AgentService } from './agent.service';
import { CosmicLetterDto } from './dto/cosmic-letter.dto';

/** Agent 技能对外接口。前缀 api → 实际路径 /api/agent/...。 */
@Controller('agent')
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  /**
   * POST /api/agent/skills/cosmic-letter/run
   * 返回 { letter, mode, taskNo }。
   */
  // TODO(Phase3): 接入 RateLimitGuard（Redis 令牌桶：按 IP + 可选 userId，cosmic-letter 每分钟 5 次 / 每日 50 次；Redis skipped/down 时 fail-open 放行）。
  @Post('skills/cosmic-letter/run')
  async runCosmicLetter(@Body() dto: CosmicLetterDto) {
    const r = await this.agent.runSkill<{ letter: string }>('cosmic-letter', dto);
    return { letter: r.output.letter, mode: r.mode, taskNo: r.taskNo };
  }
}
