import { Module } from '@nestjs/common';
import { OrderFulfillmentService } from './fulfillment/order-fulfillment.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PaymentsController } from './payments.controller';
import { paymentProviderFactory } from './payment/payment-provider.factory';

/**
 * 订单与支付模块。
 * PrismaService（global）与 CertificateService（global export）直接注入，无需 import。
 * PAYMENT_PROVIDER 由工厂按 env 选型（本地无凭证恒 mock）。
 */
@Module({
  controllers: [OrdersController, PaymentsController],
  providers: [OrdersService, OrderFulfillmentService, paymentProviderFactory],
  exports: [OrdersService],
})
export class OrdersModule {}
