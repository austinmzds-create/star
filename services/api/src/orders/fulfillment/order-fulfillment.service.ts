import { Injectable, Logger } from '@nestjs/common';
import type { Order } from '@prisma/client';
import { CertificateService } from '../../certificate/certificate.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SKU_CATALOG } from '../order.constants';

/**
 * 支付成功后的履约分派（弱耦合）。best-effort：任何异常只 log，绝不回滚已 PAID 的订单。
 * 调用点唯一：markPaid 首次成功（CAS 命中 1 行）之后触发一次。
 */
@Injectable()
export class OrderFulfillmentService {
  private readonly logger = new Logger(OrderFulfillmentService.name);

  constructor(
    private readonly cert: CertificateService,
    private readonly prisma: PrismaService,
  ) {}

  /** 按 sku.fulfillment 分派履约。 */
  async fulfill(order: Order): Promise<void> {
    const sku = SKU_CATALOG[order.skuCode];
    if (!sku) {
      this.logger.warn(`未知 SKU 无法履约: ${order.skuCode}`);
      return;
    }
    try {
      switch (sku.fulfillment) {
        case 'UNLOCK_CERT':
        case 'DUAL_STAR': {
          const reg = order.registrationId
            ? await this.prisma.memorialRegistration.findUnique({
                where: { id: order.registrationId },
              })
            : null;
          if (reg) await this.cert.enqueueOrRun(reg.registrationNo); // 幂等，安全
          break;
        }
        case 'MEMORIAL_BOOK':
          // 纪念册由 AlbumService 提供；为避免对其编译期硬依赖，本期占位 log。
          // 落地后可在此注入 AlbumService.enqueueOrRun(reg.registrationNo)。
          this.logger.log(`纪念册履约占位: order=${order.orderNo}`);
          break;
        case 'PHYSICAL_CERT':
        case 'PHYSICAL_GIFT':
          // 实物：本期仅记录（未来接 WMS/物流）。
          this.logger.log(`实物待发货: order=${order.orderNo}`);
          break;
      }
    } catch (e) {
      this.logger.warn(`履约失败(不影响支付): ${(e as Error).message}`);
    }
  }
}
