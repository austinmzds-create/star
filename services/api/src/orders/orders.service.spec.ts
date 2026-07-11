import { ErrorCodes } from '../common/errors/app-error';
import type { PrismaService } from '../prisma/prisma.service';
import { COMPLIANCE_NOTICE } from '../common/compliance';
import { OrderFulfillmentService } from './fulfillment/order-fulfillment.service';
import { MockPaymentProvider } from './payment/mock-payment.provider';
import { OrdersService } from './orders.service';

function createPrismaMock() {
  return {
    ensureAvailable: jest.fn(),
    order: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    memorialRegistration: { findUnique: jest.fn() },
  } as unknown as PrismaService & {
    ensureAvailable: jest.Mock;
    order: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    memorialRegistration: { findUnique: jest.Mock };
  };
}

/** order.create echo：回显 data + id/时间戳/默认字段。 */
function echoOrderCreate(prisma: ReturnType<typeof createPrismaMock>): void {
  prisma.order.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    id: 'ord_1',
    userId: null,
    providerTxnId: null,
    payMeta: null,
    paidAt: null,
    createdAt: new Date('2026-07-11T08:00:00Z'),
    updatedAt: new Date('2026-07-11T08:00:00Z'),
    ...args.data,
  }));
}

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ord_1',
    orderNo: 'ORD-20260711-A7K2QP',
    userId: null,
    registrationId: 'reg_1',
    skuCode: 'CERT_DIGITAL',
    amountFen: 1900,
    currency: 'CNY',
    status: 'CREATED',
    provider: 'mock',
    channel: 'mock',
    providerTxnId: null,
    subject: '电子纪念证书 · To Alice',
    payMeta: null,
    paidAt: null,
    createdAt: new Date('2026-07-11T08:00:00Z'),
    updatedAt: new Date('2026-07-11T08:00:00Z'),
    ...overrides,
  };
}

function makeService(prisma: ReturnType<typeof createPrismaMock>, fulfillment: { fulfill: jest.Mock }) {
  return new OrdersService(
    prisma,
    new MockPaymentProvider(),
    fulfillment as unknown as OrderFulfillmentService,
  );
}

describe('OrdersService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let fulfillment: { fulfill: jest.Mock };
  let service: OrdersService;

  beforeEach(() => {
    prisma = createPrismaMock();
    fulfillment = { fulfill: jest.fn(async () => undefined) };
    service = makeService(prisma, fulfillment);
  });

  describe('create', () => {
    it('合法 SKU → CREATED，金额取自目录（前端传 amountFen 被忽略），orderNo 前缀 ORD-，含 payParams/compliance', async () => {
      echoOrderCreate(prisma);
      prisma.memorialRegistration.findUnique.mockResolvedValue({
        id: 'reg_1',
        memorialName: 'To Alice',
      });
      // 前端塞了 amountFen（DTO 无此字段，运行时也应被服务端权威覆盖）
      const result = await service.create({
        skuCode: 'CERT_DIGITAL',
        registrationNo: 'STAR-20260711-K7PX',
        amountFen: 1,
      } as never);

      const data = prisma.order.create.mock.calls[0]![0].data;
      expect(data.amountFen).toBe(1900);
      expect(data.status).toBe('CREATED');
      expect(data.provider).toBe('mock');
      expect(String(data.orderNo)).toMatch(/^ORD-\d{8}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);

      expect(result.order.amountFen).toBe(1900);
      expect(result.payParams.kind).toBe('mock');
      expect(result.compliance).toBe(COMPLIANCE_NOTICE);
      expect(result.order).not.toHaveProperty('userId');
      expect(result.order).not.toHaveProperty('id');
    });

    it('未知 skuCode → SKU_NOT_FOUND', async () => {
      await expect(service.create({ skuCode: 'NOPE' })).rejects.toMatchObject({
        code: ErrorCodes.SKU_NOT_FOUND,
      });
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('requiresRegistration 缺 registrationNo → VALIDATION_FAILED', async () => {
      await expect(service.create({ skuCode: 'CERT_DIGITAL' })).rejects.toMatchObject({
        code: ErrorCodes.VALIDATION_FAILED,
      });
    });

    it('registrationNo 不存在 → REGISTRATION_NOT_FOUND', async () => {
      prisma.memorialRegistration.findUnique.mockResolvedValue(null);
      await expect(
        service.create({ skuCode: 'CERT_DIGITAL', registrationNo: 'STAR-NOPE' }),
      ).rejects.toMatchObject({ code: ErrorCodes.REGISTRATION_NOT_FOUND });
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('DB 不可用 → 透传 DB_UNAVAILABLE', async () => {
      prisma.ensureAvailable.mockImplementation(() => {
        throw Object.assign(new Error('db down'), { code: ErrorCodes.DB_UNAVAILABLE });
      });
      await expect(service.create({ skuCode: 'CERT_DIGITAL', registrationNo: 'x' })).rejects.toBeDefined();
      expect(prisma.order.create).not.toHaveBeenCalled();
    });
  });

  describe('payMock', () => {
    it('mock 支付成功：updateMany {count:1} → PAID、paidAt、fulfill 恰一次', async () => {
      prisma.order.findUnique
        .mockResolvedValueOnce(orderRow({ status: 'CREATED' })) // payMock 顶部
        .mockResolvedValueOnce(orderRow({ status: 'PAID', paidAt: new Date(), providerTxnId: 'MOCKTXN-ORD-20260711-A7K2QP' })); // markPaid current
      prisma.order.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.payMock('ORD-20260711-A7K2QP', { outcome: 'success' });
      expect(result.order.status).toBe('PAID');
      const upd = prisma.order.updateMany.mock.calls[0]![0];
      expect(upd.where.status).toBe('CREATED');
      expect(upd.data.status).toBe('PAID');
      expect(fulfillment.fulfill).toHaveBeenCalledTimes(1);
    });

    it('幂等：重复支付已 PAID 订单，updateMany {count:0} → 不重复履约', async () => {
      // 第二次：顶部 findUnique 返回 PAID，markPaid current 返回 PAID 同 txnId
      prisma.order.findUnique
        .mockResolvedValueOnce(orderRow({ status: 'PAID', providerTxnId: 'MOCKTXN-ORD-20260711-A7K2QP' }))
        .mockResolvedValueOnce(orderRow({ status: 'PAID', providerTxnId: 'MOCKTXN-ORD-20260711-A7K2QP' }));
      prisma.order.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.payMock('ORD-20260711-A7K2QP', {});
      expect(result.order.status).toBe('PAID');
      expect(fulfillment.fulfill).not.toHaveBeenCalled();
    });

    it('provider 不匹配（非 mock 订单）→ PAYMENT_PROVIDER_MISMATCH', async () => {
      prisma.order.findUnique.mockResolvedValue(orderRow({ provider: 'wechat' }));
      await expect(service.payMock('ORD-20260711-A7K2QP', {})).rejects.toMatchObject({
        code: ErrorCodes.PAYMENT_PROVIDER_MISMATCH,
      });
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });

    it('订单不存在 → ORDER_NOT_FOUND', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.payMock('ORD-NOPE', {})).rejects.toMatchObject({
        code: ErrorCodes.ORDER_NOT_FOUND,
      });
    });

    it('outcome fail → FAILED，不履约', async () => {
      prisma.order.findUnique
        .mockResolvedValueOnce(orderRow({ status: 'CREATED' }))
        .mockResolvedValueOnce(orderRow({ status: 'FAILED' }));
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      const result = await service.payMock('ORD-20260711-A7K2QP', { outcome: 'fail' });
      expect(result.order.status).toBe('FAILED');
      expect(fulfillment.fulfill).not.toHaveBeenCalled();
    });
  });

  describe('handleNotify（回调对账）', () => {
    it('mock 回调金额不符 → 不置 PAID、落 payMeta', async () => {
      prisma.order.findUnique.mockResolvedValue(orderRow({ amountFen: 1900 }));
      prisma.order.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
        orderRow({ ...args.data }),
      );
      const ack = await service.handleNotify('mock', {
        orderNo: 'ORD-20260711-A7K2QP',
        outcome: 'success',
        amountFen: 9999,
      });
      expect(ack).toEqual({ ok: true });
      // 未以 PAID 调 updateMany
      const paidUpdate = prisma.order.updateMany.mock.calls.find(
        (c) => (c[0] as { data?: { status?: string } }).data?.status === 'PAID',
      );
      expect(paidUpdate).toBeUndefined();
      // 落了对账 payMeta
      const flag = prisma.order.update.mock.calls[0]![0].data;
      expect((flag.payMeta as { reconcileError?: string }).reconcileError).toBe('AMOUNT_MISMATCH');
      expect(fulfillment.fulfill).not.toHaveBeenCalled();
    });

    it('wechat 段骨架期 → 抛 PAYMENT_PROVIDER_UNAVAILABLE', async () => {
      await expect(
        service.handleNotify('wechat', { orderNo: 'ORD-1' }),
      ).rejects.toMatchObject({ code: ErrorCodes.PAYMENT_PROVIDER_UNAVAILABLE });
    });

    it('未知渠道段 → VALIDATION_FAILED', async () => {
      await expect(service.handleNotify('paypal', {})).rejects.toMatchObject({
        code: ErrorCodes.VALIDATION_FAILED,
      });
    });
  });

  describe('getByOrderNo', () => {
    it('命中 → 视图 + compliance，不含内部字段', async () => {
      prisma.order.findUnique.mockResolvedValue(orderRow());
      const result = await service.getByOrderNo('ORD-20260711-A7K2QP');
      expect(result.order.orderNo).toBe('ORD-20260711-A7K2QP');
      expect(result.compliance).toBe(COMPLIANCE_NOTICE);
      expect(result.order).not.toHaveProperty('userId');
      expect(result.order).not.toHaveProperty('id');
    });

    it('未命中 → ORDER_NOT_FOUND', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.getByOrderNo('ORD-NOPE')).rejects.toMatchObject({
        code: ErrorCodes.ORDER_NOT_FOUND,
      });
    });
  });
});
