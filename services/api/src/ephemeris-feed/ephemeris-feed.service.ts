import { getQueueToken } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { builtinMinorBodiesResponse, builtinTleResponse } from './builtin-snapshot';
import {
  ASTEROID_TARGETS,
  celestrakGpUrl,
  FEED_QUEUE,
  FETCH_TIMEOUT_MS,
  JOB_REFRESH_MINOR_BODIES,
  JOB_REFRESH_TLE,
  MINOR_BODIES_CRON,
  MINOR_BODIES_INTERVAL_MS,
  RETRY_DELAYS_MS,
  SBDB_QUERY_URL,
  sbdbSingleUrl,
  TLE_INTERVAL_MS,
  TLE_TARGETS,
} from './feed.constants';
import type { MinorBodiesResponse, MinorBodyDto, TleResponse, TleSatDto } from './feed.types';
import {
  filterActiveComets,
  parseSbdbQueryResponse,
  parseSbdbSingleBody,
  type SbdbQueryResponse,
  type SbdbSingleResponse,
} from './sbdb.parser';
import { parseCelestrakTle, type ParsedTle } from './tle.parser';

/** BullMQ Queue 的最小使用面（避免在无 Redis 环境强依赖 bullmq 类型，模式同 CertificateService）。 */
interface QueueLike {
  add(name: string, data: unknown, opts?: unknown): Promise<unknown>;
}

/** Unix epoch ms → 儒略日（与 astro-ephem 同式）。 */
const msToJd = (ms: number): number => ms / 86400000 + 2440587.5;

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

/**
 * 星历订阅服务：JPL SBDB 彗星/小行星根数（每日）+ Celestrak TLE（每 6h）
 * 的服务端集中拉取、落库与降级。
 *
 * 数据流（三级降级，永不 500）：
 *   内存缓存（本进程最后成功批次）→ DB 快照（跨重启的最后成功批次）→ 内置兜底常量。
 * 写入纪律：解析/校验失败视为整轮（小天体）或单星（TLE）抓取失败，
 * 绝不写入半截数据——minor_body_elements 整表事务替换，tle_snapshot 逐星 upsert。
 *
 * 调度：有 Redis → BullMQ repeatable job（processor 驱动）；
 * 无 Redis → 进程内 setInterval 退化（unref，不阻塞退出；不保证 04:00 对齐，保证频率）。
 * 两种模式都在启动时先拉一次（冷启动即有新鲜数据；失败静默降级，不阻断启动）。
 */
@Injectable()
export class EphemerisFeedService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EphemerisFeedService.name);

  // —— 测试缝（spec 经 service['fetchFn'] 等注入，生产不改）——
  private fetchFn: typeof fetch = (input, init) => fetch(input, init);
  private retryDelaysMs: readonly number[] = RETRY_DELAYS_MS;
  private nowFn: () => Date = () => new Date();

  /** 小天体最后成功批次（进程内）。 */
  private mbCache: MinorBodiesResponse | null = null;
  /** TLE 最后成功批次（进程内）。 */
  private tleCache: TleResponse | null = null;
  /** TLE 节流锚点：上次尝试时刻（无论成败，防对 Celestrak 高频重试）。 */
  private lastTleAttemptMs = 0;
  /** 每颗卫星上次成功抓取时刻（If-Modified-Since 依据）。 */
  private readonly tleLastSuccessMs = new Map<string, number>();
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(getQueueToken(FEED_QUEUE)) private readonly queue?: QueueLike,
  ) {}

  /**
   * 启动编排。测试环境（NODE_ENV=test）或显式 EPHEMERIS_FEED_DISABLED=1 时完全静默，
   * 避免单测/CI 打上游。
   */
  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test' || process.env.EPHEMERIS_FEED_DISABLED === '1') return;

    // 冷启动先拉一次（多实例部署下每进程启动各一次，频率仍远低于上游节奏）
    void this.refreshMinorBodies().catch((e: Error) =>
      this.logger.warn(`启动拉取小天体根数失败，先用 DB/内置快照兜底：${e.message}`),
    );
    void this.refreshTle().catch((e: Error) =>
      this.logger.warn(`启动拉取 TLE 失败，先用 DB/内置快照兜底：${e.message}`),
    );

    if (this.queue) {
      // BullMQ repeatable job：jobId 固定 → 重启/多实例不重复注册
      void this.queue
        .add(JOB_REFRESH_MINOR_BODIES, {}, {
          repeat: { pattern: MINOR_BODIES_CRON },
          jobId: JOB_REFRESH_MINOR_BODIES,
          removeOnComplete: true,
          removeOnFail: 10,
        })
        .catch((e: Error) => this.logger.warn(`注册小天体 repeatable job 失败：${e.message}`));
      void this.queue
        .add(JOB_REFRESH_TLE, {}, {
          repeat: { every: TLE_INTERVAL_MS },
          jobId: JOB_REFRESH_TLE,
          removeOnComplete: true,
          removeOnFail: 10,
        })
        .catch((e: Error) => this.logger.warn(`注册 TLE repeatable job 失败：${e.message}`));
      return;
    }

    // 无 Redis 退化：进程内定时器（unref 不阻止进程退出）
    const mbTimer = setInterval(() => {
      void this.refreshMinorBodies().catch((e: Error) =>
        this.logger.warn(`定时刷新小天体根数失败（保留最后成功批次）：${e.message}`),
      );
    }, MINOR_BODIES_INTERVAL_MS);
    const tleTimer = setInterval(() => {
      void this.refreshTle().catch((e: Error) =>
        this.logger.warn(`定时刷新 TLE 失败（保留最后成功批次）：${e.message}`),
      );
    }, TLE_INTERVAL_MS);
    mbTimer.unref?.();
    tleTimer.unref?.();
    this.timers.push(mbTimer, tleTimer);
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearInterval(t);
  }

  /**
   * 带重试退避的上游请求。403 不重试（Celestrak 的限流信号，重试只会加重封禁风险）；
   * 304 视为成功透传（If-Modified-Since 命中）。
   */
  private async fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
    const attempts = this.retryDelaysMs.length + 1;
    let lastErr: unknown;
    for (let k = 0; k < attempts; k++) {
      if (k > 0) await sleep(this.retryDelaysMs[k - 1] ?? 0);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      timer.unref?.();
      try {
        const resp = await this.fetchFn(url, { ...init, signal: ctrl.signal });
        if (resp.ok || resp.status === 304) return resp;
        lastErr = new Error(`HTTP ${resp.status}`);
        if (resp.status === 403) break; // 限流信号：立即止损
      } catch (e) {
        lastErr = e;
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(`上游请求失败: ${url} — ${(lastErr as Error | undefined)?.message ?? '未知错误'}`);
  }

  // ============================== 小天体（每日）==============================

  /**
   * 拉取全量彗星（SBDB 批量）+ Ceres/Pallas/Vesta（SBDB 单体），
   * 过滤现役亮彗星（|tp−now|≤2 年 && M1≤12）+ 白名单（1P/2P/12P 永久保留），
   * 成功后整表替换 DB 并更新缓存。任何一步失败 → 抛错，最后成功批次不受影响。
   */
  async refreshMinorBodies(): Promise<MinorBodiesResponse> {
    const now = this.nowFn();
    const resp = await this.fetchWithRetry(SBDB_QUERY_URL);
    const queryJson = (await resp.json()) as SbdbQueryResponse;
    const comets = filterActiveComets(parseSbdbQueryResponse(queryJson), msToJd(now.getTime()));

    const asteroids: MinorBodyDto[] = [];
    for (const target of ASTEROID_TARGETS) {
      const single = await this.fetchWithRetry(sbdbSingleUrl(target.sstr));
      asteroids.push(parseSbdbSingleBody((await single.json()) as SbdbSingleResponse, target));
    }

    const result: MinorBodiesResponse = {
      updatedAt: now.toISOString(),
      source: 'jpl-sbdb',
      bodies: [...asteroids, ...comets],
    };
    await this.persistMinorBodies(result.bodies, now);
    this.mbCache = result;
    this.logger.log(`小天体根数刷新成功：${asteroids.length} 小行星 + ${comets.length} 彗星`);
    return result;
  }

  /** DB 整表原子替换（事务）；DB 不可用/写失败仅告警——内存缓存已是可服务的最后成功批次。 */
  private async persistMinorBodies(bodies: MinorBodyDto[], fetchedAt: Date): Promise<void> {
    if (!this.prisma.isAvailable) return;
    try {
      await this.prisma.$transaction([
        this.prisma.minorBodyElement.deleteMany({}),
        this.prisma.minorBodyElement.createMany({
          data: bodies.map((b) => ({ ...b, fetchedAt })),
        }),
      ]);
    } catch (e) {
      this.logger.warn(`小天体根数落库失败（内存缓存仍可服务）：${(e as Error).message}`);
    }
  }

  /** GET /api/v1/minor-bodies：缓存 → DB 快照 → 内置兜底，永不 500。 */
  async getMinorBodies(): Promise<MinorBodiesResponse> {
    if (this.mbCache) return this.mbCache;
    const fromDb = await this.readMinorBodiesFromDb();
    if (fromDb) {
      this.mbCache = fromDb;
      return fromDb;
    }
    return builtinMinorBodiesResponse();
  }

  private async readMinorBodiesFromDb(): Promise<MinorBodiesResponse | null> {
    if (!this.prisma.isAvailable) return null;
    try {
      const rows = await this.prisma.minorBodyElement.findMany({ orderBy: { id: 'asc' } });
      if (rows.length === 0) return null;
      const bodies: MinorBodyDto[] = rows.map((r) => {
        const dto: MinorBodyDto = {
          id: r.id,
          name: r.name,
          kind: r.kind === 'asteroid' ? 'asteroid' : 'comet',
          epochJd: r.epochJd,
          e: r.e,
          iDeg: r.iDeg,
          omDeg: r.omDeg,
          wDeg: r.wDeg,
        };
        if (r.nameZh != null) dto.nameZh = r.nameZh;
        if (r.qAu != null) dto.qAu = r.qAu;
        if (r.aAu != null) dto.aAu = r.aAu;
        if (r.tpJd != null) dto.tpJd = r.tpJd;
        if (r.maDeg != null) dto.maDeg = r.maDeg;
        if (r.m1 != null) dto.m1 = r.m1;
        if (r.m2 != null) dto.m2 = r.m2;
        return dto;
      });
      const updatedAt = new Date(
        Math.max(...rows.map((r) => r.fetchedAt.getTime())),
      ).toISOString();
      return { updatedAt, source: 'jpl-sbdb', bodies };
    } catch (e) {
      this.logger.warn(`读取 minor_body_elements 失败：${(e as Error).message}`);
      return null;
    }
  }

  // ============================== TLE（每 6h）==============================

  /**
   * 刷新目标卫星 TLE。节流：距上次尝试 <6h 时直接返回当前缓存（force 仅供
   * repeatable job/测试用，间隔本身已 ≥6h）。逐星独立：单星失败保留其上次成功值。
   * 全部失败且无任何可保留值 → 抛错（processor 触发 BullMQ 重试）。
   */
  async refreshTle(opts?: { force?: boolean }): Promise<TleResponse | null> {
    const nowMs = this.nowFn().getTime();
    if (!opts?.force && this.lastTleAttemptMs && nowMs - this.lastTleAttemptMs < TLE_INTERVAL_MS) {
      return this.tleCache;
    }
    this.lastTleAttemptMs = nowMs;

    const prev = new Map((this.tleCache?.sats ?? []).map((s) => [s.id, s]));
    const sats: TleSatDto[] = [];
    for (const target of TLE_TARGETS) {
      try {
        const headers: Record<string, string> = {};
        const since = this.tleLastSuccessMs.get(target.id);
        if (since) headers['If-Modified-Since'] = new Date(since).toUTCString();
        const resp = await this.fetchWithRetry(celestrakGpUrl(target.noradId), { headers });
        if (resp.status === 304) {
          // 上游未更新：保留现值即是最新值
          const kept = prev.get(target.id);
          if (kept) sats.push(kept);
          continue;
        }
        const parsed = parseCelestrakTle(await resp.text(), target.noradId);
        sats.push({ id: target.id, name: parsed.name, nameZh: target.nameZh, l1: parsed.l1, l2: parsed.l2 });
        this.tleLastSuccessMs.set(target.id, nowMs);
        await this.persistTle(target, parsed, new Date(nowMs));
      } catch (e) {
        this.logger.warn(`TLE 刷新失败（${target.id}，保留上次成功值）：${(e as Error).message}`);
        const kept = prev.get(target.id);
        if (kept) sats.push(kept);
      }
    }
    if (sats.length === 0) {
      throw new Error('TLE 刷新全部失败且无历史成功值');
    }
    this.tleCache = { updatedAt: new Date(nowMs).toISOString(), source: 'celestrak', sats };
    return this.tleCache;
  }

  /** 逐星 upsert（单星独立持久化）；DB 不可用/写失败仅告警。 */
  private async persistTle(
    target: { id: string; noradId: number; nameZh: string },
    parsed: ParsedTle,
    fetchedAt: Date,
  ): Promise<void> {
    if (!this.prisma.isAvailable) return;
    const data = {
      noradId: target.noradId,
      name: parsed.name,
      nameZh: target.nameZh,
      l1: parsed.l1,
      l2: parsed.l2,
      epochAt: parsed.epochAt,
      fetchedAt,
    };
    try {
      await this.prisma.tleSnapshot.upsert({
        where: { id: target.id },
        create: { id: target.id, ...data },
        update: data,
      });
    } catch (e) {
      this.logger.warn(`TLE 落库失败（${target.id}，内存缓存仍可服务）：${(e as Error).message}`);
    }
  }

  /** GET /api/v1/tle：缓存 → DB 快照 → 内置兜底，永不 500。 */
  async getTle(): Promise<TleResponse> {
    if (this.tleCache) return this.tleCache;
    const fromDb = await this.readTleFromDb();
    if (fromDb) {
      this.tleCache = fromDb;
      return fromDb;
    }
    return builtinTleResponse();
  }

  private async readTleFromDb(): Promise<TleResponse | null> {
    if (!this.prisma.isAvailable) return null;
    try {
      const rows = await this.prisma.tleSnapshot.findMany();
      if (rows.length === 0) return null;
      // 按目标组固定顺序输出（ISS → CSS → HST），DB 中的额外行追加在后
      const byId = new Map(rows.map((r) => [r.id, r]));
      const ordered = [
        ...TLE_TARGETS.map((t) => byId.get(t.id)).filter((r) => r != null),
        ...rows.filter((r) => !TLE_TARGETS.some((t) => t.id === r.id)),
      ];
      const sats: TleSatDto[] = ordered.map((r) => ({
        id: r.id,
        name: r.name,
        ...(r.nameZh != null ? { nameZh: r.nameZh } : {}),
        l1: r.l1,
        l2: r.l2,
      }));
      const updatedAt = new Date(
        Math.max(...rows.map((r) => r.fetchedAt.getTime())),
      ).toISOString();
      return { updatedAt, source: 'celestrak', sats };
    } catch (e) {
      this.logger.warn(`读取 tle_snapshot 失败：${(e as Error).message}`);
      return null;
    }
  }
}
