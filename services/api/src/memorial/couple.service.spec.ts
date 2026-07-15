import { CELESTIAL_CATALOG } from '@star/astro-data';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { COMPLIANCE_NOTICE } from '../common/compliance';
import { AppError, ErrorCodes } from '../common/errors/app-error';
import { CelestialService } from '../celestial/celestial.service';
import type { PrismaService } from '../prisma/prisma.service';
import { CreateCoupleDto } from './dto/create-couple.dto';
import { KeywordModeration } from './moderation/keyword-moderation';
import { MemorialService } from './memorial.service';

/**
 * 测试星表：把两颗测试星（天狼星 HIP32349 / 织女星 HIP91262 若存在）强制置为可命名。
 * 与单星 spec 一致，用固定 fixture 保证确定性。
 */
const SECOND_UID = CELESTIAL_CATALOG.find(
  (o) => o.objectUid !== 'HIP32349',
)!.objectUid;
const NAMABLE_TEST_CATALOG = CELESTIAL_CATALOG.map((o) =>
  o.objectUid === 'HIP32349' || o.objectUid === SECOND_UID ? { ...o, isNamable: true } : o,
);

/** Prisma mock：扩展 coupleGroup 与 $transaction（以自身作为 tx 执行回调）。 */
function createPrismaMock() {
  const memorialRegistration = { create: jest.fn(), findUnique: jest.fn() };
  const coupleGroup = { create: jest.fn(), findUnique: jest.fn() };
  const prisma: Record<string, unknown> = {
    isAvailable: true,
    ensureAvailable: jest.fn(),
    memorialRegistration,
    coupleGroup,
  };
  // $transaction 直接以自身作为 tx（同一组 mock 方法）执行回调
  prisma.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma));
  return prisma as unknown as PrismaService & {
    ensureAvailable: jest.Mock;
    memorialRegistration: { create: jest.Mock; findUnique: jest.Mock };
    coupleGroup: { create: jest.Mock; findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
}

/** memorialRegistration.create echo：回显 data 并注入 id/时间戳。 */
function echoRegCreate(prisma: ReturnType<typeof createPrismaMock>): void {
  let n = 0;
  prisma.memorialRegistration.create.mockImplementation(
    async (args: { data: Record<string, unknown> }) => ({
      id: `reg_${++n}`,
      ownerUserId: null,
      reviewNote: null,
      storyText: null,
      createdAt: new Date('2026-07-11T08:00:00Z'),
      updatedAt: new Date('2026-07-11T08:00:00Z'),
      ...args.data,
    }),
  );
}

/** coupleGroup.create echo：回显 data + id/createdAt。 */
function echoGroupCreate(prisma: ReturnType<typeof createPrismaMock>): void {
  prisma.coupleGroup.create.mockImplementation(
    async (args: { data: Record<string, unknown> }) => ({
      id: 'grp_1',
      createdAt: new Date('2026-07-11T08:00:00Z'),
      updatedAt: new Date('2026-07-11T08:00:00Z'),
      ...args.data,
    }),
  );
}

function createCertMock() {
  return {
    getPublicAssets: jest.fn().mockResolvedValue(null),
  } as unknown as import('../certificate/certificate.service').CertificateService;
}

function makeDto(overrides: Partial<Record<string, unknown>> = {}): CreateCoupleDto {
  return plainToInstance(CreateCoupleDto, {
    starA: { starObjectUid: 'HIP32349', memorialName: '阿星', blessingText: '你是我的天狼星' },
    starB: { starObjectUid: SECOND_UID, memorialName: '小织', blessingText: '我是你的织女星' },
    occasionType: 'LOVE',
    relationLabel: '恋人',
    coupleBlessing: '两星相望，一生相守',
    memorialDate: '2026-02-14',
    contactEmail: 'a@example.com',
    ...overrides,
  });
}

describe('MemorialService.createCouple', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let celestial: CelestialService;
  let service: MemorialService;

  beforeEach(() => {
    prisma = createPrismaMock();
    celestial = new CelestialService(NAMABLE_TEST_CATALOG);
    service = new MemorialService(prisma, celestial, new KeywordModeration(), createCertMock());
    echoRegCreate(prisma);
    echoGroupCreate(prisma);
  });

  it('双星创建成功：group 一次、reg 两次，coupleGroupId 相同、角色 A/B、编号不同', async () => {
    const result = await service.createCouple(makeDto());

    expect(prisma.coupleGroup.create).toHaveBeenCalledTimes(1);
    expect(prisma.memorialRegistration.create).toHaveBeenCalledTimes(2);

    const dataA = prisma.memorialRegistration.create.mock.calls[0]![0].data;
    const dataB = prisma.memorialRegistration.create.mock.calls[1]![0].data;
    expect(dataA.coupleGroupId).toBe(dataB.coupleGroupId);
    expect(dataA.coupleRole).toBe('A');
    expect(dataB.coupleRole).toBe('B');
    expect(dataA.registrationNo).toMatch(/^STAR-\d{8}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
    expect(dataA.registrationNo).not.toBe(dataB.registrationNo);

    expect(result.couple.coupleSlug).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{12}$/);
    expect(result.couple.registrations).toHaveLength(2);
    expect(result.couple.status).toBe('ACTIVE');
    expect(result.compliance).toBe(COMPLIANCE_NOTICE);
    // 响应不含隐私/内部字段
    expect(result.couple.registrations[0]).not.toHaveProperty('contactEmail');
    expect(result.couple.registrations[0]).not.toHaveProperty('id');
  });

  it('同星校验 → COUPLE_SAME_STAR，未触达事务/写入', async () => {
    await expect(
      service.createCouple(makeDto({ starB: { starObjectUid: 'HIP32349', memorialName: '小织' } })),
    ).rejects.toMatchObject({ code: ErrorCodes.COUPLE_SAME_STAR });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.memorialRegistration.create).not.toHaveBeenCalled();
  });

  it('任一星不存在 → CELESTIAL_NOT_FOUND，未落库', async () => {
    await expect(
      service.createCouple(makeDto({ starB: { starObjectUid: 'HIP99999', memorialName: '小织' } })),
    ).rejects.toMatchObject({ code: ErrorCodes.CELESTIAL_NOT_FOUND });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('任一星不可命名 → CELESTIAL_NOT_NAMABLE', async () => {
    const catalog = CELESTIAL_CATALOG.map((o) =>
      o.objectUid === 'HIP32349' ? { ...o, isNamable: true } : { ...o, isNamable: false },
    );
    const svc = new MemorialService(
      prisma,
      new CelestialService(catalog),
      new KeywordModeration(),
      createCertMock(),
    );
    await expect(svc.createCouple(makeDto())).rejects.toMatchObject({
      code: ErrorCodes.CELESTIAL_NOT_NAMABLE,
    });
  });

  it('敏感词 reject → CONTENT_REJECTED（带 reason），未落库', async () => {
    await expect(
      service.createCouple(
        makeDto({ starA: { starObjectUid: 'HIP32349', memorialName: '含占位违禁词的名字' } }),
      ),
    ).rejects.toMatchObject({
      code: ErrorCodes.CONTENT_REJECTED,
      details: { reason: expect.stringContaining('占位违禁词') },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('敏感词 review → 创建成功但两条 status 与聚合 status 均 PENDING_REVIEW', async () => {
    const result = await service.createCouple(
      makeDto({
        starA: { starObjectUid: 'HIP32349', memorialName: '阿星', blessingText: '这句话含占位复审词' },
      }),
    );
    const dataA = prisma.memorialRegistration.create.mock.calls[0]![0].data;
    const dataB = prisma.memorialRegistration.create.mock.calls[1]![0].data;
    expect(dataA.status).toBe('PENDING_REVIEW');
    expect(dataB.status).toBe('PENDING_REVIEW');
    expect(result.couple.status).toBe('PENDING_REVIEW');
  });

  it('P2002 整体重试：第一次事务抛 P2002、第二次成功，coupleSlug/编号不同', async () => {
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    prisma.$transaction
      .mockImplementationOnce(async () => {
        throw p2002;
      })
      .mockImplementation(async (cb: (tx: unknown) => unknown) => cb(prisma));

    const result = await service.createCouple(makeDto());
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(result.couple.coupleSlug).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{12}$/);
  });

  it('DB 不可用 → DB_UNAVAILABLE，celestial/事务均未触达', async () => {
    prisma.ensureAvailable.mockImplementation(() => {
      throw new AppError(ErrorCodes.DB_UNAVAILABLE, '数据库暂不可用，请稍后重试');
    });
    const spy = jest.spyOn(celestial, 'getNamableByUid');
    await expect(service.createCouple(makeDto())).rejects.toMatchObject({
      code: ErrorCodes.DB_UNAVAILABLE,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('MemorialService.findCouplePublicBySlug', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: MemorialService;

  const memberSnapshot = {
    objectUid: 'HIP32349',
    nameZh: '天狼星',
    nameEn: 'Sirius',
    constellationZh: '大犬座',
    raDeg: 101.287,
    decDeg: -16.716,
    magnitude: -1.46,
  };

  function member(role: string, overrides: Record<string, unknown> = {}) {
    return {
      id: `reg_${role}`,
      registrationNo: `STAR-20260711-000${role}`,
      publicSlug: `slug${role}xxxxxxx`,
      memorialName: role === 'A' ? '阿星' : '小织',
      blessingText: '一句话',
      status: 'ACTIVE',
      occasionType: 'LOVE',
      memorialDate: new Date('2026-02-14T00:00:00Z'),
      coupleRole: role,
      contactEmail: 'secret@example.com',
      starSnapshotJson: memberSnapshot,
      ...overrides,
    };
  }

  function group(overrides: Record<string, unknown> = {}) {
    return {
      id: 'grp_1',
      coupleSlug: 'c7k2xq9f4t3w',
      relationLabel: '恋人',
      coupleBlessing: '两星相望',
      createdAt: new Date('2026-07-11T08:00:00Z'),
      registrations: [member('B'), member('A')], // 乱序，验证排序
      ...overrides,
    };
  }

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new MemorialService(prisma, new CelestialService(NAMABLE_TEST_CATALOG), new KeywordModeration(), createCertMock());
  });

  it('两成员皆 ACTIVE → stars 长度 2、按 A/B 排序、含快照、不含隐私字段', async () => {
    prisma.coupleGroup.findUnique.mockResolvedValue(group());
    const result = await service.findCouplePublicBySlug('c7k2xq9f4t3w');
    expect(result.couple.stars).toHaveLength(2);
    expect(result.couple.stars[0]!.role).toBe('A');
    expect(result.couple.stars[1]!.role).toBe('B');
    expect(result.couple.stars[0]!.star.nameZh).toBe('天狼星');
    expect(result.couple.stars[0]!.certificate).toBeNull();
    expect(result.couple.stars[0]).not.toHaveProperty('contactEmail');
    expect(result.couple.stars[0]).not.toHaveProperty('publicSlug');
    expect(result.compliance).toBe(COMPLIANCE_NOTICE);
  });

  it('任一成员非 ACTIVE → COUPLE_PAGE_NOT_FOUND', async () => {
    prisma.coupleGroup.findUnique.mockResolvedValue(
      group({ registrations: [member('A'), member('B', { status: 'PENDING_REVIEW' })] }),
    );
    await expect(service.findCouplePublicBySlug('c7k2xq9f4t3w')).rejects.toMatchObject({
      code: ErrorCodes.COUPLE_PAGE_NOT_FOUND,
    });
  });

  it('group 不存在 → COUPLE_PAGE_NOT_FOUND', async () => {
    prisma.coupleGroup.findUnique.mockResolvedValue(null);
    await expect(service.findCouplePublicBySlug('nope')).rejects.toMatchObject({
      code: ErrorCodes.COUPLE_PAGE_NOT_FOUND,
    });
  });

  it('成员数 < 2 → COUPLE_PAGE_NOT_FOUND', async () => {
    prisma.coupleGroup.findUnique.mockResolvedValue(group({ registrations: [member('A')] }));
    await expect(service.findCouplePublicBySlug('c7k2xq9f4t3w')).rejects.toMatchObject({
      code: ErrorCodes.COUPLE_PAGE_NOT_FOUND,
    });
  });
});

describe('CreateCoupleDto 校验', () => {
  async function validateDto(payload: Record<string, unknown>) {
    return validate(plainToInstance(CreateCoupleDto, payload));
  }
  const base = {
    starA: { starObjectUid: 'HIP32349', memorialName: '阿星' },
    starB: { starObjectUid: 'HIP91262', memorialName: '小织' },
  };

  it('合法请求体通过', async () => {
    expect(await validateDto(base)).toHaveLength(0);
  });

  it('starA 缺字段被拒（嵌套校验）', async () => {
    const errors = await validateDto({ ...base, starA: { starObjectUid: 'HIP32349' } });
    expect(errors.some((e) => e.property === 'starA')).toBe(true);
  });

  it('memorialName 41 码点被拒', async () => {
    const errors = await validateDto({
      ...base,
      starA: { starObjectUid: 'HIP32349', memorialName: '星'.repeat(41) },
    });
    expect(errors.some((e) => e.property === 'starA')).toBe(true);
  });

  it('非法 occasionType 被拒', async () => {
    const errors = await validateDto({ ...base, occasionType: '情侣纪念' });
    expect(errors.some((e) => e.property === 'occasionType')).toBe(true);
  });

  it('坏 memorialDate 被拒', async () => {
    const errors = await validateDto({ ...base, memorialDate: '2026-13-40' });
    expect(errors.some((e) => e.property === 'memorialDate')).toBe(true);
  });

  it('坏 email 被拒', async () => {
    const errors = await validateDto({ ...base, contactEmail: 'not-an-email' });
    expect(errors.some((e) => e.property === 'contactEmail')).toBe(true);
  });
});
