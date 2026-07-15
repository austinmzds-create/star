import { ErrorCodes } from '../common/errors/app-error';
import type { PrismaService } from '../prisma/prisma.service';
import { AgentService } from './agent.service';
import { TemplateProvider } from './llm/template.provider';
import { SkillRegistry } from './skill.registry';
import type { Skill } from './skill.types';

function createPrismaMock(isAvailable = true) {
  return {
    isAvailable,
    ensureAvailable: jest.fn(),
    agentTask: {
      create: jest.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => ({
        id: 'task_1',
        ...args.data,
      })),
      update: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService & {
    isAvailable: boolean;
    agentTask: { create: jest.Mock; update: jest.Mock };
  };
}

const validDto = {
  starNameZh: '天狼星',
  constellationZh: '大犬座',
  occasion: 'LOVE',
  memorialName: '给挚爱 Alice',
  relationTo: '妻子',
};

describe('AgentService.runSkill', () => {
  it('成功路径：create RUNNING + update SUCCEEDED（含 modelName/durationMs/outputJson）', async () => {
    const prisma = createPrismaMock();
    const service = new AgentService(prisma, new SkillRegistry(), new TemplateProvider());

    const r = await service.runSkill<{ letter: string }>('cosmic-letter', validDto);

    expect(r.taskNo).toBe('task_1');
    expect(r.mode).toBe('template');
    expect(r.output.letter).toContain('天狼星');

    expect(prisma.agentTask.create).toHaveBeenCalledTimes(1);
    const createData = prisma.agentTask.create.mock.calls[0]![0].data;
    expect(createData.status).toBe('RUNNING');
    expect(createData.skillCode).toBe('cosmic-letter');

    expect(prisma.agentTask.update).toHaveBeenCalledTimes(1);
    const updateData = prisma.agentTask.update.mock.calls[0]![0].data;
    expect(updateData.status).toBe('SUCCEEDED');
    expect(updateData.modelName).toBe('template');
    expect(typeof updateData.durationMs).toBe('number');
    expect((updateData.outputJson as { letter: string }).letter).toContain('天狼星');
  });

  it('失败路径：skill.run 抛错 → update FAILED + 抛 SKILL_FAILED', async () => {
    const prisma = createPrismaMock();
    const registry = new SkillRegistry();
    const throwing: Skill = {
      code: 'boom',
      parseInput: async (raw) => raw,
      run: async () => {
        throw new Error('kaboom');
      },
    };
    // 注入会抛错的假 skill
    (registry as unknown as { skills: Map<string, Skill> }).skills.set('boom', throwing);
    const service = new AgentService(prisma, registry, new TemplateProvider());

    await expect(service.runSkill('boom', {})).rejects.toMatchObject({
      code: ErrorCodes.SKILL_FAILED,
    });
    const updateData = prisma.agentTask.update.mock.calls[0]![0].data;
    expect(updateData.status).toBe('FAILED');
    expect(updateData.error).toContain('kaboom');
  });

  it('DB 不可用：不落库、仍返回来信、taskNo=unpersisted、不抛错', async () => {
    const prisma = createPrismaMock(false);
    const service = new AgentService(prisma, new SkillRegistry(), new TemplateProvider());

    const r = await service.runSkill<{ letter: string }>('cosmic-letter', validDto);
    expect(r.taskNo).toBe('unpersisted');
    expect(r.output.letter).toContain('天狼星');
    expect(prisma.agentTask.create).not.toHaveBeenCalled();
    expect(prisma.agentTask.update).not.toHaveBeenCalled();
  });

  it('未知 skillCode → SKILL_NOT_FOUND', async () => {
    const prisma = createPrismaMock();
    const service = new AgentService(prisma, new SkillRegistry(), new TemplateProvider());
    await expect(service.runSkill('nope', {})).rejects.toMatchObject({
      code: ErrorCodes.SKILL_NOT_FOUND,
    });
  });
});
