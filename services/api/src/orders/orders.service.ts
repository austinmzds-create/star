import { Inject, Injectable, Logger } from '@nestjs/common';
import { OrderStatus, type Order } from '@prisma/client';
import { COMPLIANCE_NOTICE } from '../common/compliance';
import { AppError, ErrorCodes } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { OrderFulfillmentService } from './fulfillment/order-fulfillment.service';
import { getSkuOrThrow, makeOrderNo, PAYMENT_PROVIDER } from './order.constants';
import { AlipayProvider } from './payment/alipay.provider';
import { MockPaymentProvider } from './payment/mock-payment.provider';
import type { PaymentProvider, VerifyNotifyResult } from './payment/payment-provider.types';
import { WechatPayProvider } from './payment/wechat-pay.provider';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { PayOrderDto } from './dto/pay-order.dto';

/** 编号生成最大重试次数（orderNo @unique 冲突时重生成）。 */
const MAX_ID_RETRIES = 5;

/** Prisma 唯一约束冲突（P2002）判定（不依赖具体错误类实例）。 */
function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code: unknown }).code === 'P2002'
  );
}

/** 对外订单视图（剔除内部 id/userId 等）。 */
export interface OrderView {
  orderNo: string;
  skuCode: string;
  subject: string | null;
  amountFen: number;
  currency: string;
  provider: string | null;
  status: OrderStatus;
  providerTxnId: string | null;
  paidAt: Date | null;
  registrationId: string | null;
  createdAt: Date;
}

/**
 * 订单与支付骨架服务。
 * 金额服务端权威（从 SKU_CATALOG 取），回调对账不信任前端金额，markPaid CAS 幂等履约一次。
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
    private readonly fulfillment: OrderFulfillmentService,
  ) {}

  /** 建单：SKU 校验 → 登记校验 → 服务端权威金额落库（orderNo 冲突重试）→ 拉起支付参数。 */
  async create(dto: CreateOrderDto) {
    this.prisma.ensureAvailable();
    const sku = getSkuOrThrow(dto.skuCode);

    let registrationId: string | null = null;
    let subject = sku.nameZh;
    if (sku.requiresRegistration) {
      if (!dto.registrationNo) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, '该商品需要先完成纪念登记', {
          field: 'registrationNo',
        });
      }
      const reg = await this.prisma.memorialRegistration.findUnique({
        where: { registrationNo: dto.registrationNo },
      });
      if (!reg) {
        throw new AppError(
          ErrorCodes.REGISTRATION_NOT_FOUND,
          `纪念登记不存在: ${dto.registrationNo}`,
        );
      }
      registrationId = reg.id;
      subject = `${sku.nameZh} · ${reg.memorialName}`;
    }

    const provider = this.paymentProvider.name;
    let order: Order | null = null;
    for (let attempt = 0; attempt < MAX_ID_RETRIES; attempt++) {
      try {
        order = await this.prisma.order.create({
          data: {
            orderNo: makeOrderNo(),
            registrationId,
            skuCode: sku.skuCode,
            amountFen: sku.priceFen, // 服务端权威
            currency: sku.currency,
            status: OrderStatus.CREATED,
            provider,
            channel: provider, // 镜像
            subject,
          },
        });
        break;
      } catch (e) {
        if (isUniqueViolation(e)) continue;
        throw e;
      }
    }
    if (!order) throw new AppError(ErrorCodes.INTERNAL_ERROR, '订单号生成冲突，请重试');

    const { payParams } = await this.paymentProvider.create({
      orderNo: order.orderNo,
      skuCode: order.skuCode,
      amountFen: order.amountFen,
      currency: order.currency,
      subject: subject,
      ...(dto.registrationNo ? { registrationNo: dto.registrationNo } : {}),
    });

    return { order: this.toOrderView(order), payParams, compliance: COMPLIANCE_NOTICE };
  }

  /** 查单。 */
  async getByOrderNo(orderNo: string) {
    this.prisma.ensureAvailable();
    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order) throw new AppError(ErrorCodes.ORDER_NOT_FOUND, `订单不存在: ${orderNo}`);
    return { order: this.toOrderView(order), compliance: COMPLIANCE_NOTICE };
  }

  /**
   * Mock 支付（本地/测试）。仅 provider==='mock' 允许——真实 provider 必须走网关回调，
   * 不能靠此端点开后门。等价于构造一次 mock 回调。
   */
  async payMock(orderNo: string, dto: PayOrderDto) {
    this.prisma.ensureAvailable();
    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order) throw new AppError(ErrorCodes.ORDER_NOT_FOUND, `订单不存在: ${orderNo}`);
    if (order.provider !== 'mock') {
      throw new AppError(
        ErrorCodes.PAYMENT_PROVIDER_MISMATCH,
        '该订单需通过真实支付网关完成，不支持测试支付',
        { provider: order.provider },
      );
    }
    const verify = await this.paymentProvider.verifyNotify({
      orderNo,
      outcome: dto.outcome ?? 'success',
    });
    const updated = verify.paid ? await this.markPaid(order, verify) : await this.markFailed(order);
    return { order: this.toOrderView(updated), compliance: COMPLIANCE_NOTICE };
  }

  /**
   * 网关异步回调。按 URL 段选 provider 验签 → 解析 → markPaid/markFailed。
   * 返回对应 provider 的 ack body。骨架期非 mock 段的 verifyNotify 直接抛（未接入）。
   */
  async handleNotify(
    providerSegment: string,
    rawBody: unknown,
    headers?: Record<string, string>,
  ): Promise<unknown> {
    this.prisma.ensureAvailable();
    const provider = this.providerForSegment(providerSegment);
    const verify = await provider.verifyNotify(rawBody, headers); // 验签失败/未接入在此抛
    const order = await this.prisma.order.findUnique({ where: { orderNo: verify.orderNo } });
    if (!order) throw new AppError(ErrorCodes.ORDER_NOT_FOUND, `订单不存在: ${verify.orderNo}`);
    if (verify.paid) await this.markPaid(order, verify);
    else await this.markFailed(order);
    return provider.ackBody(true);
  }

  // -------------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------------

  /** URL 段 → provider 实例（mock 段可成功；wechat/alipay 段骨架期 verifyNotify 会抛）。 */
  private providerForSegment(seg: string): PaymentProvider {
    switch (seg) {
      case 'mock':
        return new MockPaymentProvider();
      case 'wechat':
        return new WechatPayProvider();
      case 'alipay':
        return new AlipayProvider();
      default:
        throw new AppError(ErrorCodes.VALIDATION_FAILED, `未知支付渠道: ${seg}`);
    }
  }

  /**
   * CAS 幂等置 PAID + 首次履约。
   * 金额对账不符 → 不置 PAID、落 payMeta、warn（防篡改）。
   * updateMany 命中 1 行 = 首次成功 → 触发履约一次；命中 0 行 = 已处理，不重复履约。
   */
  private async markPaid(order: Order, verify: VerifyNotifyResult): Promise<Order> {
    // 服务端对账：回调带金额且与订单不符 → 拒绝置 PAID
    if (verify.amountFen != null && verify.amountFen !== order.amountFen) {
      this.logger.warn(
        `订单 ${order.orderNo} 回调金额不符: 期望 ${order.amountFen} 实收 ${verify.amountFen}`,
      );
      const flagged = await this.prisma.order.update({
        where: { orderNo: order.orderNo },
        data: {
          payMeta: {
            reconcileError: 'AMOUNT_MISMATCH',
            expectedFen: order.amountFen,
            gotFen: verify.amountFen,
          },
        },
      });
      return flagged;
    }

    const res = await this.prisma.order.updateMany({
      where: { orderNo: order.orderNo, status: OrderStatus.CREATED },
      data: {
        status: OrderStatus.PAID,
        paidAt: new Date(),
        providerTxnId: verify.providerTxnId ?? null,
        ...(verify.raw != null ? { payMeta: verify.raw as object } : {}),
      },
    });

    const current = await this.prisma.order.findUnique({ where: { orderNo: order.orderNo } });
    if (res.count === 1) {
      // 首次成功：履约一次（best-effort，异常不影响支付语义）
      if (current) await this.fulfillment.fulfill(current);
      return current ?? order;
    }
    // 命中 0 行：已处理
    if (current?.status === OrderStatus.PAID) {
      if (current.providerTxnId && verify.providerTxnId && current.providerTxnId !== verify.providerTxnId) {
        this.logger.warn(`订单 ${order.orderNo} 可疑重复回调：txnId 不一致`);
      }
      return current; // 幂等成功，不重复履约
    }
    this.logger.warn(`订单 ${order.orderNo} 状态 ${current?.status} 不接受支付回调`);
    return current ?? order;
  }

  /** 置 FAILED（仅 CREATED → FAILED）。 */
  private async markFailed(order: Order): Promise<Order> {
    await this.prisma.order.updateMany({
      where: { orderNo: order.orderNo, status: OrderStatus.CREATED },
      data: { status: OrderStatus.FAILED },
    });
    const current = await this.prisma.order.findUnique({ where: { orderNo: order.orderNo } });
    return current ?? order;
  }

  /** 订单视图：剔除内部 id/userId 等。 */
  private toOrderView(order: Order): OrderView {
    return {
      orderNo: order.orderNo,
      skuCode: order.skuCode,
      subject: order.subject,
      amountFen: order.amountFen,
      currency: order.currency,
      provider: order.provider,
      status: order.status,
      providerTxnId: order.providerTxnId,
      paidAt: order.paidAt,
      registrationId: order.registrationId,
      createdAt: order.createdAt,
    };
  }
}
