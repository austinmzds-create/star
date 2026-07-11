import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ErrorCodes } from '../common/errors/app-error';
import type { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';
import { ListRegistrationsQuery } from './dto/list-registrations.query';
import { RejectRegistrationDto } from './dto/reject-registration.dto';

function createPrismaMock() {
  return {
    ensureAvailable: jest.fn(),
    memorialRegistration: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    agentTask: { findMany: jest.fn(), count: jest.fn() },
  } as unknown as PrismaService & {
    ensureAvailable: jest.Mock;
    memorialRegistration: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    agentTask: { findMany: jest.Mock; count: jest.Mock };
  };
}

function dbRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ck1',
    registrationNo: 'STAR-20260710-K7PX',
    publicSlug: 'm7k2xq9f4t3w',
    status: 'PENDING_REVIEW',
    memorialName: 'To Alice',
    occasionType: 'LOVE',
    memorialDate: null,
    blessingText: 'hi',
    storyText: null,
    contactEmail: 'a@b.com',
    reviewNote: null,
    ownerUserId: null,
    starSnapshotJson: { nameZh: '天狼星', constellationZh: '大犬座' },
    createdAt: new Date('2026-07-10T00:00:00Z'),
    updatedAt: new Date('2026-07-10T00:00:00Z'),
    ...overrides,
  };
}

function query(overrides: Partial<ListRegistrationsQuery> = {}): ListRegistrationsQuery {
  return { page: 1, pageSize: 20, ...overrides } as ListRegistrationsQuery;
}

describe('AdminService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: AdminService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new AdminService(prisma);
  });

  describe('listRegistrations', () => {
    it('分页字段正确、skip/take/orderBy 正确、管理员视图含 contactEmail 不含 compliance', async () => {
      prisma.memorialRegistration.count.mockResolvedValue(3);
      prisma.memorialRegistration.findMany.mockResolvedValue([dbRecord(), dbRecord({ id: 'ck2' })]);

      const res = await service.listRegistrations(query({ page: 2, pageSize: 20 }));
      expect(res.total).toBe(3);
      expect(res.totalPages).toBe(1);
      expect(res.page).toBe(2);
      expect(res.pageSize).toBe(20);
      expect(res.items.length).toBe(2);

      const args = prisma.memorialRegistration.findMany.mock.calls[0]![0];
      expect(args.skip).toBe(20);
      expect(args.take).toBe(20);
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
      expect(args.where).toEqual({});

      expect(res.items[0]).toHaveProperty('contactEmail');
      expect(res.items[0]).toHaveProperty('reviewNote');
      expect(res.items[0]).not.toHaveProperty('compliance');
    });

    it('带 status 时 where.status 正确', async () => {
      prisma.memorialRegistration.count.mockResolvedValue(0);
      prisma.memorialRegistration.findMany.mockResolvedValue([]);
      await service.listRegistrations(query({ status: 'PENDING_REVIEW' as never }));
      expect(prisma.memorialRegistration.findMany.mock.calls[0]![0].where).toEqual({
        status: 'PENDING_REVIEW',
      });
    });
  });

  describe('approve', () => {
    it('PENDING_REVIEW → ACTIVE，reviewNote 以 [APPROVED 开头', async () => {
      prisma.memorialRegistration.findUnique.mockResolvedValue(dbRecord({ status: 'PENDING_REVIEW' }));
      prisma.memorialRegistration.update.mockImplementation(async (a: { data: Record<string, unknown> }) =>
        dbRecord({ status: 'ACTIVE', reviewNote: a.data.reviewNote }),
      );
      const res = await service.approve('STAR-20260710-K7PX');
      expect(res.registration.status).toBe('ACTIVE');
      const data = prisma.memorialRegistration.update.mock.calls[0]![0].data;
      expect(data.status).toBe('ACTIVE');
      expect(String(data.reviewNote)).toMatch(/^\[APPROVED /);
    });

    it('已 ACTIVE → 幂等，不调 update', async () => {
      prisma.memorialRegistration.findUnique.mockResolvedValue(dbRecord({ status: 'ACTIVE' }));
      const res = await service.approve('STAR-20260710-K7PX');
      expect(res.registration.status).toBe('ACTIVE');
      expect(prisma.memorialRegistration.update).not.toHaveBeenCalled();
    });

    it('REJECTED → INVALID_STATE_TRANSITION，不调 update', async () => {
      prisma.memorialRegistration.findUnique.mockResolvedValue(dbRecord({ status: 'REJECTED' }));
      await expect(service.approve('STAR-20260710-K7PX')).rejects.toMatchObject({
        code: ErrorCodes.INVALID_STATE_TRANSITION,
      });
      expect(prisma.memorialRegistration.update).not.toHaveBeenCalled();
    });

    it('不存在 → REGISTRATION_NOT_FOUND', async () => {
      prisma.memorialRegistration.findUnique.mockResolvedValue(null);
      await expect(service.approve('STAR-NOPE')).rejects.toMatchObject({
        code: ErrorCodes.REGISTRATION_NOT_FOUND,
      });
    });
  });

  describe('reject', () => {
    it('PENDING_REVIEW → REJECTED，reviewNote 含 reason 且以 [REJECTED 开头', async () => {
      prisma.memorialRegistration.findUnique.mockResolvedValue(dbRecord({ status: 'PENDING_REVIEW' }));
      prisma.memorialRegistration.update.mockImplementation(async (a: { data: Record<string, unknown> }) =>
        dbRecord({ status: 'REJECTED', reviewNote: a.data.reviewNote }),
      );
      const res = await service.reject('STAR-20260710-K7PX', '含不当内容');
      expect(res.registration.status).toBe('REJECTED');
      const data = prisma.memorialRegistration.update.mock.calls[0]![0].data;
      expect(String(data.reviewNote)).toMatch(/^\[REJECTED /);
      expect(String(data.reviewNote)).toContain('含不当内容');
    });

    it('ACTIVE 下架 → REJECTED', async () => {
      prisma.memorialRegistration.findUnique.mockResolvedValue(dbRecord({ status: 'ACTIVE' }));
      prisma.memorialRegistration.update.mockResolvedValue(dbRecord({ status: 'REJECTED' }));
      const res = await service.reject('STAR-20260710-K7PX', '投诉');
      expect(res.registration.status).toBe('REJECTED');
    });

    it('已 REJECTED → 幂等，不调 update', async () => {
      prisma.memorialRegistration.findUnique.mockResolvedValue(dbRecord({ status: 'REJECTED' }));
      const res = await service.reject('STAR-20260710-K7PX', 'x');
      expect(res.registration.status).toBe('REJECTED');
      expect(prisma.memorialRegistration.update).not.toHaveBeenCalled();
    });

    it('不存在 → REGISTRATION_NOT_FOUND', async () => {
      prisma.memorialRegistration.findUnique.mockResolvedValue(null);
      await expect(service.reject('STAR-NOPE', 'x')).rejects.toMatchObject({
        code: ErrorCodes.REGISTRATION_NOT_FOUND,
      });
    });
  });

  describe('listAgentTasks', () => {
    it('分页 + status 过滤 + 视图含 skillCode/status/attempts', async () => {
      prisma.agentTask.count.mockResolvedValue(1);
      prisma.agentTask.findMany.mockResolvedValue([
        {
          id: 't1',
          skillCode: 'cosmic-letter',
          status: 'SUCCEEDED',
          attempts: 0,
          error: null,
          registrationId: null,
          inputJson: {},
          outputJson: { letter: 'x' },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      const res = await service.listAgentTasks({ page: 1, pageSize: 20, status: 'SUCCEEDED' as never });
      expect(res.total).toBe(1);
      expect(res.items[0]).toMatchObject({ skillCode: 'cosmic-letter', status: 'SUCCEEDED', attempts: 0 });
      expect(prisma.agentTask.findMany.mock.calls[0]![0].where).toEqual({ status: 'SUCCEEDED' });
    });
  });

  describe('DB 不可用', () => {
    beforeEach(() => {
      (prisma.ensureAvailable as jest.Mock).mockImplementation(() => {
        throw Object.assign(new Error('db down'), { code: ErrorCodes.DB_UNAVAILABLE });
      });
    });

    it('listRegistrations rejects、未触达 findMany', async () => {
      await expect(service.listRegistrations(query())).rejects.toBeDefined();
      expect(prisma.memorialRegistration.findMany).not.toHaveBeenCalled();
    });

    it('approve rejects、未触达 update', async () => {
      await expect(service.approve('x')).rejects.toBeDefined();
      expect(prisma.memorialRegistration.update).not.toHaveBeenCalled();
    });
  });
});

describe('Admin DTO 校验', () => {
  it('坏 status 枚举被拒', async () => {
    const errors = await validate(
      plainToInstance(ListRegistrationsQuery, { status: 'BOGUS' }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('page=0 被拒', async () => {
    const errors = await validate(plainToInstance(ListRegistrationsQuery, { page: 0 }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('pageSize=101 被拒', async () => {
    const errors = await validate(plainToInstance(ListRegistrationsQuery, { pageSize: 101 }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('reject 空 reason 被拒', async () => {
    const errors = await validate(plainToInstance(RejectRegistrationDto, { reason: '   ' }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('reject 超 200 字被拒', async () => {
    const errors = await validate(
      plainToInstance(RejectRegistrationDto, { reason: '长'.repeat(201) }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});
