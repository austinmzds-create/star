import { FULL_CATALOG } from '@star/astro-data';
import { CelestialController } from '../celestial/celestial.controller';
import { CelestialService } from '../celestial/celestial.service';
import type { PrismaService } from '../prisma/prisma.service';
import { DATA_SOURCES, sourceKeyOf } from './data-source.constants';
import { DataSourceController } from './data-source.controller';
import { DataSourceService } from './data-source.service';

const KEYS = new Set(DATA_SOURCES.map((s) => s.key));

describe('DATA_SOURCES · 溯源主数据完整性', () => {
  it('9 个来源登记（8 契约源 + curated），key 唯一', () => {
    expect(DATA_SOURCES.length).toBe(9);
    expect(KEYS.size).toBe(DATA_SOURCES.length);
    for (const k of [
      'hyg-v41',
      'openngc',
      'd3-celestial',
      'astronomy-engine',
      'jpl-sbdb',
      'celestrak',
      'iau-csn',
      'stellarium-chinese',
      'curated',
    ]) {
      expect(KEYS.has(k)).toBe(true);
    }
  });

  it('每行必填字段非空：name/publisher/url/version/license/citationZh/citationEn/refreshPolicy', () => {
    for (const s of DATA_SOURCES) {
      for (const field of [
        s.name,
        s.publisher,
        s.url,
        s.version,
        s.license,
        s.citationZh,
        s.citationEn,
        s.refreshPolicy,
      ]) {
        expect(typeof field).toBe('string');
        expect(field.length).toBeGreaterThan(0);
      }
    }
  });

  it('合规红线：任何致谢/说明文案不含「购买/买星/产权/认证」', () => {
    const banned = /购买|买星|产权|认证/;
    for (const s of DATA_SOURCES) {
      expect(JSON.stringify([s.name, s.citationZh, s.citationEn, s.notes ?? ''])).not.toMatch(
        banned,
      );
    }
  });

  it('IAU-CSN 行按红线要求承载「非官方命名」免责声明（权威锚点）且许可为 CC BY 4.0', () => {
    const iau = DATA_SOURCES.find((s) => s.key === 'iau-csn')!;
    expect(iau.license).toBe('CC BY 4.0');
    expect(iau.citationZh).toContain('私人象征性纪念');
    expect(iau.citationZh).toContain('非 IAU 官方命名');
    expect(iau.citationZh).toContain('与 IAU 无关');
  });

  it('星等完备极限声明：HYG 核心层 6.5，OpenNGC 非 Messier 层 10', () => {
    expect(DATA_SOURCES.find((s) => s.key === 'hyg-v41')!.magComplete).toBe(6.5);
    expect(DATA_SOURCES.find((s) => s.key === 'openngc')!.magComplete).toBe(10);
  });

  it('运行时源（jpl-sbdb/celestrak）refreshPolicy 与预留源 retrievedAt=null 的语义正确', () => {
    expect(DATA_SOURCES.find((s) => s.key === 'jpl-sbdb')!.refreshPolicy).toBe('runtime-daily');
    expect(DATA_SOURCES.find((s) => s.key === 'celestrak')!.refreshPolicy).toBe('runtime-6h');
    // iau-csn 已于 9C 入库（build-star-names.mjs）：retrievedAt/recordCount 与
    // packages/astro-data/src/generated/iau-csn-meta.json 实测值逐字一致
    const iau = DATA_SOURCES.find((s) => s.key === 'iau-csn')!;
    expect(iau.retrievedAt).toBe('2026-07-15T08:00:43.646Z');
    expect(iau.recordCount).toBe(451);
    expect(iau.notes).toContain('已入库');
    // stellarium-chinese 仍为 Tier 2 预留登记
    const stellarium = DATA_SOURCES.find((s) => s.key === 'stellarium-chinese')!;
    expect(stellarium.retrievedAt).toBeNull();
    expect(stellarium.notes).toContain('预留');
  });
});

describe('sourceKeyOf · 批次号 → data_source.key 映射', () => {
  it('已知批次映射正确', () => {
    expect(sourceKeyOf('hyg-v41')).toBe('hyg-v41');
    expect(sourceKeyOf('handwritten')).toBe('curated');
    expect(sourceKeyOf('astro-data-seed-v1')).toBe('curated');
    expect(sourceKeyOf('openngc')).toBe('openngc');
    expect(sourceKeyOf('astronomy-engine')).toBe('astronomy-engine');
    expect(sourceKeyOf('celestrak-tle-snapshot')).toBe('celestrak');
    expect(sourceKeyOf('jpl-sbdb')).toBe('jpl-sbdb');
  });

  it('未知批次返回 null（绝不猜测来源）', () => {
    expect(sourceKeyOf('some-future-batch')).toBeNull();
    expect(sourceKeyOf(undefined)).toBeNull();
    expect(sourceKeyOf('')).toBeNull();
  });

  it('全目录覆盖：FULL_CATALOG 每个天体的 sourceCatalog 都映射到已登记 key', () => {
    for (const obj of FULL_CATALOG) {
      const key = sourceKeyOf(obj.sourceCatalog);
      expect(key).not.toBeNull();
      expect(KEYS.has(key!)).toBe(true);
    }
  });
});

describe('DataSourceService/Controller · GET /api/v1/data-sources', () => {
  const prismaDown = { isAvailable: false } as unknown as PrismaService;

  it('无 DB：回退内置主数据，全量返回', async () => {
    const controller = new DataSourceController(new DataSourceService(prismaDown));
    const res = await controller.listAll();
    expect(res.sources).toHaveLength(DATA_SOURCES.length);
    expect(typeof res.updatedAt).toBe('string');
    const hyg = res.sources.find((s) => s.key === 'hyg-v41')!;
    expect(hyg.license).toBe('CC BY-SA 4.0');
    expect(hyg.citationZh).toContain('HYG Database');
  });

  it('getByKey：命中返回行，未知 key 返回 null', async () => {
    const svc = new DataSourceService(prismaDown);
    expect(await svc.getByKey('celestrak')).toMatchObject({ key: 'celestrak' });
    expect(await svc.getByKey('nope')).toBeNull();
  });
});

describe('Celestial API · 溯源透出（sourceKey）', () => {
  const controller = new CelestialController(new CelestialService());

  it('详情响应带 sourceKey 且为已登记 key（天狼星 → curated/hyg 家族）', () => {
    const res = controller.getByUid('HIP32349', {});
    expect(res.sourceKey).toBeDefined();
    expect(KEYS.has(res.sourceKey!)).toBe(true);
  });

  it('DSO 详情 sourceKey=openngc；搜索命中项也带 sourceKey', () => {
    expect(controller.getByUid('M31', {}).sourceKey).toBe('openngc');
    const search = controller.search({ q: '天狼' });
    const first = search.items[0] as { sourceKey?: string };
    expect(first.sourceKey).toBeDefined();
    expect(KEYS.has(first.sourceKey!)).toBe(true);
  });
});
