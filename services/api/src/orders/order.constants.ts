import { randomInt } from 'node:crypto';
import { AppError, ErrorCodes } from '../common/errors/app-error';

/**
 * 履约类型：决定支付成功后 OrderFulfillmentService 做什么。
 * UNLOCK_CERT=解锁/触发电子证书；PHYSICAL_*=实物待发货（本期仅记录）；
 * DUAL_STAR=双星解锁（履约同 UNLOCK_CERT）；MEMORIAL_BOOK=触发纪念册（占位）。
 */
export type FulfillmentKind =
  | 'UNLOCK_CERT'
  | 'PHYSICAL_CERT'
  | 'PHYSICAL_GIFT'
  | 'DUAL_STAR'
  | 'MEMORIAL_BOOK';

export interface SkuDef {
  skuCode: string;
  nameZh: string;
  nameEn: string;
  /** 单位分。 */
  priceFen: number;
  currency: 'CNY';
  /** true 则下单必须带有效 registrationNo。 */
  requiresRegistration: boolean;
  fulfillment: FulfillmentKind;
  descriptionZh: string;
}

/** SKU 目录：金额只在服务端从此表取，前端只传 skuCode，永不信任前端金额。 */
export const SKU_CATALOG: Readonly<Record<string, SkuDef>> = Object.freeze({
  CERT_DIGITAL: {
    skuCode: 'CERT_DIGITAL',
    nameZh: '电子纪念证书',
    nameEn: 'Digital Certificate',
    priceFen: 1900,
    currency: 'CNY',
    requiresRegistration: true,
    fulfillment: 'UNLOCK_CERT',
    descriptionZh: '高清电子证书 + 专属星图，命名后即时生成下载',
  },
  CERT_PRINT: {
    skuCode: 'CERT_PRINT',
    nameZh: '纸质纪念证书',
    nameEn: 'Printed Certificate',
    priceFen: 9900,
    currency: 'CNY',
    requiresRegistration: true,
    fulfillment: 'PHYSICAL_CERT',
    descriptionZh: '博物馆级纸质证书裱框，顺丰包邮',
  },
  GIFT_BOX: {
    skuCode: 'GIFT_BOX',
    nameZh: '星辰纪念礼盒',
    nameEn: 'Memorial Gift Box',
    priceFen: 29900,
    currency: 'CNY',
    requiresRegistration: true,
    fulfillment: 'PHYSICAL_GIFT',
    descriptionZh: '证书 + 星图 + 定制信笺礼盒装',
  },
  DUAL_STAR: {
    skuCode: 'DUAL_STAR',
    nameZh: '双星纪念',
    nameEn: 'Dual Star',
    priceFen: 3900,
    currency: 'CNY',
    requiresRegistration: true,
    fulfillment: 'DUAL_STAR',
    descriptionZh: '两颗真实星体的联名纪念命名',
  },
  MEMORIAL_BOOK: {
    skuCode: 'MEMORIAL_BOOK',
    nameZh: '纪念册',
    nameEn: 'Memorial Album',
    priceFen: 6900,
    currency: 'CNY',
    requiresRegistration: true,
    fulfillment: 'MEMORIAL_BOOK',
    descriptionZh: '收录纪念故事、照片与星图的电子/实体纪念册',
  },
});

/** 取 SKU，未知则抛 SKU_NOT_FOUND（封装 noUncheckedIndexedAccess 的 undefined 判定）。 */
export function getSkuOrThrow(skuCode: string): SkuDef {
  const sku = SKU_CATALOG[skuCode];
  if (!sku) throw new AppError(ErrorCodes.SKU_NOT_FOUND, `未知商品: ${skuCode}`);
  return sku;
}

/** 去混淆字母表：排除 0/O/1/I/L，共 31 字符（与 registration-no 一致）。 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/**
 * 订单号：ORD-YYYYMMDD-XXXXXX（6 位后缀，CSPRNG）。
 * 唯一性由 orderNo @unique 兜底，冲突时上层重试。
 */
export function makeOrderNo(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += ALPHABET[randomInt(ALPHABET.length)]!;
  return `ORD-${y}${m}${d}-${suffix}`;
}

/** 支付 provider DI token。 */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
