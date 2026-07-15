import { ErrorCodes } from '../common/errors/app-error';
import type { CelestialService } from '../celestial/celestial.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { StorageService } from './storage/storage.types';
import { CertificateService } from './certificate.service';

/**
 * 极简 celestial 假实现：cert 服务只用到 listAll()。
 * 用假目录而非真实 CelestialService，令本 spec 不依赖 @star/astro-data 的编译细节。
 */
function createCelestialMock(): CelestialService {
  const stars = [
    { objectUid: 'HIP32349', nameZh: '天狼星', raDeg: 101.287, decDeg: -16.716, magnitude: -1.46 },
    { objectUid: 'HIP30438', nameZh: '老人星', raDeg: 95.988, decDeg: -52.696, magnitude: -0.74 },
    { objectUid: 'HIP37279', nameZh: '南河三', raDeg: 114.825, decDeg: 5.225, magnitude: 0.34 },
  ];
  return { listAll: () => stars } as unknown as CelestialService;
}

/** 登记快照（天狼星），证书/星图数据源。 */
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
    registrationNo: 'STAR-20260710-K7PX',
    memorialName: 'To Alice',
    occasionType: 'LOVE',
    memorialDate: null,
    blessingText: null,
    starSnapshotJson: SNAPSHOT,
    createdAt: new Date('2026-07-10T00:00:00Z'),
    ...overrides,
  };
}

function certRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cert_1',
    registrationId: 'reg_1',
    status: 'PENDING',
    templateVersion: 'v1',
    assetFormat: 'svg',
    certObjectKey: null,
    starMapObjectKey: null,
    error: null,
    createdAt: new Date('2026-07-10T00:00:00Z'),
    updatedAt: new Date('2026-07-10T00:00:01Z'),
    ...overrides,
  };
}

function createPrismaMock() {
  return {
    ensureAvailable: jest.fn(),
    memorialRegistration: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    certificateRecord: {
      upsert: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
  } as unknown as PrismaService & {
    ensureAvailable: jest.Mock;
    memorialRegistration: { findUnique: jest.Mock; findUniqueOrThrow: jest.Mock };
    certificateRecord: {
      upsert: jest.Mock;
      update: jest.Mock;
      findFirst: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
  };
}

/** 内存存储：put 记录调用、返回 mem:// url；url 回显。 */
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

const redisSkipped = { getStatus: () => 'skipped' } as unknown as RedisService;

describe('CertificateService（同步降级路径，无 Redis/无 Queue）', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let celestial: CelestialService;
  let storageBundle: ReturnType<typeof createStorageMock>;
  let service: CertificateService;

  beforeEach(() => {
    prisma = createPrismaMock();
    celestial = createCelestialMock();
    storageBundle = createStorageMock();
    service = new CertificateService(
      prisma,
      redisSkipped,
      celestial,
      storageBundle.storage,
      undefined, // 无队列
    );
    // update 回显合并后的记录
    prisma.certificateRecord.update.mockImplementation(async (args: { where: { id: string }; data: Record<string, unknown> }) =>
      certRecord({ id: args.where.id, ...args.data }),
    );
    prisma.certificateRecord.findUniqueOrThrow.mockImplementation(async () => certRecord());
    prisma.memorialRegistration.findUniqueOrThrow.mockResolvedValue(reg());
  });

  it('同步生成：PENDING → READY，storage.put 调 2 次，两 key 落库，未走队列', async () => {
    prisma.memorialRegistration.findUnique.mockResolvedValue(reg());
    prisma.certificateRecord.upsert.mockResolvedValue(certRecord({ status: 'PENDING' }));

    const dto = await service.enqueueOrRun('STAR-20260710-K7PX');

    expect(dto.status).toBe('READY');
    expect(dto.certUrl).toBeTruthy();
    expect(dto.starMapUrl).toBeTruthy();
    expect(dto.compliance).toContain('国际天文学联合会');
    expect(storageBundle.puts.length).toBe(2);

    // 最终 update 以 READY + 两 key 调用
    const readyCall = prisma.certificateRecord.update.mock.calls.find(
      (c) => (c[0] as { data: { status?: string } }).data.status === 'READY',
    );
    expect(readyCall).toBeDefined();
    const data = (readyCall![0] as { data: Record<string, unknown> }).data;
    expect(data.certObjectKey).toBeTruthy();
    expect(data.starMapObjectKey).toBeTruthy();
  });

  it('幂等：upsert 返回 READY 记录 → 直接返回，storage.put 零调用', async () => {
    prisma.memorialRegistration.findUnique.mockResolvedValue(reg());
    prisma.certificateRecord.upsert.mockResolvedValue(
      certRecord({ status: 'READY', certObjectKey: 'certificates/x.svg', starMapObjectKey: 'starmaps/x.svg' }),
    );

    const dto = await service.enqueueOrRun('STAR-20260710-K7PX');
    expect(dto.status).toBe('READY');
    expect(storageBundle.puts.length).toBe(0);
    expect(dto.certUrl).toBe('mem://certificates/x.svg');
  });

  it('GENERATING 不重复生成', async () => {
    prisma.memorialRegistration.findUnique.mockResolvedValue(reg());
    prisma.certificateRecord.upsert.mockResolvedValue(certRecord({ status: 'GENERATING' }));

    const dto = await service.enqueueOrRun('STAR-20260710-K7PX');
    expect(dto.status).toBe('GENERATING');
    expect(storageBundle.puts.length).toBe(0);
  });

  it('失败落 FAILED：storage.put 抛错 → 同步不 rethrow，最终 FAILED', async () => {
    prisma.memorialRegistration.findUnique.mockResolvedValue(reg());
    prisma.certificateRecord.upsert.mockResolvedValue(certRecord({ status: 'PENDING' }));
    (storageBundle.storage.put as jest.Mock).mockRejectedValue(new Error('disk full'));
    prisma.certificateRecord.findUniqueOrThrow.mockResolvedValue(certRecord({ status: 'FAILED', error: 'disk full' }));

    const dto = await service.enqueueOrRun('STAR-20260710-K7PX');
    expect(dto.status).toBe('FAILED');
    const failedCall = prisma.certificateRecord.update.mock.calls.find(
      (c) => (c[0] as { data: { status?: string } }).data.status === 'FAILED',
    );
    expect(failedCall).toBeDefined();
    expect((failedCall![0] as { data: { error?: string } }).data.error).toBeTruthy();
  });

  it('登记不存在 → REGISTRATION_NOT_FOUND，未 upsert', async () => {
    prisma.memorialRegistration.findUnique.mockResolvedValue(null);
    await expect(service.enqueueOrRun('STAR-NOPE')).rejects.toMatchObject({
      code: ErrorCodes.REGISTRATION_NOT_FOUND,
    });
    expect(prisma.certificateRecord.upsert).not.toHaveBeenCalled();
  });

  it('DB 不可用 → 透传 DB_UNAVAILABLE，未触达 storage', async () => {
    (prisma.ensureAvailable as jest.Mock).mockImplementation(() => {
      throw Object.assign(new Error('db down'), { code: ErrorCodes.DB_UNAVAILABLE });
    });
    await expect(service.enqueueOrRun('STAR-20260710-K7PX')).rejects.toBeDefined();
    expect(storageBundle.puts.length).toBe(0);
  });

  it('getByRegistrationNo：无记录 → PENDING/url null', async () => {
    prisma.memorialRegistration.findUnique.mockResolvedValue(reg());
    prisma.certificateRecord.findFirst.mockResolvedValue(null);

    const dto = await service.getByRegistrationNo('STAR-20260710-K7PX');
    expect(dto.status).toBe('PENDING');
    expect(dto.certUrl).toBeNull();
    expect(dto.starMapUrl).toBeNull();
  });

  it('getByRegistrationNo：READY 记录 → url 由 storage.url 解析', async () => {
    prisma.memorialRegistration.findUnique.mockResolvedValue(reg());
    prisma.certificateRecord.findFirst.mockResolvedValue(
      certRecord({ status: 'READY', certObjectKey: 'certificates/x.svg', starMapObjectKey: 'starmaps/x.svg' }),
    );

    const dto = await service.getByRegistrationNo('STAR-20260710-K7PX');
    expect(dto.certUrl).toBe('mem://certificates/x.svg');
    expect(dto.starMapUrl).toBe('mem://starmaps/x.svg');
  });

  it('getPublicAssets：READY → 对象；PENDING → null；DB 抛错 → null', async () => {
    prisma.certificateRecord.findFirst.mockResolvedValueOnce(
      certRecord({ status: 'READY', certObjectKey: 'certificates/x.svg', starMapObjectKey: 'starmaps/x.svg' }),
    );
    expect(await service.getPublicAssets('reg_1')).toEqual({
      status: 'READY',
      certUrl: 'mem://certificates/x.svg',
      starMapUrl: 'mem://starmaps/x.svg',
    });

    prisma.certificateRecord.findFirst.mockResolvedValueOnce(certRecord({ status: 'PENDING' }));
    expect(await service.getPublicAssets('reg_1')).toBeNull();

    prisma.certificateRecord.findFirst.mockRejectedValueOnce(new Error('db blip'));
    expect(await service.getPublicAssets('reg_1')).toBeNull();
  });
});
