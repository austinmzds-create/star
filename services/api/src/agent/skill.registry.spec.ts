import { ErrorCodes } from '../common/errors/app-error';
import { SkillRegistry } from './skill.registry';

describe('SkillRegistry', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  it('has / get cosmic-letter', () => {
    expect(registry.has('cosmic-letter')).toBe(true);
    expect(registry.get('cosmic-letter')?.code).toBe('cosmic-letter');
  });

  it('list 含 cosmic-letter', () => {
    expect(registry.list()).toContain('cosmic-letter');
  });

  it('getOrThrow 未知码 → SKILL_NOT_FOUND', () => {
    expect(() => registry.getOrThrow('nope')).toThrow();
    try {
      registry.getOrThrow('nope');
    } catch (e) {
      expect((e as { code: string }).code).toBe(ErrorCodes.SKILL_NOT_FOUND);
    }
  });
});
