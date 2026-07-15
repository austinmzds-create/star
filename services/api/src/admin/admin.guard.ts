import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { AppError, ErrorCodes } from '../common/errors/app-error';

/** 请求对象最小使用面（避免依赖 @types/express）。 */
interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
}

/** 定长安全比较：长度不等直接否，等长走 timingSafeEqual 防时序侧信道。 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * 后台鉴权守卫：x-admin-token 比对 env ADMIN_API_TOKEN。
 * - 未配置 ADMIN_API_TOKEN → 503 ADMIN_NOT_ENABLED（拒绝所有 admin 端点，避免裸奔）；
 * - header 缺失/不匹配 → 401 ADMIN_UNAUTHORIZED。
 * 实时读 process.env 便于测试与热配。
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const configured = process.env.ADMIN_API_TOKEN;
    if (!configured || configured.trim() === '') {
      throw new AppError(ErrorCodes.ADMIN_NOT_ENABLED, '后台未启用');
    }
    const req = context.switchToHttp().getRequest<RequestLike>();
    const raw = req.headers['x-admin-token'];
    const provided = Array.isArray(raw) ? raw[0] : raw;
    if (!provided || !safeEqual(provided, configured)) {
      throw new AppError(ErrorCodes.ADMIN_UNAUTHORIZED, '无效的后台令牌');
    }
    return true;
  }
}
