import { ExecutionContext } from '@nestjs/common';
import { ErrorCodes } from '../common/errors/app-error';
import { AdminGuard } from './admin.guard';

function ctx(headers: Record<string, unknown> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  const guard = new AdminGuard();
  const original = process.env.ADMIN_API_TOKEN;

  afterEach(() => {
    if (original === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = original;
  });

  it('未配置 token → ADMIN_NOT_ENABLED', () => {
    delete process.env.ADMIN_API_TOKEN;
    expect(() => guard.canActivate(ctx({ 'x-admin-token': 'x' }))).toThrow();
    try {
      guard.canActivate(ctx({ 'x-admin-token': 'x' }));
    } catch (e) {
      expect((e as { code: string }).code).toBe(ErrorCodes.ADMIN_NOT_ENABLED);
    }
  });

  it('空串 token → ADMIN_NOT_ENABLED', () => {
    process.env.ADMIN_API_TOKEN = '';
    try {
      guard.canActivate(ctx({ 'x-admin-token': 'x' }));
      throw new Error('should throw');
    } catch (e) {
      expect((e as { code: string }).code).toBe(ErrorCodes.ADMIN_NOT_ENABLED);
    }
  });

  it('配置 token、无 header → ADMIN_UNAUTHORIZED', () => {
    process.env.ADMIN_API_TOKEN = 'secret-token';
    try {
      guard.canActivate(ctx({}));
      throw new Error('should throw');
    } catch (e) {
      expect((e as { code: string }).code).toBe(ErrorCodes.ADMIN_UNAUTHORIZED);
    }
  });

  it('配置 token、错误值 → ADMIN_UNAUTHORIZED', () => {
    process.env.ADMIN_API_TOKEN = 'secret-token';
    try {
      guard.canActivate(ctx({ 'x-admin-token': 'wrong' }));
      throw new Error('should throw');
    } catch (e) {
      expect((e as { code: string }).code).toBe(ErrorCodes.ADMIN_UNAUTHORIZED);
    }
  });

  it('配置 token、正确值 → true', () => {
    process.env.ADMIN_API_TOKEN = 'secret-token';
    expect(guard.canActivate(ctx({ 'x-admin-token': 'secret-token' }))).toBe(true);
  });

  it('header 为数组取第一个 → true', () => {
    process.env.ADMIN_API_TOKEN = 'secret-token';
    expect(guard.canActivate(ctx({ 'x-admin-token': ['secret-token'] }))).toBe(true);
  });
});
