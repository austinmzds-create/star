import { AppError, ErrorCodes } from '../../common/errors/app-error';
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
  QueryStatusResult,
  VerifyNotifyResult,
} from './payment-provider.types';

/** 占位值检测：空/占位/含 placeholder 视为未配置。 */
function isPlaceholder(v: string | undefined): boolean {
  if (!v) return true;
  const s = v.trim();
  if (s === '') return true;
  return s.startsWith('your-') || s.startsWith('alipay-public') || s.includes('placeholder');
}

/**
 * 支付宝 provider（骨架）。本期不接真实网关（需商户凭证，本地无法联调），
 * 不 import 任何支付宝 SDK。未实现方法一律抛 AppError，绝不假验签放行。
 */
export class AlipayProvider implements PaymentProvider {
  readonly name = 'alipay' as const;
  readonly active: boolean;

  constructor() {
    this.active =
      !isPlaceholder(process.env.ALIPAY_APP_ID) &&
      !isPlaceholder(process.env.ALIPAY_PRIVATE_KEY) &&
      !isPlaceholder(process.env.ALIPAY_PUBLIC_KEY);
  }

  async create(_input: CreatePaymentInput): Promise<CreatePaymentResult> {
    // TODO: 接入支付宝 alipay.trade.page.pay / wap.pay（需商户凭证，本地无法联调）
    throw new AppError(ErrorCodes.PAYMENT_PROVIDER_UNAVAILABLE, '支付宝本期未接入');
  }

  async verifyNotify(
    _rawBody: unknown,
    _headers?: Record<string, string>,
  ): Promise<VerifyNotifyResult> {
    // TODO: 真实验签 = RSA2 验 sign（用支付宝公钥）。绝不实现假验签放行。
    throw new AppError(ErrorCodes.PAYMENT_PROVIDER_UNAVAILABLE, '支付宝本期未接入');
  }

  async queryStatus(orderNo: string): Promise<QueryStatusResult> {
    // TODO: 调用 alipay.trade.query 对账
    return { orderNo, status: 'NOTFOUND' };
  }

  ackBody(ok: boolean): unknown {
    return ok ? 'success' : 'fail';
  }
}
