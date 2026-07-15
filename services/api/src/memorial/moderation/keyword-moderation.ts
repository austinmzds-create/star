import { Injectable } from '@nestjs/common';
import type { ContentModeration, ModerationResult } from './moderation.types';

/**
 * 关键词审核占位实现：本地词表，命中违禁词 → reject，命中复审词 → review，否则 pass。
 * Phase 3 替换为阿里云内容安全 API 实现，DI token（CONTENT_MODERATION）不变。
 */
@Injectable()
export class KeywordModeration implements ContentModeration {
  /** 违禁词（占位样例，真实词表由运营维护/云端接管）。 */
  private readonly rejectWords = ['占位违禁词', '占位辱骂词'];

  /** 复审词（占位样例：命中后创建为 PENDING_REVIEW 等待人工复核）。 */
  private readonly reviewWords = ['占位复审词', '占位敏感词'];

  async check(text: string): Promise<ModerationResult> {
    for (const w of this.rejectWords) {
      if (text.includes(w)) {
        return { verdict: 'reject', reason: `命中违禁词: ${w}` };
      }
    }
    for (const w of this.reviewWords) {
      if (text.includes(w)) {
        return { verdict: 'review', reason: `命中复审词: ${w}` };
      }
    }
    return { verdict: 'pass' };
  }
}
