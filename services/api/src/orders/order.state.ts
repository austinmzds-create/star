import { OrderStatus } from '@prisma/client';
import { AppError, ErrorCodes } from '../common/errors/app-error';

/** 订单状态合法迁移表。 */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  CREATED: [OrderStatus.PAID, OrderStatus.FAILED, OrderStatus.CANCELLED],
  PAID: [OrderStatus.REFUNDED],
  FAILED: [OrderStatus.CREATED], // 允许重新发起（本期不强用）
  CANCELLED: [],
  REFUNDED: [],
};

/** 是否允许 from → to 迁移。 */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** 断言迁移合法，否则抛 INVALID_STATE_TRANSITION。 */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError(ErrorCodes.INVALID_STATE_TRANSITION, `订单状态不允许 ${from} → ${to}`, {
      from,
      to,
    });
  }
}
