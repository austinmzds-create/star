import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { CertificateStatus, type CertificateRecord } from '@prisma/client';
import { COMPLIANCE_NOTICE } from '../common/compliance';
import { AppError, ErrorCodes } from '../common/errors/app-error';
import { CelestialService } from '../celestial/celestial.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import type { StarSnapshot } from '../memorial/memorial.service';
import { CERT_JOB, CERT_QUEUE, TEMPLATE_VERSION, XML_DECL } from './certificate.constants';
import { optionalRequire } from './storage/oss-storage';
import { STORAGE_SERVICE, type StorageService } from './storage/storage.types';
import { renderCertificateSvg } from './svg/certificate-template';
import { angularSeparationDeg } from './svg/projection';
import { renderStarMapSvg, type StarMapNeighbor } from './svg/star-map';

/** BullMQ Queue 的最小使用面（避免在无 Redis 环境强依赖 bullmq 类型）。 */
interface QueueLike {
  add(name: string, data: unknown, opts?: unknown): Promise<unknown>;
}

/** 证书 DTO：对外响应形状（含合规声明）。 */
export interface CertificateDto {
  registrationNo: string;
  status: CertificateStatus;
  templateVersion: string;
  assetFormat: string;
  certUrl: string | null;
  starMapUrl: string | null;
  updatedAt: Date | null;
  error?: string;
  compliance: string;
}

/** 公开页用的已就绪资产（仅 READY 才返回）。 */
export interface PublicCertificateAssets {
  status: 'READY';
  certUrl: string;
  starMapUrl: string;
}

/**
 * 证书生成核心业务 + 降级。
 * 无 Redis / 无 Queue / 入队失败 → 同步 generateAndPersist；无 OSS → 本地磁盘；无 sharp → 只出 SVG。
 * 模块依赖单向 memorial → certificate；本服务自持 prisma 查登记，不反向依赖 memorial。
 */
@Injectable()
export class CertificateService {
  private readonly logger = new Logger(CertificateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly celestial: CelestialService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    @Optional() @Inject(getQueueToken(CERT_QUEUE)) private readonly queue?: QueueLike,
  ) {}

  /** POST 触发（幂等）：READY/GENERATING 直接返回；否则入队或同步生成。 */
  async enqueueOrRun(registrationNo: string): Promise<CertificateDto> {
    this.prisma.ensureAvailable();
    const reg = await this.prisma.memorialRegistration.findUnique({ where: { registrationNo } });
    if (!reg) {
      throw new AppError(ErrorCodes.REGISTRATION_NOT_FOUND, `纪念登记不存在: ${registrationNo}`);
    }

    // 幂等 upsert（registrationId + templateVersion 唯一）
    const record = await this.prisma.certificateRecord.upsert({
      where: {
        registrationId_templateVersion: {
          registrationId: reg.id,
          templateVersion: TEMPLATE_VERSION,
        },
      },
      create: {
        registrationId: reg.id,
        templateVersion: TEMPLATE_VERSION,
        status: CertificateStatus.PENDING,
      },
      update: {},
    });

    if (record.status === CertificateStatus.READY) return this.toDto(reg.registrationNo, record);
    if (record.status === CertificateStatus.GENERATING)
      return this.toDto(reg.registrationNo, record);

    // PENDING 或 FAILED（可重试）：尝试入队，失败落穿到同步
    if (this.queue && this.redis.getStatus() === 'up') {
      try {
        await this.prisma.certificateRecord.update({
          where: { id: record.id },
          data: { status: CertificateStatus.GENERATING, error: null },
        });
        await this.queue.add(
          CERT_JOB,
          { certRecordId: record.id, registrationId: reg.id },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: true,
            removeOnFail: false,
          },
        );
        return this.toDto(reg.registrationNo, { ...record, status: CertificateStatus.GENERATING });
      } catch (e) {
        this.logger.warn(`入队失败，转同步生成: ${(e as Error).message}`);
        // 落穿到同步
      }
    }

    const done = await this.generateAndPersist(record.id, reg.id, { rethrow: false });
    return this.toDto(reg.registrationNo, done);
  }

  /**
   * worker 与同步共用。生成证书 + 星图 → 存储 → 落库。
   * rethrow=true（worker）：失败置 FAILED 后 rethrow 触发 BullMQ 重试；
   * rethrow=false（同步 HTTP）：失败置 FAILED 后返回记录，不向 HTTP 抛错（纪念场景温柔）。
   */
  async generateAndPersist(
    certRecordId: string,
    registrationId: string,
    opts: { rethrow: boolean } = { rethrow: false },
  ): Promise<CertificateRecord> {
    try {
      await this.prisma.certificateRecord.update({
        where: { id: certRecordId },
        data: { status: CertificateStatus.GENERATING, error: null },
      });

      const reg = await this.prisma.memorialRegistration.findUniqueOrThrow({
        where: { id: registrationId },
      });
      const snap = reg.starSnapshotJson as unknown as StarSnapshot;

      const neighbors = this.findNeighbors(snap.raDeg, snap.decDeg, snap.objectUid, 20, 60);

      const certSvg = renderCertificateSvg({
        memorialName: reg.memorialName,
        occasionCode: reg.occasionType,
        memorialDateIso: reg.memorialDate ? reg.memorialDate.toISOString() : null,
        registrationNo: reg.registrationNo,
        blessingText: reg.blessingText,
        star: {
          nameZh: snap.nameZh,
          nameEn: snap.nameEn,
          constellationZh: snap.constellationZh,
          raDeg: snap.raDeg,
          decDeg: snap.decDeg,
          magnitude: snap.magnitude,
        },
        compliance: COMPLIANCE_NOTICE,
      });
      const mapSvg = renderStarMapSvg({
        target: {
          nameZh: snap.nameZh,
          raDeg: snap.raDeg,
          decDeg: snap.decDeg,
          magnitude: snap.magnitude,
          objectUid: snap.objectUid,
        },
        neighbors,
      });

      // PNG 可选（sharp 缺失/异常 → 只留 SVG）
      const certPng = await svgToPng(certSvg);
      const mapPng = await svgToPng(mapSvg);
      const fmtExt = certPng && mapPng ? 'png' : 'svg';
      const certBuf = certPng ?? Buffer.from(XML_DECL + certSvg, 'utf8');
      const mapBuf = mapPng ?? Buffer.from(XML_DECL + mapSvg, 'utf8');
      const ct = fmtExt === 'png' ? 'image/png' : 'image/svg+xml';

      const when = reg.createdAt ?? new Date();
      const ym = `${when.getUTCFullYear()}/${String(when.getUTCMonth() + 1).padStart(2, '0')}`;
      const certKey = `certificates/${ym}/${reg.registrationNo}-${TEMPLATE_VERSION}.${fmtExt}`;
      const mapKey = `starmaps/${ym}/${reg.registrationNo}-${TEMPLATE_VERSION}.${fmtExt}`;

      const [c, m] = await Promise.all([
        this.storage.put(certKey, certBuf, ct),
        this.storage.put(mapKey, mapBuf, ct),
      ]);

      return await this.prisma.certificateRecord.update({
        where: { id: certRecordId },
        data: {
          status: CertificateStatus.READY,
          certObjectKey: c.key,
          starMapObjectKey: m.key,
          assetFormat: fmtExt,
          error: null,
        },
      });
    } catch (e) {
      const message = String((e as Error)?.message ?? e).slice(0, 500);
      await this.prisma.certificateRecord
        .update({
          where: { id: certRecordId },
          data: { status: CertificateStatus.FAILED, error: message },
        })
        .catch(() => undefined);
      if (opts.rethrow) throw e;
      return this.prisma.certificateRecord.findUniqueOrThrow({ where: { id: certRecordId } });
    }
  }

  /** GET 取状态与 URL。无记录 → PENDING/url null（尚未触发）。 */
  async getByRegistrationNo(registrationNo: string): Promise<CertificateDto> {
    this.prisma.ensureAvailable();
    const reg = await this.prisma.memorialRegistration.findUnique({ where: { registrationNo } });
    if (!reg) {
      throw new AppError(ErrorCodes.REGISTRATION_NOT_FOUND, `纪念登记不存在: ${registrationNo}`);
    }
    const record = await this.prisma.certificateRecord.findFirst({
      where: { registrationId: reg.id, templateVersion: TEMPLATE_VERSION },
    });
    if (!record) {
      return {
        registrationNo,
        status: CertificateStatus.PENDING,
        templateVersion: TEMPLATE_VERSION,
        assetFormat: 'svg',
        certUrl: null,
        starMapUrl: null,
        updatedAt: null,
        compliance: COMPLIANCE_NOTICE,
      };
    }
    return this.toDto(registrationNo, record);
  }

  /** 供 MemorialService 调用：仅 READY 返回对象，否则 null。内部吞异常（DB 抖动不拖垮公开页）。 */
  async getPublicAssets(registrationId: string): Promise<PublicCertificateAssets | null> {
    try {
      const record = await this.prisma.certificateRecord.findFirst({
        where: { registrationId, templateVersion: TEMPLATE_VERSION },
      });
      if (!record || record.status !== CertificateStatus.READY) return null;
      if (!record.certObjectKey || !record.starMapObjectKey) return null;
      const [certUrl, starMapUrl] = await Promise.all([
        this.storage.url(record.certObjectKey),
        this.storage.url(record.starMapObjectKey),
      ]);
      return { status: 'READY', certUrl, starMapUrl };
    } catch (e) {
      this.logger.warn(`getPublicAssets 忽略异常: ${(e as Error).message}`);
      return null;
    }
  }

  /** 记录 → DTO；READY 时经 storage.url 解析两 url（兼容 OSS 短时签名）。 */
  private async toDto(registrationNo: string, record: CertificateRecord): Promise<CertificateDto> {
    let certUrl: string | null = null;
    let starMapUrl: string | null = null;
    if (
      record.status === CertificateStatus.READY &&
      record.certObjectKey &&
      record.starMapObjectKey
    ) {
      [certUrl, starMapUrl] = await Promise.all([
        this.storage.url(record.certObjectKey),
        this.storage.url(record.starMapObjectKey),
      ]);
    }
    return {
      registrationNo,
      status: record.status,
      templateVersion: record.templateVersion,
      assetFormat: record.assetFormat,
      certUrl,
      starMapUrl,
      updatedAt: record.updatedAt ?? null,
      ...(record.status === CertificateStatus.FAILED && record.error
        ? { error: '证书生成失败，请稍后重试' }
        : {}),
      compliance: COMPLIANCE_NOTICE,
    };
  }

  /** 从活目录取邻域星（装饰性，不进快照）：radiusDeg 内、按星等升序、至多 limit 个，剔除目标自身。 */
  private findNeighbors(
    raDeg: number,
    decDeg: number,
    targetUid: string,
    radiusDeg: number,
    limit: number,
  ): StarMapNeighbor[] {
    return this.celestial
      .listAll()
      .filter((o) => o.objectUid !== targetUid)
      .map((o) => ({ o, sep: angularSeparationDeg(raDeg, decDeg, o.raDeg, o.decDeg) }))
      .filter((x) => x.sep <= radiusDeg)
      .sort((a, b) => a.o.magnitude - b.o.magnitude)
      .slice(0, limit)
      .map((x) => ({
        nameZh: x.o.nameZh,
        raDeg: x.o.raDeg,
        decDeg: x.o.decDeg,
        magnitude: x.o.magnitude,
        objectUid: x.o.objectUid,
      }));
  }
}

/**
 * SVG → PNG（可选）。sharp 缺失/异常一律返回 null 降级只留 SVG，绝不 crash。
 * 注意：sharp 栅格化 SVG 文本依赖系统中文字体，容器多半缺字库 → PNG 中文可能豆腐块，
 * 故 SVG 为权威产物，PNG 仅可选增强。
 */
async function svgToPng(svg: string): Promise<Buffer | null> {
  const sharp = optionalRequire('sharp') as
    | ((input: Buffer) => { png(): { toBuffer(): Promise<Buffer> } })
    | null;
  if (!sharp) return null;
  try {
    return await sharp(Buffer.from(svg, 'utf8')).png().toBuffer();
  } catch {
    return null;
  }
}
