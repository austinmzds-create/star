/** 内容审核三态裁决：通过 / 转人工复审 / 拒绝（与阿里云内容安全「通过/嫌疑/违规」同构）。 */
export type ModerationVerdict = 'pass' | 'review' | 'reject';

export interface ModerationResult {
  verdict: ModerationVerdict;
  reason?: string;
}

/** 内容审核接口：对拼接后的用户文本（memorialName + blessingText + storyText）给出裁决。 */
export interface ContentModeration {
  check(text: string): Promise<ModerationResult>;
}

/** DI token：memorial.module 以 useClass 绑定具体实现，Phase 3 换云端实现时 token 不变。 */
export const CONTENT_MODERATION = Symbol('CONTENT_MODERATION');
