import { OccasionType } from '@prisma/client';
import { ErrorCodes } from '../../common/errors/app-error';
import { TemplateProvider } from '../llm/template.provider';
import type { LlmProvider } from '../llm/llm-provider.types';
import { CosmicLetterSkill, type CosmicLetterInput } from './cosmic-letter.skill';

const FORBIDDEN = /IAU|官方|购买|买下|产权|所有权|永久所有|拥有星/;

const OCCASIONS: OccasionType[] = [
  'LOVE',
  'BIRTHDAY',
  'WEDDING',
  'GRADUATION',
  'NEWBORN',
  'PET_MEMORIAL',
  'IN_MEMORIAM',
  'OTHER',
];

function input(overrides: Partial<CosmicLetterInput> = {}): CosmicLetterInput {
  return {
    starNameZh: '天狼星',
    constellationZh: '大犬座',
    occasion: 'LOVE',
    memorialName: '给挚爱 Alice',
    relationTo: '妻子',
    ...overrides,
  };
}

describe('CosmicLetterSkill（TemplateProvider 分场景）', () => {
  const skill = new CosmicLetterSkill();
  const ctx = { llm: new TemplateProvider() };

  it.each(OCCASIONS)('%s：mode=template，含星名/星座，长度合理，无禁词', async (occasion) => {
    const r = await skill.run(input({ occasion }), ctx);
    expect(r.mode).toBe('template');
    expect(r.modelName).toBe('template');
    expect(r.output.letter).toContain('天狼星');
    expect(r.output.letter).toContain('大犬座');
    const len = Array.from(r.output.letter).length;
    expect(len).toBeGreaterThanOrEqual(80);
    expect(len).toBeLessThanOrEqual(220);
    expect(r.output.letter).not.toMatch(FORBIDDEN);
  });

  it('relationTo 省略时不报错、不出现 undefined', async () => {
    const r = await skill.run(input({ occasion: 'LOVE', relationTo: undefined }), ctx);
    expect(r.output.letter).not.toContain('undefined');
  });

  it('parseInput 非法 occasion → VALIDATION_FAILED', async () => {
    await expect(
      skill.parseInput({ ...input(), occasion: 'NOPE' }),
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_FAILED });
  });

  it('parseInput 空 memorialName → VALIDATION_FAILED', async () => {
    await expect(
      skill.parseInput({ ...input(), memorialName: '' }),
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_FAILED });
  });

  it('LLM 分支：真调成功 → mode=llm', async () => {
    const fakeLlm: LlmProvider = {
      kind: 'llm',
      modelName: 'claude-sonnet-5',
      isAvailable: () => true,
      complete: jest
        .fn()
        .mockResolvedValue({ text: '一封两百字以内的假信，愿星光长明。', modelName: 'claude-sonnet-5' }),
    };
    const r = await skill.run(input(), { llm: fakeLlm });
    expect(r.mode).toBe('llm');
    expect(r.modelName).toBe('claude-sonnet-5');
  });

  it('LLM 分支：调用失败 → 回退模板、不抛错', async () => {
    const failing: LlmProvider = {
      kind: 'llm',
      modelName: 'claude-sonnet-5',
      isAvailable: () => true,
      complete: jest.fn().mockRejectedValue(new Error('429')),
    };
    const r = await skill.run(input(), { llm: failing });
    expect(r.mode).toBe('template');
    expect(r.output.letter).toContain('天狼星');
  });
});
