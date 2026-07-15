import { createPaymentProvider } from './payment-provider.factory';
import { MockPaymentProvider } from './mock-payment.provider';

describe('MockPaymentProvider', () => {
  const provider = new MockPaymentProvider();

  it('create 返回 kind:mock 且 payUrl 含 orderNo', async () => {
    const r = await provider.create({
      orderNo: 'ORD-20260711-A7K2QP',
      skuCode: 'CERT_DIGITAL',
      amountFen: 1900,
      currency: 'CNY',
      subject: '电子纪念证书',
    });
    expect(r.payParams.kind).toBe('mock');
    expect(String(r.payParams.payUrl)).toContain('ORD-20260711-A7K2QP');
  });

  it('verifyNotify success → paid、稳定 txnId', async () => {
    const r = await provider.verifyNotify({ orderNo: 'ORD-1', outcome: 'success' });
    expect(r.paid).toBe(true);
    expect(r.providerTxnId).toBe('MOCKTXN-ORD-1');
  });

  it('verifyNotify fail → paid=false', async () => {
    const r = await provider.verifyNotify({ orderNo: 'ORD-1', outcome: 'fail' });
    expect(r.paid).toBe(false);
  });

  it('ackBody 形状', () => {
    expect(provider.ackBody(true)).toEqual({ ok: true });
  });
});

describe('createPaymentProvider 工厂', () => {
  const orig = { ...process.env };
  afterEach(() => {
    process.env = { ...orig };
  });

  it('未设 PAYMENT_PROVIDER → mock', () => {
    delete process.env.PAYMENT_PROVIDER;
    expect(createPaymentProvider().name).toBe('mock');
  });

  it('PAYMENT_PROVIDER=wechat 但无凭证 → 降级 mock', () => {
    process.env.PAYMENT_PROVIDER = 'wechat';
    delete process.env.WXPAY_APP_ID;
    expect(createPaymentProvider().name).toBe('mock');
  });

  it('PAYMENT_PROVIDER=alipay 但无凭证 → 降级 mock', () => {
    process.env.PAYMENT_PROVIDER = 'alipay';
    delete process.env.ALIPAY_APP_ID;
    expect(createPaymentProvider().name).toBe('mock');
  });
});
