import { getQueueToken } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { CertificateStatus, type AlbumRecord } from '@prisma/client';
import { COMPLIANCE_NOTICE } from '../common/compliance';
import { AppError, ErrorCodes } from '../common/errors/app-error';
import { AgentService } from '../agent/agent.service';
import { CelestialService } from '../celestial/celestial.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { XML_DECL } from '../certificate/certificate.constants';
import { optionalRequire } from '../certificate/storage/oss-storage';
import { STORAGE_SERVICE, type StorageService } from '../certificate/storage/storage.types';
import { angularSeparationDeg } from '../certificate/svg/projection';
import type { StarMapNeighbor } from '../certificate/svg/star-map';
import type { StarSnapshot } from '../memorial/memorial.service';
import {
  renderTemplate,
  type CosmicLetterOutput,
} from '../agent/skills/cosmic-letter.skill';
import { ALBUM_JOB, ALBUM_QUEUE, TEMPLATE_VERSION } from './album.constants';
import {
  renderAlbumCombined,
  renderAlbumPages,
  type AlbumPage,
  type AlbumPageName,
} from './svg/album-pages';

/** BullMQ Queue 的最小使用面（避免在无 Redis 环境强依赖 bullmq 类型）。 */
interface QueueLike {
  add(name: string, data: unknown, opts?: unknown): Promise<unknown>;
}

/** 纪念册页面 URL。 */
export interface AlbumPageUrl {
  name: AlbumPageName;
  url: string;
}

/** 纪念册 DTO：对外响应形状（含合规声明）。 */
export interface AlbumDto {
  registrationNo: string;
  status: CertificateStatus;
  templateVersion: string;
  assetFormat: string;
  albumUrl: string | null;
  pageUrls: AlbumPageUrl[];
  pageCount: number;
  letterMode: string | null;
  updatedAt: Date | null;
  error?: string;
  compliance: string;
}

/**
 * 纪念册生成核心业务 + 降级。复刻证书 enqueueOrRun/generateAndPersist 幂等与降级模式。
 * 宇宙来信页调 AgentService.runSkill('cosmic-letter')，失败/无 key 降级模板，绝不拖垮整册。
 */
@Injectable()
export class AlbumService {
  private readonly logger = new Logger(AlbumService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly celestial: CelestialService,
    private readonly agent: AgentService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    @Optional() @Inject(getQueueToken(ALBUM_QUEUE)) private readonly queue?: QueueLike,
  ) {}

  /** POST 触发（幂等）：READY/GENERATING 直接返回；否则入队或同步生成。 */
  async enqueueOrRun(registrationNo: string): Promise<AlbumDto> {
    this.prisma.ensureAvailable();
    const reg = await this.prisma.memorialRegistration.findUnique({ where: { registrationNo } });
    if (!reg) {
      throw new AppError(ErrorCodes.REGISTRATION_NOT_FOUND, `纪念登记不存在: ${registrationNo}`);
    }

    const record = await this.prisma.albumRecord.upsert({
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
        await this.prisma.albumRecord.update({
          where: { id: record.id },
          data: { status: CertificateStatus.GENERATING, error: null },
        });
        await this.queue.add(
          ALBUM_JOB,
          { albumRecordId: record.id, registrationId: reg.id },
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
      }
    }

    const done = await this.generateAndPersist(record.id, reg.id, { rethrow: false });
    return this.toDto(reg.registrationNo, done);
  }

  /**
   * worker 与同步共用。生成 6 页 + 合并长图 → 存储 → 落库。
   * rethrow=true（worker）：失败置 FAILED 后 rethrow 触发 BullMQ 重试；
   * rethrow=false（同步 HTTP）：失败置 FAILED 后返回记录，不向 HTTP 抛错。
   */
  async generateAndPersist(
    albumRecordId: string,
    registrationId: string,
    opts: { rethrow: boolean } = { rethrow: false },
  ): Promise<AlbumRecord> {
    try {
      await this.prisma.albumRecord.update({
        where: { id: albumRecordId },
        data: { status: CertificateStatus.GENERATING, error: null },
      });

      const reg = await this.prisma.memorialRegistration.findUniqueOrThrow({
        where: { id: registrationId },
      });
      const snap = reg.starSnapshotJson as unknown as StarSnapshot;

      const neighbors = this.findNeighbors(snap.raDeg, snap.decDeg, snap.objectUid, 20, 60);

      // 富化天文数据（活目录，找不到不抛错，便于测试 mock）
      const full = this.celestial.listAll().find((o) => o.objectUid === snap.objectUid);

      // 宇宙来信（skill 降级模板，极端兜底本地模板）
      const { letter, mode, taskId } = await this.buildLetter(reg, snap);

      const pages = renderAlbumPages({
        memorialName: reg.memorialName,
        occasionCode: reg.occasionType,
        memorialDateIso: reg.memorialDate ? reg.memorialDate.toISOString() : null,
        registrationNo: reg.registrationNo,
        blessingText: reg.blessingText,
        storyText: reg.storyText,
        letter,
        star: {
          nameZh: snap.nameZh,
          nameEn: snap.nameEn,
          constellationZh: snap.constellationZh,
          raDeg: snap.raDeg,
          decDeg: snap.decDeg,
          magnitude: snap.magnitude,
          distanceLy: full?.distanceLy ?? null,
          spectralType: full?.spectralType ?? null,
          catalogIds: { ...(full?.catalogIds ?? {}), uid: snap.objectUid },
        },
        neighbors,
        compliance: COMPLIANCE_NOTICE,
      });
      const combined = renderAlbumCombined(pages, reg.registrationNo, COMPLIANCE_NOTICE);

      // PNG 可选（仅对合并长图；sharp 缺失/异常 → 只留 SVG）
      const combinedPng = await svgToPng(combined);
      const fmt = combinedPng ? 'png' : 'svg';

      const when = reg.createdAt ?? new Date();
      const ym = `${when.getUTCFullYear()}/${String(when.getUTCMonth() + 1).padStart(2, '0')}`;
      const prefix = `albums/${ym}/${reg.registrationNo}-${TEMPLATE_VERSION}`;

      // 单页始终 SVG；合并图按 fmt
      const pagePuts = pages.map((p) =>
        this.storage.put(
          `${prefix}/${p.name}.svg`,
          Buffer.from(XML_DECL + p.svg, 'utf8'),
          'image/svg+xml',
        ),
      );
      const combinedKey = `${prefix}/album.${fmt}`;
      const combinedBuf = combinedPng ?? Buffer.from(XML_DECL + combined, 'utf8');
      const combinedCt = fmt === 'png' ? 'image/png' : 'image/svg+xml';
      const combinedPut = this.storage.put(combinedKey, combinedBuf, combinedCt);

      const [combinedObj, ...pageObjs] = await Promise.all([combinedPut, ...pagePuts]);
      const pageObjectKeys = pageObjs.map((o) => o.key);

      return await this.prisma.albumRecord.update({
        where: { id: albumRecordId },
        data: {
          status: CertificateStatus.READY,
          combinedObjectKey: combinedObj.key,
          pageObjectKeys,
          pageCount: pages.length,
          assetFormat: fmt,
          letterMode: mode,
          letterTaskId: taskId,
          error: null,
        },
      });
    } catch (e) {
      const message = String((e as Error)?.message ?? e).slice(0, 500);
      await this.prisma.albumRecord
        .update({
          where: { id: albumRecordId },
          data: { status: CertificateStatus.FAILED, error: message },
        })
        .catch(() => undefined);
      if (opts.rethrow) throw e;
      return this.prisma.albumRecord.findUniqueOrThrow({ where: { id: albumRecordId } });
    }
  }

  /** GET 取状态与 URL。无记录 → PENDING/url null（尚未触发）。 */
  async getByRegistrationNo(registrationNo: string): Promise<AlbumDto> {
    this.prisma.ensureAvailable();
    const reg = await this.prisma.memorialRegistration.findUnique({ where: { registrationNo } });
    if (!reg) {
      throw new AppError(ErrorCodes.REGISTRATION_NOT_FOUND, `纪念登记不存在: ${registrationNo}`);
    }
    const record = await this.prisma.albumRecord.findFirst({
      where: { registrationId: reg.id, templateVersion: TEMPLATE_VERSION },
    });
    if (!record) {
      return {
        registrationNo,
        status: CertificateStatus.PENDING,
        templateVersion: TEMPLATE_VERSION,
        assetFormat: 'svg',
        albumUrl: null,
        pageUrls: [],
        pageCount: 0,
        letterMode: null,
        updatedAt: null,
        compliance: COMPLIANCE_NOTICE,
      };
    }
    return this.toDto(registrationNo, record);
  }

  /** 私有：宇宙来信生成（skill 正常路径拿 mode，异常极端兜底本地模板）。 */
  private async buildLetter(
    reg: { occasionType: string; memorialName: string },
    snap: StarSnapshot,
  ): Promise<{ letter: string; mode: 'llm' | 'template'; taskId: string | null }> {
    try {
      const r = await this.agent.runSkill<CosmicLetterOutput>('cosmic-letter', {
        starNameZh: snap.nameZh,
        constellationZh: snap.constellationZh,
        occasion: reg.occasionType,
        memorialName: reg.memorialName,
      });
      return {
        letter: r.output.letter,
        mode: r.mode,
        taskId: r.taskNo === 'unpersisted' ? null : r.taskNo,
      };
    } catch (e) {
      this.logger.warn(`宇宙来信生成失败，册内降级模板: ${(e as Error).message}`);
      const letter = renderTemplate({
        starNameZh: snap.nameZh,
        constellationZh: snap.constellationZh,
        occasion: reg.occasionType as never,
        memorialName: reg.memorialName,
      });
      return { letter, mode: 'template', taskId: null };
    }
  }

  /** 记录 → DTO；READY 时经 storage.url 解析合并图与各页 url。 */
  private async toDto(registrationNo: string, record: AlbumRecord): Promise<AlbumDto> {
    let albumUrl: string | null = null;
    let pageUrls: AlbumPageUrl[] = [];
    if (record.status === CertificateStatus.READY && record.combinedObjectKey) {
      const names: AlbumPageName[] = [
        'cover',
        'star-map',
        'story',
        'letter',
        'astro',
        'dedication',
      ];
      const [combined, ...pages] = await Promise.all([
        this.storage.url(record.combinedObjectKey),
        ...record.pageObjectKeys.map((k) => this.storage.url(k)),
      ]);
      albumUrl = combined;
      pageUrls = pages.map((url, i) => ({ name: names[i] ?? ('cover' as AlbumPageName), url }));
    }
    return {
      registrationNo,
      status: record.status,
      templateVersion: record.templateVersion,
      assetFormat: record.assetFormat,
      albumUrl,
      pageUrls,
      pageCount: record.pageCount,
      letterMode: record.letterMode ?? null,
      updatedAt: record.updatedAt ?? null,
      ...(record.status === CertificateStatus.FAILED && record.error
        ? { error: '纪念册生成失败，请稍后重试' }
        : {}),
      compliance: COMPLIANCE_NOTICE,
    };
  }

  /** 邻域星（复刻证书 findNeighbors）：radiusDeg 内、按星等升序、至多 limit 个，剔除目标自身。 */
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
 * 复刻证书 svgToPng（保持模块自洽，不跨模块导出私有函数）。
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
