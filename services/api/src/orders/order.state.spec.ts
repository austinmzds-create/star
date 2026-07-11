import { OrderStatus } from '@prisma/client';
import { ErrorCodes } from '../common/errors/app-error';
import { assertTransition, canTransition } from './order.state';

describe('order.state', () => {
  it('canTransition 合法迁移', () => {
    expect(canTransition(OrderStatus.CREATED, OrderStatus.PAID)).toBe(true);
    expect(canTransition(OrderStatus.CREATED, OrderStatus.FAILED)).toBe(true);
    expect(canTransition(OrderStatus.CREATED, OrderStatus.CANCELLED)).toBe(true);
    expect(canTransition(OrderStatus.PAID, OrderStatus.REFUNDED)).toBe(true);
  });

  it('canTransition 非法迁移', () => {
    expect(canTransition(OrderStatus.PAID, OrderStatus.PAID)).toBe(false);
    expect(canTransition(OrderStatus.PAID, OrderStatus.CREATED)).toBe(false);
    expect(canTransition(OrderStatus.CANCELLED, OrderStatus.PAID)).toBe(false);
    expect(canTransition(OrderStatus.REFUNDED, OrderStatus.PAID)).toBe(false);
  });

  it('assertTransition 非法迁移抛 INVALID_STATE_TRANSITION', () => {
    expect(() => assertTransition(OrderStatus.PAID, OrderStatus.CREATED)).toThrow();
    try {
      assertTransition(OrderStatus.CANCELLED, OrderStatus.PAID);
    } catch (e) {
      expect((e as { code: string }).code).toBe(ErrorCodes.INVALID_STATE_TRANSITION);
    }
  });

  it('assertTransition 合法迁移不抛', () => {
    expect(() => assertTransition(OrderStatus.CREATED, OrderStatus.PAID)).not.toThrow();
  });
});
