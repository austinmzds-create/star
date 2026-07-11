import { AppError, ErrorCodes } from '../../common/errors/app-error';

/**
 * 解析可选的 at 时刻参数（epoch 毫秒数或 ISO 8601 字符串）。
 * 缺省 = 服务端当前时刻；非法值抛 INVALID_QUERY（HTTP 400）。
 * 星历天体（行星/日月）的坐标按该时刻实时计算。
 */
export function parseAtParam(at?: string): Date {
  if (at === undefined || at.trim() === '') return new Date();
  const trimmed = at.trim();
  // 纯数字视为 epoch 毫秒；否则按 ISO 8601 解析
  const date = /^-?\d+$/.test(trimmed) ? new Date(Number(trimmed)) : new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(ErrorCodes.INVALID_QUERY, `非法时间参数 at: ${at}`);
  }
  return date;
}
