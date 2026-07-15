import { Injectable } from '@nestjs/common';
import { AppError, ErrorCodes } from '../common/errors/app-error';
import { CosmicLetterSkill } from './skills/cosmic-letter.skill';
import type { ISkillRegistry, Skill } from './skill.types';

/**
 * Skill 注册表：进程内 code → Skill 映射。
 * 新增 skill 只需在构造函数 register。Skill 无状态、可单例共享。
 */
@Injectable()
export class SkillRegistry implements ISkillRegistry {
  private readonly skills = new Map<string, Skill>();

  constructor() {
    // 首个 skill：宇宙来信。后续证书文案/星语故事在此追加。
    this.register(new CosmicLetterSkill());
  }

  private register(skill: Skill): void {
    if (this.skills.has(skill.code)) {
      throw new Error(`Skill code 重复注册: ${skill.code}`);
    }
    this.skills.set(skill.code, skill);
  }

  get(code: string): Skill | undefined {
    return this.skills.get(code);
  }

  has(code: string): boolean {
    return this.skills.has(code);
  }

  list(): string[] {
    return [...this.skills.keys()];
  }

  /** 取不到即业务 404（未知技能码）。供 AgentService 调用。 */
  getOrThrow(code: string): Skill {
    const s = this.skills.get(code);
    if (!s) {
      throw new AppError(ErrorCodes.SKILL_NOT_FOUND, `未知的技能码: ${code}`);
    }
    return s;
  }
}
