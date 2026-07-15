import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DATA_SOURCES, type DataSourceSeed } from './data-source.constants';

/** 对外的数据源行（DataSourceSeed 的响应形状：retrievedAt 统一为 ISO 字符串或 null）。 */
export interface DataSourceDto {
  key: string;
  name: string;
  publisher: string;
  url: string;
  downloadUrl?: string;
  version: string;
  license: string;
  licenseUrl?: string;
  citationZh: string;
  citationEn: string;
  magComplete?: number;
  recordCount?: number;
  refreshPolicy: string;
  retrievedAt: string | null;
  notes?: string;
}

/** GET /api/v1/data-sources 响应形状。 */
export interface DataSourcesResponse {
  updatedAt: string;
  sources: DataSourceDto[];
}

/**
 * 数据来源查询服务：优先读 DB（seed 后的 data_source 表，运行时源的 retrievedAt
 * 由 ephemeris-feed 刷新语义体现在快照表），DB 空/不可用时回退内置主数据常量——
 * 无 Postgres 的环境（本地沙箱）来源页照常可用。
 */
@Injectable()
export class DataSourceService {
  private readonly logger = new Logger(DataSourceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 常量行 → 响应行（undefined 字段省略，null retrievedAt 原样透出并靠 notes 解释）。 */
  private seedToDto(row: DataSourceSeed): DataSourceDto {
    return {
      key: row.key,
      name: row.name,
      publisher: row.publisher,
      url: row.url,
      ...(row.downloadUrl ? { downloadUrl: row.downloadUrl } : {}),
      version: row.version,
      license: row.license,
      ...(row.licenseUrl ? { licenseUrl: row.licenseUrl } : {}),
      citationZh: row.citationZh,
      citationEn: row.citationEn,
      ...(row.magComplete != null ? { magComplete: row.magComplete } : {}),
      ...(row.recordCount != null ? { recordCount: row.recordCount } : {}),
      refreshPolicy: row.refreshPolicy,
      retrievedAt: row.retrievedAt,
      ...(row.notes ? { notes: row.notes } : {}),
    };
  }

  /** 全量数据源表（来源页/徽章弹层消费）。 */
  async listAll(): Promise<DataSourcesResponse> {
    if (this.prisma.isAvailable) {
      try {
        const rows = await this.prisma.dataSource.findMany({ orderBy: { id: 'asc' } });
        if (rows.length > 0) {
          return {
            updatedAt: new Date(
              Math.max(...rows.map((r) => r.updatedAt.getTime())),
            ).toISOString(),
            sources: rows.map((r) => ({
              key: r.key,
              name: r.name,
              publisher: r.publisher,
              url: r.url,
              ...(r.downloadUrl ? { downloadUrl: r.downloadUrl } : {}),
              version: r.version,
              license: r.license,
              ...(r.licenseUrl ? { licenseUrl: r.licenseUrl } : {}),
              citationZh: r.citationZh,
              citationEn: r.citationEn,
              ...(r.magComplete != null ? { magComplete: r.magComplete } : {}),
              ...(r.recordCount != null ? { recordCount: r.recordCount } : {}),
              refreshPolicy: r.refreshPolicy,
              retrievedAt: r.retrievedAt.toISOString(),
              ...(r.notes ? { notes: r.notes } : {}),
            })),
          };
        }
      } catch (e) {
        this.logger.warn(`data_source 表读取失败，回退内置主数据：${(e as Error).message}`);
      }
    }
    // 无 DB / 表空：回退内置主数据（与 seed 单一事实源）
    return {
      updatedAt: new Date().toISOString(),
      sources: DATA_SOURCES.map((r) => this.seedToDto(r)),
    };
  }

  /** 按 key 取单个数据源（来源徽章点击弹层）；未知 key 返回 null。 */
  async getByKey(key: string): Promise<DataSourceDto | null> {
    const all = await this.listAll();
    return all.sources.find((s) => s.key === key) ?? null;
  }
}
