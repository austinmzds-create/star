import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { AppError, CODE_TO_STATUS, ErrorCodes } from '../errors/app-error';

/** express Response 的最小使用面（避免直接依赖 @types/express）。 */
interface ResponseLike {
  status(code: number): { json(body: unknown): unknown };
}

/**
 * 全局异常过滤器：把所有异常归一化为 { code, message, details? } envelope。
 * - AppError → 按 CODE_TO_STATUS 映射 HTTP 状态；
 * - ValidationPipe 抛出的 BadRequestException → VALIDATION_FAILED（保留 class-validator 消息数组）；
 * - 其余 HttpException → 按其自身状态码，code 归为 VALIDATION_FAILED/INTERNAL_ERROR 之外的通用处理；
 * - 未知异常 → 500 INTERNAL_ERROR（不透出堆栈，仅记录日志）。
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<ResponseLike>();

    if (exception instanceof AppError) {
      res.status(CODE_TO_STATUS[exception.code]).json({
        code: exception.code,
        message: exception.message,
        ...(exception.details !== undefined ? { details: exception.details } : {}),
      });
      return;
    }

    if (exception instanceof BadRequestException) {
      // ValidationPipe 的标准形状：{ statusCode, message: string[] | string, error }
      const body = exception.getResponse();
      const details =
        typeof body === 'object' && body !== null && 'message' in body
          ? (body as { message: unknown }).message
          : body;
      res.status(400).json({
        code: ErrorCodes.VALIDATION_FAILED,
        message: '参数校验失败',
        details,
      });
      return;
    }

    if (exception instanceof HttpException) {
      // 其余框架级 HTTP 异常（404 路由不存在等）：保留状态码，message 取框架文案
      res.status(exception.getStatus()).json({
        code: exception.getStatus() >= 500 ? ErrorCodes.INTERNAL_ERROR : ErrorCodes.INVALID_QUERY,
        message: exception.message,
      });
      return;
    }

    this.logger.error(
      `未捕获异常：${exception instanceof Error ? exception.stack : String(exception)}`,
    );
    res.status(500).json({
      code: ErrorCodes.INTERNAL_ERROR,
      message: '服务内部错误，请稍后重试',
    });
  }
}
