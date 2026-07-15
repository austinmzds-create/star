import { AppError, ErrorCodes } from '../../common/errors/app-error';
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
  QueryStatusResult,
  VerifyNotifyResult,
} from './payment-provider.types';

/** 占位值检测（与 certificate.module 一致）：空/占位/含 placeholder 视为未配置。 */
function isPlaceholder(v: string | undefined): boolean {
  if (!v) return true;
  const s = v.trim();
  if (s === '') return true;
  return s.startsWith('your-') || s.includes('placeholder');
}

/**
 * 微信支付 v3 provider（骨架）。本期不接真实网关（需商户凭证，本地无法联调），
 * 不 import 任何微信 SDK。未 active 或已配置但未实现的方法一律抛 AppError，绝不假验签放行。
 */
export class WechatPayProvider implements PaymentProvider {
  readonly name = 'wechat' as const;
  readonly active: boolean;

  constructor() {
    this.active =
      !isPlaceholder(process.env.WXPAY_APP_ID) &&
      !isPlaceholder(process.env.WXPAY_MCHID) &&
      !isPlaceholder(process.env.WXPAY_API_V3_KEY) &&
      !isPlaceholder(process.env.WXPAY_CERT_SERIAL) &&
      !isPlaceholder(process.env.WXPAY_PRIVATE_KEY);
  }

  async create(_input: CreatePaymentInput): Promise<CreatePaymentResult> {
    // TODO: 接入微信支付 v3 JSAPI 下单 API（需商户凭证，本地无法联调）
    throw new AppError(ErrorCodes.PAYMENT_PROVIDER_UNAVAILABLE, '微信支付本期未接入');
  }

  async verifyNotify(
    _rawBody: unknown,
    _headers?: Record<string, string>,
  ): Promise<VerifyNotifyResult> {
    // TODO: 真实验签 = 用微信平台证书验 Wechatpay-Signature 头，再用 APIv3 key AEAD 解密 resource。
    // 绝不实现假验签放行。
    throw new AppError(ErrorCodes.PAYMENT_PROVIDER_UNAVAILABLE, '微信支付本期未接入');
  }

  async queryStatus(orderNo: string): Promise<QueryStatusResult> {
    // TODO: 调用微信查单 API 对账
    return { orderNo, status: 'NOTFOUND' };
  }

  ackBody(ok: boolean): unknown {
    return ok ? { code: 'SUCCESS', message: 'OK' } : { code: 'FAIL', message: 'FAIL' };
  }
}
