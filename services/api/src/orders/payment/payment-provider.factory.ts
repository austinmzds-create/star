import { Logger } from '@nestjs/common';
import { PAYMENT_PROVIDER } from '../order.constants';
import { AlipayProvider } from './alipay.provider';
import { MockPaymentProvider } from './mock-payment.provider';
import type { PaymentProvider } from './payment-provider.types';
import { WechatPayProvider } from './wechat-pay.provider';

/**
 * 启动期选 provider：PAYMENT_PROVIDER=wechat|alipay 且凭证齐全 → 真实 provider；
 * 否则（本地无凭证/构造异常）一律降级 mock，绝不 crash（照抄 llm/provider.factory + storageFactory 模式）。
 */
export function createPaymentProvider(): PaymentProvider {
  const want = (process.env.PAYMENT_PROVIDER ?? 'mock').toLowerCase();
  try {
    if (want === 'wechat') {
      const p = new WechatPayProvider();
      if (p.active) {
        Logger.log('PaymentProvider = wechat', 'Payment');
        return p;
      }
      Logger.warn('PAYMENT_PROVIDER=wechat 但微信商户凭证未配置，降级 mock', 'Payment');
    } else if (want === 'alipay') {
      const p = new AlipayProvider();
      if (p.active) {
        Logger.log('PaymentProvider = alipay', 'Payment');
        return p;
      }
      Logger.warn('PAYMENT_PROVIDER=alipay 但支付宝凭证未配置，降级 mock', 'Payment');
    }
  } catch (e) {
    Logger.warn(`支付 provider 初始化失败，降级 mock: ${(e as Error).message}`, 'Payment');
  }
  Logger.log('PaymentProvider = mock（本地/测试）', 'Payment');
  return new MockPaymentProvider();
}

export const paymentProviderFactory = {
  provide: PAYMENT_PROVIDER,
  useFactory: createPaymentProvider,
};
