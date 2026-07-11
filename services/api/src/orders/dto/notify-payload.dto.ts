/**
 * 支付回调载荷形状（文档用）。
 *
 * 真实网关（微信/支付宝）回调体是各自签名过的任意结构，故 PaymentsController 用未类型化的
 * 原始 body 接收（不走 ValidationPipe whitelist，避免剥离网关字段），验签与解析交给对应 provider。
 * 本类型仅描述 mock provider 可识别的最小字段，便于前端/联调构造。
 */
export interface NotifyPayload {
  orderNo?: string;
  /** mock：'success' | 'fail'，默认 success。 */
  outcome?: 'success' | 'fail';
  /** 服务端对账用（回调金额，单位分）。 */
  amountFen?: number;
}
