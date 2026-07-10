/** 业务错误码。HTTP 状态由错误码决定，见 CODE_TO_STATUS。 */
export const ErrorCodes = {
  VALIDATION_FAILED: 'VALIDATION_FAILED', // 400
  INVALID_QUERY: 'INVALID_QUERY', // 400
  CELESTIAL_NOT_FOUND: 'CELESTIAL_NOT_FOUND', // 404
  REGISTRATION_NOT_FOUND: 'REGISTRATION_NOT_FOUND', // 404
  MEMORIAL_PAGE_NOT_FOUND: 'MEMORIAL_PAGE_NOT_FOUND', // 404
  CELESTIAL_NOT_NAMABLE: 'CELESTIAL_NOT_NAMABLE', // 422
  CONTENT_REJECTED: 'CONTENT_REJECTED', // 422
  DB_UNAVAILABLE: 'DB_UNAVAILABLE', // 503
  INTERNAL_ERROR: 'INTERNAL_ERROR', // 500
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** 错误码 → HTTP 状态码映射（异常过滤器使用）。 */
export const CODE_TO_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  INVALID_QUERY: 400,
  CELESTIAL_NOT_FOUND: 404,
  REGISTRATION_NOT_FOUND: 404,
  MEMORIAL_PAGE_NOT_FOUND: 404,
  CELESTIAL_NOT_NAMABLE: 422,
  CONTENT_REJECTED: 422,
  DB_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/** 业务异常基类：携带稳定错误码与可选细节，由全局过滤器统一转为响应 envelope。 */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
