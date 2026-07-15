import { EphemerisFeedController } from './ephemeris-feed.controller';
import { EphemerisFeedService } from './ephemeris-feed.service';
import { BUILTIN_TLE_SATS } from './builtin-snapshot';
import {
  celestrakGpUrl,
  celestrakGroupUrl,
  SBDB_QUERY_URL,
  sbdbSingleUrl,
  STARLINK_GROUP,
  TLE_TARGETS,
} from './feed.constants';
import type { MinorBodyDto } from './feed.types';
import {
  CELESTRAK_ISS_FIXTURE,
  SBDB_CERES_FIXTURE,
  SBDB_PALLAS_FIXTURE,
  SBDB_QUERY_FIXTURE,
  SBDB_VESTA_FIXTURE,
} from './fixtures/sbdb.fixture';
import type { PrismaService } from '../prisma/prisma.service';

/** fixture 抓取当日（与 FIXTURE_NOW_JD 对应），保证过滤窗口判定与抓取日一致。 */
const FIXTURE_NOW = new Date('2026-07-15T07:00:00Z');

/** 最小 Response 桩。 */
function resp(init: { status?: number; json?: unknown; text?: string }): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => init.json,
    text: async () => init.text ?? '',
  } as unknown as Response;
}

/** 无 DB 的 Prisma 桩（本仓库沙箱常态；DB 路径单独用 fake models 测）。 */
const prismaDown = { isAvailable: false } as unknown as PrismaService;

/** 造一个已注入测试缝的 service：零退避、固定时钟、mock fetch。 */
function makeService(
  fetchMock: jest.Mock,
  prisma: PrismaService = prismaDown,
): EphemerisFeedService {
  const svc = new EphemerisFeedService(prisma);
  svc['fetchFn'] = fetchMock as unknown as typeof fetch;
  svc['retryDelaysMs'] = [0, 0];
  svc['nowFn'] = () => FIXTURE_NOW;
  return svc;
}

/**
 * 星链组 fixture：复用两条真实有效 TLE（ISS/HST 快照，校验和/长度均合法），
 * 仅换名称行为 STARLINK-*，供组解析器提取真实 NORAD 构造 SAT-STARLINK-{norad}。
 * 不伪造校验和 —— 用现成合法两行行体是唯一确定性做法。
 */
function starlinkGroupText(): string {
  const a = BUILTIN_TLE_SATS[0]!; // ISS 行体（norad 25544）
  const b = BUILTIN_TLE_SATS[2]!; // HST 行体（norad 20580）
  return `STARLINK-1001\r\n${a.l1}\r\n${a.l2}\r\nSTARLINK-1002\r\n${b.l1}\r\n${b.l2}\r\n`;
}

/** 按 url 分发 fixture 的 fetch mock（SBDB 批量 + 三个单体 + Celestrak 三星 + 星链组全部成功）。 */
function happyFetch(): jest.Mock {
  const tianGong = BUILTIN_TLE_SATS[1]!;
  const hst = BUILTIN_TLE_SATS[2]!;
  return jest.fn(async (url: string) => {
    if (url === SBDB_QUERY_URL) return resp({ json: SBDB_QUERY_FIXTURE });
    if (url === sbdbSingleUrl('1')) return resp({ json: SBDB_CERES_FIXTURE });
    if (url === sbdbSingleUrl('2')) return resp({ json: SBDB_PALLAS_FIXTURE });
    if (url === sbdbSingleUrl('4')) return resp({ json: SBDB_VESTA_FIXTURE });
    if (url === celestrakGpUrl(25544)) return resp({ text: CELESTRAK_ISS_FIXTURE });
    if (url === celestrakGpUrl(48274))
      return resp({ text: `CSS (TIANHE)\r\n${tianGong.l1}\r\n${tianGong.l2}\r\n` });
    if (url === celestrakGpUrl(20580))
      return resp({ text: `HST\r\n${hst.l1}\r\n${hst.l2}\r\n` });
    if (url === celestrakGroupUrl(STARLINK_GROUP)) return resp({ text: starlinkGroupText() });
    throw new Error(`测试未覆盖的 URL: ${url}`);
  });
}

/** 仅著名三星（过滤掉星链动态条目），用于对既有著名卫星契约的断言。 */
const famousIds = (res: { sats: { id: string; group?: string }[] }): string[] =>
  res.sats.filter((s) => s.group !== 'starlink').map((s) => s.id);

/** 断言 MinorBodyDto 满足冻结契约的必填键与类型。 */
function assertBodyShape(b: MinorBodyDto): void {
  expect(typeof b.id).toBe('string');
  expect(typeof b.name).toBe('string');
  expect(['comet', 'asteroid']).toContain(b.kind);
  for (const k of ['epochJd', 'e', 'iDeg', 'omDeg', 'wDeg'] as const) {
    expect(Number.isFinite(b[k])).toBe(true);
  }
  // 至少一种可解算参数化
  expect(b.qAu != null || b.aAu != null).toBe(true);
}

describe('EphemerisFeedService · 小天体（JPL SBDB）', () => {
  it('refreshMinorBodies：3 小行星 + 6 现役亮彗星，契约形状完整', async () => {
    const svc = makeService(happyFetch());
    const res = await svc.refreshMinorBodies();
    expect(res.source).toBe('jpl-sbdb');
    expect(res.updatedAt).toBe(FIXTURE_NOW.toISOString());
    expect(res.bodies).toHaveLength(9);
    for (const b of res.bodies) assertBodyShape(b);
    const ids = res.bodies.map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining(['ceres', 'pallas', 'vesta', '1P', '2P', '12P', 'C2023A3']));
    // 刷新后 getMinorBodies 直接命中缓存
    expect(await svc.getMinorBodies()).toBe(res);
  });

  it('重试退避：首次网络错误、第二次成功 → 整轮成功', async () => {
    const happy = happyFetch();
    let failedOnce = false;
    const flaky = jest.fn(async (url: string) => {
      if (url === SBDB_QUERY_URL && !failedOnce) {
        failedOnce = true;
        throw new Error('ECONNRESET');
      }
      return happy(url);
    });
    const svc = makeService(flaky);
    const res = await svc.refreshMinorBodies();
    expect(res.bodies.length).toBeGreaterThan(0);
    // SBDB 批量 2 次（1 失败 + 1 成功）+ 单体 3 次
    expect(flaky).toHaveBeenCalledTimes(5);
  });

  it('上游持续失败：refresh 抛错，端点降级到内置快照（永不 500）', async () => {
    const dead = jest.fn(async () => resp({ status: 503 }));
    const svc = makeService(dead);
    await expect(svc.refreshMinorBodies()).rejects.toThrow(/上游请求失败/);
    const res = await svc.getMinorBodies();
    expect(res.source).toBe('jpl-sbdb');
    expect(res.bodies).toHaveLength(6); // astro-ephem 内置 3 小行星 + 3 彗星
    const ids = res.bodies.map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining(['ceres', 'pallas', 'vesta', '1P', '2P', '12P']));
    for (const b of res.bodies) assertBodyShape(b);
  });

  it('解析异常（结构突变）视为失败，不产出半截数据', async () => {
    const broken = jest.fn(async (url: string) =>
      url === SBDB_QUERY_URL ? resp({ json: { fields: ['full_name'], data: [] } }) : resp({}),
    );
    const svc = makeService(broken);
    await expect(svc.refreshMinorBodies()).rejects.toThrow(/缺少必需列/);
    expect(svc['mbCache']).toBeNull();
  });

  it('DB 空 + 无缓存：读取 DB 后回退内置快照；DB 有快照则用 DB 批次', async () => {
    const rows = [
      {
        id: '1P',
        name: '1P/Halley',
        nameZh: '哈雷彗星',
        kind: 'comet',
        epochJd: 2439875.5,
        e: 0.9679359956953211,
        qAu: 0.5748638313743413,
        aAu: 17.92863504856923,
        iDeg: 162.1905300439129,
        omDeg: 59.09894720612437,
        wDeg: 112.2414314637764,
        tpJd: 2446469.973616146677,
        maDeg: 274.3823371366792,
        m1: 5.5,
        m2: 13.6,
        fetchedAt: new Date('2026-07-14T04:00:00Z'),
      },
    ];
    const prismaUp = {
      isAvailable: true,
      minorBodyElement: { findMany: jest.fn(async () => rows) },
    } as unknown as PrismaService;
    const svc = makeService(jest.fn(), prismaUp);
    const res = await svc.getMinorBodies();
    expect(res.updatedAt).toBe('2026-07-14T04:00:00.000Z');
    expect(res.bodies).toHaveLength(1);
    expect(res.bodies[0]!.id).toBe('1P');
    assertBodyShape(res.bodies[0]!);
  });
});

describe('EphemerisFeedService · TLE（Celestrak 代理）', () => {
  it('refreshTle：三星全成功，契约形状完整、顺序与目标组一致', async () => {
    const svc = makeService(happyFetch());
    const res = (await svc.refreshTle())!;
    expect(res.source).toBe('celestrak');
    // 著名三星在前，顺序与目标组一致（星链动态条目追加其后）
    expect(famousIds(res)).toEqual(TLE_TARGETS.map((t) => t.id));
    for (const s of res.sats) {
      expect(s.l1).toHaveLength(69);
      expect(s.l2).toHaveLength(69);
      expect(typeof s.name).toBe('string');
    }
    expect(res.sats[0]!.name).toBe('ISS (ZARYA)');
    expect(res.sats[0]!.nameZh).toBe('国际空间站');
    expect(res.sats[0]!.group).toBe('famous');
  });

  it('refreshTle：星链组按历元择优截断并以 SAT-STARLINK-{norad} 命名', async () => {
    const svc = makeService(happyFetch());
    const res = (await svc.refreshTle())!;
    const starlink = res.sats.filter((s) => s.group === 'starlink');
    expect(starlink.length).toBeGreaterThan(0);
    for (const s of starlink) {
      expect(s.id).toMatch(/^SAT-STARLINK-\d+$/);
      expect(s.l1).toHaveLength(69);
      expect(s.l2).toHaveLength(69);
    }
    // 著名三星永远排在星链之前
    expect(famousIds(res)).toEqual(TLE_TARGETS.map((t) => t.id));
  });

  it('星链组失败但著名三星成功 → 整轮仍成功（只缺星链）', async () => {
    const happy = happyFetch();
    const noStarlink = jest.fn(async (url: string) => {
      if (url === celestrakGroupUrl(STARLINK_GROUP)) return resp({ status: 500 });
      return happy(url);
    });
    const svc = makeService(noStarlink);
    const res = (await svc.refreshTle())!;
    expect(famousIds(res)).toEqual(TLE_TARGETS.map((t) => t.id));
    expect(res.sats.filter((s) => s.group === 'starlink')).toHaveLength(0);
  });

  it('节流：6h 内二次调用不再打上游（Celestrak 礼仪硬约束）；force 可越过', async () => {
    const fetchMock = happyFetch();
    const svc = makeService(fetchMock);
    await svc.refreshTle();
    const calls = fetchMock.mock.calls.length;
    const again = await svc.refreshTle();
    expect(fetchMock.mock.calls.length).toBe(calls); // 未增加
    expect(again).not.toBeNull();
    await svc.refreshTle({ force: true });
    // force 越过节流：3 颗著名卫星 + 1 次星链组拉取 = 4 次上游请求
    expect(fetchMock.mock.calls.length).toBe(calls + 4);
  });

  it('304 Not Modified：带 If-Modified-Since 且保留现值', async () => {
    const fetchMock = happyFetch();
    const svc = makeService(fetchMock);
    const first = (await svc.refreshTle())!;

    const seen304 = jest.fn(async (_url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers['If-Modified-Since']).toBeTruthy();
      return resp({ status: 304 });
    });
    svc['fetchFn'] = seen304 as unknown as typeof fetch;
    const second = (await svc.refreshTle({ force: true }))!;
    expect(seen304).toHaveBeenCalledTimes(4); // 3 著名 + 1 星链组
    expect(second.sats).toEqual(first.sats); // 现值即最新值（著名 + 星链均保留）
  });

  it('单星失败不影响其余（逐星独立 + 保留上次成功值）', async () => {
    const happy = happyFetch();
    const partial = jest.fn(async (url: string) => {
      if (url === celestrakGpUrl(48274)) return resp({ status: 500 });
      return happy(url);
    });
    const svc = makeService(partial);
    const res = (await svc.refreshTle())!;
    expect(famousIds(res)).toEqual(['SAT-ISS', 'SAT-HST']); // 天宫本轮缺席（无历史值）
  });

  it('校验和被破坏的行拒收（该星保留缺席，绝不吞坏数据）', async () => {
    const happy = happyFetch();
    const corrupt = jest.fn(async (url: string) => {
      if (url === celestrakGpUrl(25544))
        return resp({ text: CELESTRAK_ISS_FIXTURE.replace('26196.12126347', '26196.12126348') });
      return happy(url);
    });
    const svc = makeService(corrupt);
    const res = (await svc.refreshTle())!;
    expect(famousIds(res)).toEqual(['SAT-TIANGONG', 'SAT-HST']);
  });

  it('全部失败且无历史值 → 抛错；getTle 降级内置快照（永不 500）', async () => {
    const dead = jest.fn(async () => resp({ status: 503 }));
    const svc = makeService(dead);
    await expect(svc.refreshTle()).rejects.toThrow(/全部失败/);
    const res = await svc.getTle();
    expect(res.source).toBe('celestrak');
    expect(res.sats).toHaveLength(3);
    expect(res.updatedAt).toBe('2026-07-11T00:00:00.000Z'); // 如实反映兜底批次时间
  });

  it('403（Celestrak 限流信号）不重试，立即止损', async () => {
    const banned = jest.fn(async (url: string) =>
      url.includes('celestrak') ? resp({ status: 403 }) : resp({}),
    );
    const svc = makeService(banned);
    await expect(svc.refreshTle()).rejects.toThrow();
    // 3 颗著名星 + 1 次星链组各 1 次请求，无重试（对比：非 403 会各重试）
    expect(banned).toHaveBeenCalledTimes(4);
  });
});

describe('EphemerisFeedController · 端点形状（冻结契约）', () => {
  it('GET /api/v1/minor-bodies 与 GET /api/v1/tle 透传 service 结果', async () => {
    const svc = makeService(happyFetch());
    const controller = new EphemerisFeedController(svc);
    const mb = await controller.getMinorBodies();
    expect(mb).toMatchObject({ source: 'jpl-sbdb' });
    expect(Array.isArray(mb.bodies)).toBe(true);
    expect(typeof mb.updatedAt).toBe('string');
    const tle = await controller.getTle();
    expect(tle).toMatchObject({ source: 'celestrak' });
    expect(Array.isArray(tle.sats)).toBe(true);
    expect(typeof tle.updatedAt).toBe('string');
  });
});
