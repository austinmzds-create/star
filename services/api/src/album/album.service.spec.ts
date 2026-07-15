import { ErrorCodes } from '../common/errors/app-error';
import type { AgentService } from '../agent/agent.service';
import type { CelestialService } from '../celestial/celestial.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { StorageService } from '../certificate/storage/storage.types';
import { AlbumService } from './album.service';

/** 极简 celestial 假实现：album 只用 listAll()。 */
function createCelestialMock(): CelestialService {
  const stars = [
    {
      objectUid: 'HIP32349',
      nameZh: '天狼星',
      nameEn: 'Sirius',
      constellationZh: '大犬座',
      raDeg: 101.287,
      decDeg: -16.716,
      magnitude: -1.46,
      distanceLy: 8.6,
      spectralType: 'A1V',
      catalogIds: { hip: '32349', hd: '48915' },
    },
    { objectUid: 'HIP30438', nameZh: '老人星', nameEn: 'Canopus', constellationZh: '船底座', raDeg: 95.988, decDeg: -52.696, magnitude: -0.74, distanceLy: 310, spectralType: 'A9II', catalogIds: {} },
  ];
  return { listAll: () => stars } as unknown as CelestialService;
}

const SNAPSHOT = {
  objectUid: 'HIP32349',
  nameZh: '天狼星',
  nameEn: 'Sirius',
  constellationZh: '大犬座',
  raDeg: 101.287,
  decDeg: -16.716,
  magnitude: -1.46,
};

function reg(overrides: Record<string, unknown> = {}) {
  return {
    id: 'reg_1',
    registrationNo: 'STAR-20260711-K7PX',
    memorialName: 'To Alice',
    occasionType: 'LOVE',
    memorialDate: null,
    blessingText: null,
    storyText: null,
    starSnapshotJson: SNAPSHOT,
    createdAt: new Date('2026-07-11T00:00:00Z'),
    ...overrides,
  };
}

function albumRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'album_1',
    registrationId: 'reg_1',
    status: 'PENDING',
    templateVersion: 'v1',
    combinedObjectKey: null,
    pageObjectKeys: [],
    pageCount: 0,
    assetFormat: 'svg',
    letterMode: null,
    letterTaskId: null,
    error: null,
    createdAt: new Date('2026-07-11T00:00:00Z'),
    updatedAt: new Date('2026-07-11T00:00:01Z'),
    ...overrides,
  };
}

function createPrismaMock() {
  return {
    ensureAvailable: jest.fn(),
    memorialRegistration: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    albumRecord: {
      upsert: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
  } as unknown as PrismaService & {
    ensureAvailable: jest.Mock;
    memorialRegistration: { findUnique: jest.Mock; findUniqueOrThrow: jest.Mock };
    albumRecord: { upsert: jest.Mock; update: jest.Mock; findFirst: jest.Mock; findUniqueOrThrow: jest.Mock };
  };
}

function createStorageMock() {
  const puts: string[] = [];
  const storage: StorageService = {
    kind: 'local',
    put: jest.fn(async (key: string) => {
      puts.push(key);
      return { key, url: `mem://${key}` };
    }),
    url: jest.fn(async (key: string) => `mem://${key}`),
  };
  return { storage, puts };
}

function createAgentMock() {
  return {
    runSkill: jest.fn(async () => ({
      taskNo: 'task_1',
      output: { letter: '模板来信…' },
      mode: 'template' as const,
    })),
  } as unknown as AgentService & { runSkill: jest.Mock };
}

const redisSkipped = { getStatus: () => 'skipped' } as unknown as RedisService;

describe('AlbumService（同步降级路径，无 Redis/无 Queue）', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let storageBundle: ReturnType<typeof createStorageMock>;
  let agent: ReturnType<typeof createAgentMock>;
  let service: AlbumService;

  beforeEach(() => {
    prisma = createPrismaMock();
    storageBundle = createStorageMock();
    agent = createAgentMock();
    service = new AlbumService(
      prisma,
      redisSkipped,
      createCelestialMock(),
      agent,
      storageBundle.storage,
      undefined,
    );
    prisma.albumRecord.update.mockImplementation(
      async (args: { where: { id: string }; data: Record<string, unknown> }) =>
        albumRecord({ id: args.where.id, ...args.data }),
    );
    prisma.albumRecord.findUniqueOrThrow.mockImplementation(async () => albumRecord());
    prisma.memorialRegistration.findUniqueOrThrow.mockResolvedValue(reg());
  });

  it('PENDING → READY：storage.put 7 次（6 页 + 合并），落库 keys/pageCount/letterMode，runSkill 一次', async () => {
    prisma.memorialRegistration.findUnique.mockResolvedValue(reg());
    prisma.albumRecord.upsert.mockResolvedValue(albumRecord({ status: 'PENDING' }));

    const dto = await service.enqueueOrRun('STAR-20260711-K7PX');

    expect(dto.status).toBe('READY');
    expect(storageBundle.puts.length).toBe(7);
    expect(dto.compliance).toContain('国际天文学联合会');

    const readyCall = prisma.albumRecord.update.mock.calls.find(
      (c) => (c[0] as { data: { status?: string } }).data.status === 'READY',
    );
    expect(readyCall).toBeDefined();
    const data = (readyCall![0] as { data: Record<string, unknown> }).data;
    expect(data.combinedObjectKey).toBeTruthy();
    expect((data.pageObjectKeys as string[]).length).toBe(6);
    expect(data.pageCount).toBe(6);
    expect(data.letterMode).toBe('template');

    expect(agent.runSkill).toHaveBeenCalledTimes(1);
    const skillArgs = agent.runSkill.mock.calls[0]!;
    expect(skillArgs[0]).toBe('cosmic-letter');
    expect((skillArgs[1] as { occasion: string }).occasion).toBe('LOVE');
    expect((skillArgs[1] as { starNameZh: string }).starNameZh).toBe('天狼星');
  }, 30000); // sharp 若已安装会栅格化合并长图（~12s），放宽超时

  it('幂等 READY：upsert 返回 READY → 直接返回，put 0 次，runSkill 0 次', async () => {
    prisma.memorialRegistration.findUnique.mockResolvedValue(reg());
    prisma.albumRecord.upsert.mockResolvedValue(
      albumRecord({
        status: 'READY',
        combinedObjectKey: 'albums/x/album.svg',
        pageObjectKeys: ['a', 'b', 'c', 'd', 'e', 'f'],
        pageCount: 6,
      }),
    );

    const dto = await service.enqueueOrRun('STAR-20260711-K7PX');
    expect(dto.status).toBe('READY');
    expect(storageBundle.puts.length).toBe(0);
    expect(agent.runSkill).not.toHaveBeenCalled();
    expect(dto.albumUrl).toBe('mem://albums/x/album.svg');
    expect(dto.pageUrls.length).toBe(6);
  });

  it('GENERATING：不生成，put 0 次', async () => {
    prisma.memorialRegistration.findUnique.mockResolvedValue(reg());
    prisma.albumRecord.upsert.mockResolvedValue(albumRecord({ status: 'GENERATING' }));

    const dto = await service.enqueueOrRun('STAR-20260711-K7PX');
    expect(dto.status).toBe('GENERATING');
    expect(storageBundle.puts.length).toBe(0);
  });

  it('来信降级不影响整册：runSkill 抛错 → 仍 READY，put 7 次，letterMode=template', async () => {
    prisma.memorialRegistration.findUnique.mockResolvedValue(reg());
    prisma.albumRecord.upsert.mockResolvedValue(albumRecord({ status: 'PENDING' }));
    agent.runSkill.mockRejectedValue(new Error('llm down'));

    const dto = await service.enqueueOrRun('STAR-20260711-K7PX');
    expect(dto.status).toBe('READY');
    expect(storageBundle.puts.length).toBe(7);
    const readyCall = prisma.albumRecord.update.mock.calls.find(
      (c) => (c[0] as { data: { status?: string } }).data.status === 'READY',
    );
    expect((readyCall![0] as { data: { letterMode?: string } }).data.letterMode).toBe('template');
  }, 30000);

  it('storage.put 抛错 → FAILED，dto.error 友好文案', async () => {
    prisma.memorialRegistration.findUnique.mockResolvedValue(reg());
    prisma.albumRecord.upsert.mockResolvedValue(albumRecord({ status: 'PENDING' }));
    (storageBundle.storage.put as jest.Mock).mockRejectedValue(new Error('disk full'));
    prisma.albumRecord.findUniqueOrThrow.mockResolvedValue(
      albumRecord({ status: 'FAILED', error: 'disk full' }),
    );

    const dto = await service.enqueueOrRun('STAR-20260711-K7PX');
    expect(dto.status).toBe('FAILED');
    expect(dto.error).toBe('纪念册生成失败，请稍后重试');
    const failedCall = prisma.albumRecord.update.mock.calls.find(
      (c) => (c[0] as { data: { status?: string } }).data.status === 'FAILED',
    );
    expect(failedCall).toBeDefined();
    expect((failedCall![0] as { data: { error?: string } }).data.error).toBeTruthy();
  }, 30000);

  it('登记不存在 → REGISTRATION_NOT_FOUND，未 upsert', async () => {
    prisma.memorialRegistration.findUnique.mockResolvedValue(null);
    await expect(service.enqueueOrRun('STAR-NOPE')).rejects.toMatchObject({
      code: ErrorCodes.REGISTRATION_NOT_FOUND,
    });
    expect(prisma.albumRecord.upsert).not.toHaveBeenCalled();
  });

  it('DB 不可用 → 透传，put 0 次', async () => {
    (prisma.ensureAvailable as jest.Mock).mockImplementation(() => {
      throw Object.assign(new Error('db down'), { code: ErrorCodes.DB_UNAVAILABLE });
    });
    await expect(service.enqueueOrRun('STAR-20260711-K7PX')).rejects.toBeDefined();
    expect(storageBundle.puts.length).toBe(0);
  });

  it('getByRegistrationNo：无记录 → PENDING/空；READY → url 解析、pageUrls 有序', async () => {
    prisma.memorialRegistration.findUnique.mockResolvedValue(reg());
    prisma.albumRecord.findFirst.mockResolvedValueOnce(null);
    const empty = await service.getByRegistrationNo('STAR-20260711-K7PX');
    expect(empty.status).toBe('PENDING');
    expect(empty.albumUrl).toBeNull();
    expect(empty.pageUrls).toEqual([]);

    prisma.albumRecord.findFirst.mockResolvedValueOnce(
      albumRecord({
        status: 'READY',
        combinedObjectKey: 'albums/x/album.svg',
        pageObjectKeys: ['p/cover.svg', 'p/star-map.svg', 'p/story.svg', 'p/letter.svg', 'p/astro.svg', 'p/dedication.svg'],
        pageCount: 6,
      }),
    );
    const ready = await service.getByRegistrationNo('STAR-20260711-K7PX');
    expect(ready.albumUrl).toBe('mem://albums/x/album.svg');
    expect(ready.pageUrls[0]).toEqual({ name: 'cover', url: 'mem://p/cover.svg' });
    expect(ready.pageUrls[5]!.name).toBe('dedication');
  });
});
