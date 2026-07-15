import { CELESTIAL_CATALOG } from '@star/astro-data';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { COMPLIANCE_NOTICE } from '../common/compliance';
import { AppError, ErrorCodes } from '../common/errors/app-error';
import { CelestialService } from '../celestial/celestial.service';
import type { PrismaService } from '../prisma/prisma.service';
import { CreateRegistrationDto } from './dto/create-registration.dto';
import { KeywordModeration } from './moderation/keyword-moderation';
import { MemorialService } from './memorial.service';

/**
 * 测试星表：把天狼星（HIP32349）强制置为可命名。
 * 真实星表按合规红线将著名星标为 isNamable=false，本 spec 用固定 fixture 保证确定性，
 * 与星表命名候选判定的演进解耦（既有断言仍校验 nameZh/raDeg 等快照字段）。
 */
const NAMABLE_TEST_CATALOG = CELESTIAL_CATALOG.map((o) =>
  o.objectUid === 'HIP32349' ? { ...o, isNamable: true } : o,
);

/** Prisma mock 工厂：只 mock 本服务触达的表方法。 */
function createPrismaMock() {
  return {
    isAvailable: true,
    ensureAvailable: jest.fn(),
    memorialRegistration: { create: jest.fn(), findUnique: jest.fn() },
    agentTask: { create: jest.fn() },
  } as unknown as PrismaService & {
    ensureAvailable: jest.Mock;
    memorialRegistration: { create: jest.Mock; findUnique: jest.Mock };
  };
}

/** 让 create mock 回显写入数据（模拟 DB 落库后的完整记录）。 */
function echoCreate(prisma: ReturnType<typeof createPrismaMock>): void {
  prisma.memorialRegistration.create.mockImplementation(
    async (args: { data: Record<string, unknown> }) => ({
      id: 'cktest0001',
      ownerUserId: null,
      contactEmail: null,
      reviewNote: null,
      createdAt: new Date('2026-07-10T08:00:00Z'),
      updatedAt: new Date('2026-07-10T08:00:00Z'),
      ...args.data,
    }),
  );
}

/** 构造合法请求体。 */
function makeDto(overrides: Partial<CreateRegistrationDto> = {}): CreateRegistrationDto {
  return plainToInstance(CreateRegistrationDto, {
    starObjectUid: 'HIP32349',
    memorialName: 'To Alice',
    occasionType: 'LOVE',
    memorialDate: '2026-02-14',
    blessingText: '写下你想安放进星空的一句话',
    ...overrides,
  });
}

/** 证书服务 mock：公开页仅需 getPublicAssets（默认无就绪资产）。 */
function createCertMock() {
  return {
    getPublicAssets: jest.fn().mockResolvedValue(null),
  } as unknown as import('../certificate/certificate.service').CertificateService;
}

describe('MemorialService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let celestial: CelestialService;
  let service: MemorialService;

  beforeEach(() => {
    prisma = createPrismaMock();
    celestial = new CelestialService(NAMABLE_TEST_CATALOG);
    service = new MemorialService(prisma, celestial, new KeywordModeration(), createCertMock());
  });

  describe('create', () => {
    it('创建成功：编号/slug 格式正确、状态 ACTIVE、快照含正确星体数据', async () => {
      echoCreate(prisma);
      const result = await service.create(makeDto());

      const data = prisma.memorialRegistration.create.mock.calls[0]![0].data;
      expect(data.registrationNo).toMatch(/^STAR-\d{8}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
      expect(data.publicSlug).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{12}$/);
      expect(data.status).toBe('ACTIVE');
      expect(data.starSnapshotJson.nameZh).toBe('天狼星');
      expect(data.starSnapshotJson.raDeg).toBeCloseTo(101.287);

      expect(result.compliance).toBe(COMPLIANCE_NOTICE);
      expect(result.registration.registrationNo).toBe(data.registrationNo);
      expect(result.registration.memorialDate).toBe('2026-02-14');
      // 响应绝不含隐私/内部字段
      expect(result.registration).not.toHaveProperty('contactEmail');
      expect(result.registration).not.toHaveProperty('id');
      expect(result.registration).not.toHaveProperty('ownerUserId');
      expect(result.registration).not.toHaveProperty('reviewNote');
    });

    it('星体不存在 → CELESTIAL_NOT_FOUND，且未触达 DB 写入', async () => {
      await expect(service.create(makeDto({ starObjectUid: 'HIP99999' }))).rejects.toMatchObject({
        code: ErrorCodes.CELESTIAL_NOT_FOUND,
      });
      expect(prisma.memorialRegistration.create).not.toHaveBeenCalled();
    });

    it('不可命名星体 → CELESTIAL_NOT_NAMABLE', async () => {
      const { CELESTIAL_CATALOG } = await import('@star/astro-data');
      const locked = [{ ...CELESTIAL_CATALOG[0]!, objectUid: 'TEST-LOCKED', isNamable: false }];
      const svc = new MemorialService(
        prisma,
        new CelestialService(locked),
        new KeywordModeration(),
        createCertMock(),
      );
      await expect(svc.create(makeDto({ starObjectUid: 'TEST-LOCKED' }))).rejects.toMatchObject({
        code: ErrorCodes.CELESTIAL_NOT_NAMABLE,
      });
    });

    it('敏感词 reject → CONTENT_REJECTED（携带 reason）', async () => {
      await expect(
        service.create(makeDto({ memorialName: '含占位违禁词的名字' })),
      ).rejects.toMatchObject({
        code: ErrorCodes.CONTENT_REJECTED,
        details: { reason: expect.stringContaining('占位违禁词') },
      });
      expect(prisma.memorialRegistration.create).not.toHaveBeenCalled();
    });

    it('敏感词 review → 正常创建但状态 PENDING_REVIEW', async () => {
      echoCreate(prisma);
      const result = await service.create(makeDto({ blessingText: '这句话含占位复审词' }));
      const data = prisma.memorialRegistration.create.mock.calls[0]![0].data;
      expect(data.status).toBe('PENDING_REVIEW');
      expect(result.registration.status).toBe('PENDING_REVIEW');
    });

    it('编号碰撞（P2002）重试：第二次成功，两次编号不同', async () => {
      const p2002 = Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['registrationNo'] },
      });
      prisma.memorialRegistration.create
        .mockRejectedValueOnce(p2002)
        .mockImplementation(async (args: { data: Record<string, unknown> }) => ({
          id: 'cktest0002',
          ownerUserId: null,
          reviewNote: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...args.data,
        }));

      const result = await service.create(makeDto());
      expect(prisma.memorialRegistration.create).toHaveBeenCalledTimes(2);
      const no1 = prisma.memorialRegistration.create.mock.calls[0]![0].data.registrationNo;
      const no2 = prisma.memorialRegistration.create.mock.calls[1]![0].data.registrationNo;
      expect(no1).not.toBe(no2);
      expect(result.registration.registrationNo).toBe(no2);
    });

    it('非 P2002 的 DB 错误直接抛出，不重试', async () => {
      prisma.memorialRegistration.create.mockRejectedValueOnce(new Error('connection lost'));
      await expect(service.create(makeDto())).rejects.toThrow('connection lost');
      expect(prisma.memorialRegistration.create).toHaveBeenCalledTimes(1);
    });

    it('DB 不可用 → DB_UNAVAILABLE，celestial/moderation 均未触达', async () => {
      prisma.ensureAvailable.mockImplementation(() => {
        throw new AppError(ErrorCodes.DB_UNAVAILABLE, '数据库暂不可用，请稍后重试');
      });
      const spy = jest.spyOn(celestial, 'getNamableByUid');
      await expect(service.create(makeDto())).rejects.toMatchObject({
        code: ErrorCodes.DB_UNAVAILABLE,
      });
      expect(spy).not.toHaveBeenCalled();
      expect(prisma.memorialRegistration.create).not.toHaveBeenCalled();
    });
  });

  /** 一条已落库的登记记录样例。 */
  function dbRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: 'cktest0001',
      registrationNo: 'STAR-20260710-K7PX',
      starObjectUid: 'HIP32349',
      starSnapshotJson: {
        objectUid: 'HIP32349',
        nameZh: '天狼星',
        nameEn: 'Sirius',
        constellationZh: '大犬座',
        raDeg: 101.287,
        decDeg: -16.716,
        magnitude: -1.46,
      },
      memorialName: 'To Alice',
      occasionType: 'LOVE',
      memorialDate: new Date('2026-02-14T00:00:00Z'),
      blessingText: '一句话',
      storyText: '一个长故事',
      status: 'ACTIVE',
      publicSlug: 'm7k2xq9f4t3w',
      ownerUserId: null,
      contactEmail: 'secret@example.com',
      reviewNote: '内部备注',
      createdAt: new Date('2026-07-10T08:00:00Z'),
      updatedAt: new Date('2026-07-10T08:00:00Z'),
      ...overrides,
    };
  }

  describe('findByRegistrationNo', () => {
    it('命中 → owner 视图，含 storyText，不含隐私/内部字段', async () => {
      prisma.memorialRegistration.findUnique.mockResolvedValue(dbRecord());
      const result = await service.findByRegistrationNo('STAR-20260710-K7PX');
      expect(result.registration.registrationNo).toBe('STAR-20260710-K7PX');
      expect(result.registration.storyText).toBe('一个长故事');
      expect(result.registration.memorialDate).toBe('2026-02-14');
      expect(result.registration.star.nameZh).toBe('天狼星');
      expect(result.compliance).toBe(COMPLIANCE_NOTICE);
      expect(result.registration).not.toHaveProperty('contactEmail');
      expect(result.registration).not.toHaveProperty('reviewNote');
      expect(result.registration).not.toHaveProperty('id');
    });

    it('未命中 → REGISTRATION_NOT_FOUND', async () => {
      prisma.memorialRegistration.findUnique.mockResolvedValue(null);
      await expect(service.findByRegistrationNo('STAR-20260101-XXXX')).rejects.toMatchObject({
        code: ErrorCodes.REGISTRATION_NOT_FOUND,
      });
    });
  });

  describe('findPublicBySlug', () => {
    it('ACTIVE → 公开视图（含 star 快照），不含隐私字段', async () => {
      prisma.memorialRegistration.findUnique.mockResolvedValue(dbRecord());
      const result = await service.findPublicBySlug('m7k2xq9f4t3w');
      expect(result.memorial.memorialName).toBe('To Alice');
      expect(result.memorial.star.constellationZh).toBe('大犬座');
      expect(result.compliance).toBe(COMPLIANCE_NOTICE);
      expect(result.memorial).not.toHaveProperty('contactEmail');
      expect(result.memorial).not.toHaveProperty('publicSlug');
      expect(result.memorial).not.toHaveProperty('id');
    });

    it.each(['PENDING_REVIEW', 'REJECTED'])('%s → MEMORIAL_PAGE_NOT_FOUND', async (status) => {
      prisma.memorialRegistration.findUnique.mockResolvedValue(dbRecord({ status }));
      await expect(service.findPublicBySlug('m7k2xq9f4t3w')).rejects.toMatchObject({
        code: ErrorCodes.MEMORIAL_PAGE_NOT_FOUND,
      });
    });

    it('slug 不存在 → MEMORIAL_PAGE_NOT_FOUND', async () => {
      prisma.memorialRegistration.findUnique.mockResolvedValue(null);
      await expect(service.findPublicBySlug('nosuchslug99')).rejects.toMatchObject({
        code: ErrorCodes.MEMORIAL_PAGE_NOT_FOUND,
      });
    });
  });
});

describe('CreateRegistrationDto 校验', () => {
  async function validateDto(payload: Record<string, unknown>) {
    return validate(plainToInstance(CreateRegistrationDto, payload));
  }
  const base = {
    starObjectUid: 'HIP32349',
    memorialName: 'To Alice',
    occasionType: 'LOVE',
  };

  it('合法请求体通过', async () => {
    expect(await validateDto(base)).toHaveLength(0);
  });

  it('40 个 emoji 的纪念名通过（按码点计数）', async () => {
    expect(await validateDto({ ...base, memorialName: '🌟'.repeat(40) })).toHaveLength(0);
  });

  it('41 码点纪念名被拒', async () => {
    const errors = await validateDto({ ...base, memorialName: '星'.repeat(41) });
    expect(errors.some((e) => e.property === 'memorialName')).toBe(true);
  });

  it('空名（trim 后）被拒', async () => {
    const errors = await validateDto({ ...base, memorialName: '   ' });
    expect(errors.some((e) => e.property === 'memorialName')).toBe(true);
  });

  it('非法 occasionType 被拒', async () => {
    const errors = await validateDto({ ...base, occasionType: '情侣纪念' });
    expect(errors.some((e) => e.property === 'occasionType')).toBe(true);
  });

  it('141 字 blessing 被拒', async () => {
    const errors = await validateDto({ ...base, blessingText: '念'.repeat(141) });
    expect(errors.some((e) => e.property === 'blessingText')).toBe(true);
  });

  it.each(['2026-13-40', '2026/02/14', '2026-02-30'])('坏日期 %s 被拒', async (bad) => {
    const errors = await validateDto({ ...base, memorialDate: bad });
    expect(errors.some((e) => e.property === 'memorialDate')).toBe(true);
  });

  it('坏 email 被拒', async () => {
    const errors = await validateDto({ ...base, contactEmail: 'not-an-email' });
    expect(errors.some((e) => e.property === 'contactEmail')).toBe(true);
  });
});
