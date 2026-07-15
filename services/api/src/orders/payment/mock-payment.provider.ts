import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
  QueryStatusResult,
  VerifyNotifyResult,
} from './payment-provider.types';

/** mock 回调体：{orderNo, outcome?: 'success'|'fail', amountFen?}。 */
interface MockNotifyBody {
  orderNo?: string;
  outcome?: 'success' | 'fail';
  amountFen?: number;
}

/**
 * 本地/测试支付 provider：无验签、恒信任，支持可控成功/失败。
 * create 返回一个 payUrl，前端/单测 POST 该 url 即完成支付。订单真值以本地 DB 为准。
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const;
  readonly active = true;

  async create(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    return {
      payParams: {
        kind: 'mock',
        payUrl: `/api/orders/${input.orderNo}/pay`,
        note: '本地/测试支付，POST payUrl 即完成',
      },
    };
  }

  async verifyNotify(rawBody: unknown): Promise<VerifyNotifyResult> {
    const body = (rawBody ?? {}) as MockNotifyBody;
    const orderNo = body.orderNo ?? '';
    const paid = body.outcome !== 'fail';
    return {
      orderNo,
      paid,
      providerTxnId: `MOCKTXN-${orderNo}`,
      amountFen: body.amountFen,
      raw: { mock: true, outcome: body.outcome ?? 'success' },
    };
  }

  async queryStatus(orderNo: string): Promise<QueryStatusResult> {
    // mock 无独立账本；对账不适用（订单真值以本地 DB 为准）
    return { orderNo, status: 'NOTFOUND' };
  }

  ackBody(ok: boolean): unknown {
    return { ok };
  }
}
