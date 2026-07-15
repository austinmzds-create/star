import { Body, Controller, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { OrdersService } from './orders.service';

/**
 * 支付网关异步回调接口。
 * 注意：真实微信支付需 raw body 验签——生产须在 main.ts 配置 rawBody 中间件，本期 mock JSON 足够。
 */
@Controller('payments')
export class PaymentsController {
  constructor(private readonly orders: OrdersService) {}

  /** POST /api/payments/notify/:provider（provider ∈ mock|wechat|alipay）。 */
  @Post('notify/:provider')
  @HttpCode(200)
  notify(
    @Param('provider') provider: string,
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string>,
  ) {
    return this.orders.handleNotify(provider, body, headers);
  }
}
