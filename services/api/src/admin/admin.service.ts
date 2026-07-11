import { Injectable } from '@nestjs/common';
import {
  RegistrationStatus,
  type AgentTask,
  type MemorialRegistration,
} from '@prisma/client';
import { AppError, ErrorCodes } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import type { StarSnapshot } from '../memorial/memorial.service';
import type { ListAgentTasksQuery } from './dto/list-agent-tasks.query';
import type { ListRegistrationsQuery } from './dto/list-registrations.query';

/** 统一分页响应形状。 */
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * 后台审核业务。硬依赖 Prisma（无内存 fallback，无 DB 一律 503 DB_UNAVAILABLE）。
 * 状态机见设计文档；审计暂落 reviewNote（未来迁移可加 reviewedAt/By 列，改动只在 applyDecision）。
 */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  /** 分页列出纪念登记（可按 status 过滤），返回管理员全量视图。 */
  async listRegistrations(
    q: ListRegistrationsQuery,
  ): Promise<Paginated<ReturnType<AdminService['toAdminView']>>> {
    this.prisma.ensureAvailable();
    const where = q.status ? { status: q.status } : {};
    const total = await this.prisma.memorialRegistration.count({ where });
    const rows = await this.prisma.memorialRegistration.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    });
    return this.paginate(rows.map((r) => this.toAdminView(r)), q.page, q.pageSize, total);
  }

  /** 通过复审：仅 PENDING_REVIEW → ACTIVE；ACTIVE 幂等；REJECTED → 409。 */
  async approve(registrationNo: string) {
    const reg = await this.mustFind(registrationNo);
    if (reg.status === RegistrationStatus.ACTIVE) return { registration: this.toAdminView(reg) };
    if (reg.status === RegistrationStatus.REJECTED) {
      throw new AppError(
        ErrorCodes.INVALID_STATE_TRANSITION,
        '已拒绝的登记不可直接通过，请走人工恢复流程',
        { from: reg.status, action: 'approve' },
      );
    }
    return this.applyDecision(registrationNo, RegistrationStatus.ACTIVE, '复审通过');
  }

  /** 拒绝/下架：PENDING_REVIEW 或 ACTIVE → REJECTED；REJECTED 幂等。 */
  async reject(registrationNo: string, reason: string) {
    const reg = await this.mustFind(registrationNo);
    if (reg.status === RegistrationStatus.REJECTED) return { registration: this.toAdminView(reg) };
    return this.applyDecision(registrationNo, RegistrationStatus.REJECTED, reason);
  }

  /** 分页列出近端 Agent 任务（观测用）。 */
  async listAgentTasks(
    q: ListAgentTasksQuery,
  ): Promise<Paginated<ReturnType<AdminService['toAgentTaskView']>>> {
    this.prisma.ensureAvailable();
    const where = q.status ? { status: q.status } : {};
    const total = await this.prisma.agentTask.count({ where });
    const rows = await this.prisma.agentTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    });
    return this.paginate(rows.map((r) => this.toAgentTaskView(r)), q.page, q.pageSize, total);
  }

  // ---- 内部 ----

  private async mustFind(registrationNo: string): Promise<MemorialRegistration> {
    this.prisma.ensureAvailable();
    const reg = await this.prisma.memorialRegistration.findUnique({ where: { registrationNo } });
    if (!reg) {
      throw new AppError(ErrorCodes.REGISTRATION_NOT_FOUND, `纪念登记不存在: ${registrationNo}`);
    }
    return reg;
  }

  /** 落库状态 + 审计（reviewNote）。未来加 reviewedAt/By 列时改动集中于此。 */
  private async applyDecision(
    registrationNo: string,
    status: RegistrationStatus,
    note: string,
  ) {
    const tag = status === RegistrationStatus.ACTIVE ? 'APPROVED' : 'REJECTED';
    const updated = await this.prisma.memorialRegistration.update({
      where: { registrationNo },
      data: { status, reviewNote: `[${tag} ${new Date().toISOString()}] ${note}` },
    });
    return { registration: this.toAdminView(updated) };
  }

  private paginate<T>(items: T[], page: number, pageSize: number, total: number): Paginated<T> {
    return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
  }

  /** 管理员全量视图（含隐私/内部字段，端点已鉴权）。不携带 COMPLIANCE_NOTICE。 */
  private toAdminView(reg: MemorialRegistration) {
    return {
      registrationNo: reg.registrationNo,
      publicSlug: reg.publicSlug,
      status: reg.status,
      memorialName: reg.memorialName,
      occasionType: reg.occasionType,
      memorialDate: reg.memorialDate ? reg.memorialDate.toISOString().slice(0, 10) : null,
      blessingText: reg.blessingText,
      storyText: reg.storyText,
      contactEmail: reg.contactEmail,
      reviewNote: reg.reviewNote,
      ownerUserId: reg.ownerUserId,
      createdAt: reg.createdAt,
      updatedAt: reg.updatedAt,
      star: reg.starSnapshotJson as unknown as StarSnapshot,
    };
  }

  private toAgentTaskView(t: AgentTask) {
    return {
      id: t.id,
      skillCode: t.skillCode,
      status: t.status,
      attempts: t.attempts,
      error: t.error,
      registrationId: t.registrationId,
      inputJson: t.inputJson,
      outputJson: t.outputJson,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }
}
