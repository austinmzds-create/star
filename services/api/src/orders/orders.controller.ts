import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { PayOrderDto } from './dto/pay-order.dto';
import { OrdersService } from './orders.service';

/** 订单接口：建单 / 查单 / mock 支付（本地测试）。 */
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** POST /api/orders（201） */
  @Post()
  create(@Body() dto: CreateOrderDto) {
    return this.orders.create(dto);
  }

  /** GET /api/orders/:orderNo */
  @Get(':orderNo')
  getByNo(@Param('orderNo') orderNo: string) {
    return this.orders.getByOrderNo(orderNo);
  }

  /** POST /api/orders/:orderNo/pay（mock 支付，仅 provider==='mock' 可用） */
  @Post(':orderNo/pay')
  pay(@Param('orderNo') orderNo: string, @Body() dto: PayOrderDto) {
    return this.orders.payMock(orderNo, dto);
  }
}
