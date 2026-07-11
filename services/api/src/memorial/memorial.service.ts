import { Inject, Injectable } from '@nestjs/common';
import {
  CoupleRole,
  OccasionType,
  RegistrationStatus,
  type CoupleGroup,
  type MemorialRegistration,
} from '@prisma/client';
import type { CelestialObject } from '@star/astro-data';
import { COMPLIANCE_NOTICE } from '../common/compliance';
import { AppError, ErrorCodes } from '../common/errors/app-error';
import { makePublicSlug } from '../common/ids/public-slug';
import { makeRegistrationNo } from '../common/ids/registration-no';
import { CelestialService } from '../celestial/celestial.service';
import { CertificateService } from '../certificate/certificate.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CONTENT_MODERATION,
  type ContentModeration,
  type ModerationResult,
} from './moderation/moderation.types';
import type { CreateRegistrationDto } from './dto/create-registration.dto';
import type { CreateCoupleDto } from './dto/create-couple.dto';

/** 登记时刻的星体快照：证书与纪念页以此为准，不受未来星表数据修订影响。 */
export interface StarSnapshot {
  objectUid: string;
  nameZh: string;
  nameEn: string;
  constellationZh: string;
  raDeg: number;
  decDeg: number;
  magnitude: number;
}

/** 编号/slug 生成的最大重试次数（DB @unique 冲突时重新生成）。 */
const MAX_ID_RETRIES = 5;

/** Prisma 唯一约束冲突（P2002）判定：不依赖具体错误类实例，便于单测构造。 */
function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code: unknown }).code === 'P2002'
  );
}

/**
 * 纪念登记核心业务。
 *
 * 设计决策：Prisma 硬依赖，无内存 fallback——编号/slug 是对用户的持久承诺，
 * 内存实现重启即失效属于商业事故而非降级。无 DB 时统一返回 503 DB_UNAVAILABLE。
 */
@Injectable()
export class MemorialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly celestial: CelestialService,
    @Inject(CONTENT_MODERATION) private readonly moderation: ContentModeration,
    private readonly certificate: CertificateService,
  ) {}

  /** 创建纪念登记。校验链：DB 可用 → 星体存在且可命名 → 内容审核 → 落库（唯一冲突重试）。 */
  async create(dto: CreateRegistrationDto) {
    this.prisma.ensureAvailable();

    // 星体存在性（404）与可命名性（422）在此抛出
    const star = this.celestial.getNamableByUid(dto.starObjectUid);

    // 内容审核：reject → 422；review → 创建但置为待复审
    const verdict = await this.moderation.check(
      [dto.memorialName, dto.blessingText, dto.storyText].filter(Boolean).join('\n'),
    );
    if (verdict.verdict === 'reject') {
      throw new AppError(ErrorCodes.CONTENT_REJECTED, '内容包含不适宜文本', {
        reason: verdict.reason,
      });
    }
    const status = this.decideInitialStatus(dto, verdict);

    // 唯一约束冲突（P2002）时重新生成编号/slug 再试，最多 MAX_ID_RETRIES 次
    for (let attempt = 0; attempt < MAX_ID_RETRIES; attempt++) {
      try {
        const created = await this.prisma.memorialRegistration.create({
          data: {
            ...this.buildRegistrationData({
              star,
              memorialName: dto.memorialName,
              occasionType: dto.occasionType,
              memorialDate: dto.memorialDate ?? null,
              blessingText: dto.blessingText ?? null,
              status,
            }),
            contactEmail: dto.contactEmail ?? null,
            storyText: dto.storyText ?? null,
          },
        });
        return { registration: this.toOwnerView(created), compliance: COMPLIANCE_NOTICE };
      } catch (e) {
        if (isUniqueViolation(e)) continue;
        throw e;
      }
    }
    throw new AppError(ErrorCodes.INTERNAL_ERROR, '编号生成冲突，请重试');
  }

  /**
   * 创建情侣双星登记。校验链：DB 可用 → 同星校验 → 两星存在且可命名 → 合并内容审核
   * → 事务创建 CoupleGroup + 两条 MemorialRegistration（任一唯一冲突整体回滚重试）。
   */
  async createCouple(dto: CreateCoupleDto) {
    this.prisma.ensureAvailable();

    // 1. 同星校验（400）
    if (dto.starA.starObjectUid === dto.starB.starObjectUid) {
      throw new AppError(ErrorCodes.COUPLE_SAME_STAR, '情侣双星不能是同一颗星', {
        objectUid: dto.starA.starObjectUid,
      });
    }

    // 2. 两颗星存在性 + 可命名性（404 / 422）
    const starA = this.celestial.getNamableByUid(dto.starA.starObjectUid);
    const starB = this.celestial.getNamableByUid(dto.starB.starObjectUid);

    // 3. 合并内容审核（两名字 + 两祝福 + 关系标签 + 合并祝福）
    const verdict = await this.moderation.check(
      [
        dto.starA.memorialName,
        dto.starB.memorialName,
        dto.starA.blessingText,
        dto.starB.blessingText,
        dto.relationLabel,
        dto.coupleBlessing,
      ]
        .filter(Boolean)
        .join('\n'),
    );
    if (verdict.verdict === 'reject') {
      throw new AppError(ErrorCodes.CONTENT_REJECTED, '内容包含不适宜文本', {
        reason: verdict.reason,
      });
    }
    const occasion = dto.occasionType ?? OccasionType.LOVE;
    const status = this.decideCoupleStatus(dto, verdict);

    // 4. 事务创建 group + 两条登记；任一 @unique 冲突整体回滚换新 ID 重试
    for (let attempt = 0; attempt < MAX_ID_RETRIES; attempt++) {
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          const group = await tx.coupleGroup.create({
            data: {
              coupleSlug: makePublicSlug(),
              relationLabel: dto.relationLabel ?? null,
              coupleBlessing: dto.coupleBlessing ?? null,
            },
          });
          const regA = await tx.memorialRegistration.create({
            data: {
              ...this.buildRegistrationData({
                star: starA,
                memorialName: dto.starA.memorialName,
                occasionType: occasion,
                memorialDate: dto.memorialDate ?? null,
                blessingText: dto.starA.blessingText ?? null,
                status,
              }),
              contactEmail: dto.contactEmail ?? null,
              coupleGroupId: group.id,
              coupleRole: CoupleRole.A,
            },
          });
          const regB = await tx.memorialRegistration.create({
            data: {
              ...this.buildRegistrationData({
                star: starB,
                memorialName: dto.starB.memorialName,
                occasionType: occasion,
                memorialDate: dto.memorialDate ?? null,
                blessingText: dto.starB.blessingText ?? null,
                status,
              }),
              contactEmail: dto.contactEmail ?? null,
              coupleGroupId: group.id,
              coupleRole: CoupleRole.B,
            },
          });
          return { group, regA, regB };
        });
        return this.toCoupleCreateView(result.group, result.regA, result.regB);
      } catch (e) {
        if (isUniqueViolation(e)) continue; // 编号/slug/coupleSlug 任一冲突 → 换新 ID 重试
        throw e;
      }
    }
    throw new AppError(ErrorCodes.INTERNAL_ERROR, '编号生成冲突，请重试');
  }

  /** 情侣公开页数据：仅两成员皆 ACTIVE 可见；否则一律 COUPLE_PAGE_NOT_FOUND。 */
  async findCouplePublicBySlug(coupleSlug: string) {
    this.prisma.ensureAvailable();
    const group = await this.prisma.coupleGroup.findUnique({
      where: { coupleSlug },
      include: { registrations: true },
    });
    // 门控：group 存在 + 恰两条成员 + 两条皆 ACTIVE（复用现有 admin approve/reject，无需改后台）
    if (
      !group ||
      group.registrations.length < 2 ||
      group.registrations.some((r) => r.status !== RegistrationStatus.ACTIVE)
    ) {
      throw new AppError(ErrorCodes.COUPLE_PAGE_NOT_FOUND, '情侣纪念页不存在');
    }
    const sorted = [...group.registrations].sort((a, b) =>
      (a.coupleRole ?? '').localeCompare(b.coupleRole ?? ''),
    );
    const stars = await Promise.all(
      sorted.map(async (reg) => ({
        role: reg.coupleRole,
        registrationNo: reg.registrationNo,
        memorialName: reg.memorialName,
        blessingText: reg.blessingText,
        star: reg.starSnapshotJson as unknown as StarSnapshot,
        certificate: await this.certificate.getPublicAssets(reg.id), // 未就绪 null
      })),
    );
    const first = sorted[0]!;
    return {
      couple: {
        coupleSlug: group.coupleSlug,
        relationLabel: group.relationLabel,
        coupleBlessing: group.coupleBlessing,
        occasionType: first.occasionType,
        memorialDate: this.formatDate(first.memorialDate),
        createdAt: group.createdAt,
        stars,
      },
      compliance: COMPLIANCE_NOTICE,
    };
  }

  /** 凭纪念编号查询（登记人自查，任何 status 均可见）。 */
  async findByRegistrationNo(registrationNo: string) {
    this.prisma.ensureAvailable();
    const reg = await this.prisma.memorialRegistration.findUnique({
      where: { registrationNo },
    });
    if (!reg) {
      throw new AppError(
        ErrorCodes.REGISTRATION_NOT_FOUND,
        `纪念登记不存在: ${registrationNo}`,
      );
    }
    return {
      registration: { ...this.toOwnerView(reg), storyText: reg.storyText },
      compliance: COMPLIANCE_NOTICE,
    };
  }

  /** 公开纪念页数据：仅 ACTIVE 可见；不存在/未过审一律 404（避免枚举探测）。 */
  async findPublicBySlug(publicSlug: string) {
    this.prisma.ensureAvailable();
    const reg = await this.prisma.memorialRegistration.findUnique({
      where: { publicSlug },
    });
    // 查回来再判状态（而非放进 where），便于 mock 与未来区分日志
    if (!reg || reg.status !== RegistrationStatus.ACTIVE) {
      throw new AppError(ErrorCodes.MEMORIAL_PAGE_NOT_FOUND, '纪念页不存在');
    }
    // 已就绪的证书/星图资产挂在公开视图（未就绪 → null）；DB 抖动内部吞掉不拖垮公开页
    const certificate = await this.certificate.getPublicAssets(reg.id);
    return {
      memorial: { ...this.toPublicView(reg), certificate },
      compliance: COMPLIANCE_NOTICE,
    };
  }

  /** 初始状态决策：复审词 → 待审；干净内容默认 ACTIVE；REVIEW_ALL_FREETEXT=1 时自由文本也走待审。 */
  private decideInitialStatus(
    dto: CreateRegistrationDto,
    verdict: ModerationResult,
  ): RegistrationStatus {
    if (verdict.verdict === 'review') return RegistrationStatus.PENDING_REVIEW;
    if (process.env.REVIEW_ALL_FREETEXT === '1' && (dto.blessingText || dto.storyText)) {
      return RegistrationStatus.PENDING_REVIEW;
    }
    return RegistrationStatus.ACTIVE;
  }

  /** 情侣双星初始状态决策：复审词 → 待审；REVIEW_ALL_FREETEXT=1 且有任一自由文本 → 待审。 */
  private decideCoupleStatus(dto: CreateCoupleDto, verdict: ModerationResult): RegistrationStatus {
    if (verdict.verdict === 'review') return RegistrationStatus.PENDING_REVIEW;
    if (
      process.env.REVIEW_ALL_FREETEXT === '1' &&
      (dto.starA.blessingText || dto.starB.blessingText || dto.coupleBlessing)
    ) {
      return RegistrationStatus.PENDING_REVIEW;
    }
    return RegistrationStatus.ACTIVE;
  }

  /** 由星体构造登记快照（create 与 createCouple 共用）。 */
  private buildStarSnapshot(star: CelestialObject): StarSnapshot {
    return {
      objectUid: star.objectUid,
      nameZh: star.nameZh,
      nameEn: star.nameEn,
      constellationZh: star.constellationZh,
      raDeg: star.raDeg,
      decDeg: star.decDeg,
      magnitude: star.magnitude,
    };
  }

  /**
   * 构造一条 memorialRegistration 的写入 data 子集（不含 couple 字段与 contactEmail/storyText）。
   * 每次调用生成新的 registrationNo/publicSlug，供 P2002 重试换新 ID。
   */
  private buildRegistrationData(args: {
    star: CelestialObject;
    memorialName: string;
    occasionType: OccasionType;
    memorialDate: string | null;
    blessingText: string | null;
    status: RegistrationStatus;
  }) {
    return {
      registrationNo: makeRegistrationNo(),
      publicSlug: makePublicSlug(),
      starObjectUid: args.star.objectUid,
      starSnapshotJson: { ...this.buildStarSnapshot(args.star) },
      memorialName: args.memorialName,
      occasionType: args.occasionType,
      memorialDate: args.memorialDate ? new Date(`${args.memorialDate}T00:00:00Z`) : null,
      blessingText: args.blessingText,
      status: args.status,
    };
  }

  /** 情侣创建响应组装：顶层 status 为聚合值（皆 ACTIVE → ACTIVE，否则 PENDING_REVIEW）。 */
  private toCoupleCreateView(
    group: CoupleGroup,
    a: MemorialRegistration,
    b: MemorialRegistration,
  ) {
    const agg = [a, b].every((r) => r.status === RegistrationStatus.ACTIVE)
      ? RegistrationStatus.ACTIVE
      : RegistrationStatus.PENDING_REVIEW;
    const unit = (r: MemorialRegistration) => ({
      role: r.coupleRole,
      registrationNo: r.registrationNo,
      publicSlug: r.publicSlug,
      status: r.status,
      memorialName: r.memorialName,
      blessingText: r.blessingText,
      star: r.starSnapshotJson as unknown as StarSnapshot,
    });
    return {
      couple: {
        coupleSlug: group.coupleSlug,
        relationLabel: group.relationLabel,
        coupleBlessing: group.coupleBlessing,
        occasionType: a.occasionType,
        memorialDate: this.formatDate(a.memorialDate),
        status: agg,
        createdAt: group.createdAt,
        registrations: [unit(a), unit(b)],
      },
      compliance: COMPLIANCE_NOTICE,
    };
  }

  /** 登记人视图：绝不含 contactEmail / reviewNote / 内部 id / ownerUserId。 */
  private toOwnerView(reg: MemorialRegistration) {
    return {
      registrationNo: reg.registrationNo,
      publicSlug: reg.publicSlug,
      status: reg.status,
      memorialName: reg.memorialName,
      occasionType: reg.occasionType,
      memorialDate: this.formatDate(reg.memorialDate),
      blessingText: reg.blessingText,
      createdAt: reg.createdAt,
      star: reg.starSnapshotJson as unknown as StarSnapshot,
    };
  }

  /** 公开视图：隐私最小集（registrationNo 印在证书上本就公开，予以保留）。 */
  private toPublicView(reg: MemorialRegistration) {
    return {
      registrationNo: reg.registrationNo,
      memorialName: reg.memorialName,
      occasionType: reg.occasionType,
      memorialDate: this.formatDate(reg.memorialDate),
      blessingText: reg.blessingText,
      storyText: reg.storyText,
      createdAt: reg.createdAt,
      star: reg.starSnapshotJson as unknown as StarSnapshot,
    };
  }

  /** DB @db.Date → 'YYYY-MM-DD'（无时区语义）。 */
  private formatDate(d: Date | null): string | null {
    return d ? d.toISOString().slice(0, 10) : null;
  }
}
