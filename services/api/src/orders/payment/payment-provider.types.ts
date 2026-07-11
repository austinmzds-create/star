/** 支付服务商抽象：mock（本地/测试）+ wechat/alipay 骨架。DI token 见 order.constants。 */

export type ProviderName = 'mock' | 'wechat' | 'alipay';

/** 下单入参（金额为服务端权威值）。 */
export interface CreatePaymentInput {
  orderNo: string;
  skuCode: string;
  amountFen: number;
  currency: string;
  subject: string;
  registrationNo?: string;
}

/** 返回给前端拉起支付的参数（字段随 provider 不同）。 */
export interface PayParams {
  kind: string;
  [k: string]: unknown;
}

export interface CreatePaymentResult {
  payParams: PayParams;
}

/** 回调验签结果（provider 无关的归一形状）。 */
export interface VerifyNotifyResult {
  orderNo: string;
  paid: boolean;
  providerTxnId?: string;
  /** 用于服务端对账（与订单金额比对）。 */
  amountFen?: number;
  /** 脱敏后原始回执，落 payMeta。 */
  raw?: unknown;
}

export type PaymentQueryStatus = 'CREATED' | 'PAID' | 'FAILED' | 'NOTFOUND';
export interface QueryStatusResult {
  orderNo: string;
  status: PaymentQueryStatus;
  providerTxnId?: string;
}

export interface PaymentProvider {
  readonly name: ProviderName;
  /** 是否已配置激活（env 齐全）。未激活的真实 provider 由工厂降级为 mock。 */
  readonly active: boolean;
  create(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /** 验签 + 解析回调；验签失败抛 AppError(PAYMENT_VERIFY_FAILED)。headers 供真实签名头。 */
  verifyNotify(rawBody: unknown, headers?: Record<string, string>): Promise<VerifyNotifyResult>;
  queryStatus(orderNo: string, providerTxnId?: string): Promise<QueryStatusResult>;
  /** 回调需回应的 ack body（微信要 {code:'SUCCESS',message:'OK'}，支付宝要纯文本 'success'）。 */
  ackBody(ok: boolean): unknown;
}
