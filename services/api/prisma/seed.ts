/**
 * 种子脚本：把 @star/astro-data 的 FULL_CATALOG（恒星 + 深空天体）灌入
 * celestial_object + celestial_name_alias，为 Phase 3 的 pg_trgm DB 化搜索铺路。
 * 深空天体（Messier/NGC/IC）坐标真实固定、isNamable 恒为 false（合规红线）。
 *
 * 运行方式（仅在有真实 Postgres 的环境）：pnpm --filter @star/api db:seed
 * 本地无 DB 的容器不要运行。
 */
import { PrismaClient, type CelestialType } from '@prisma/client';
import {
  derivePhysical,
  FULL_CATALOG,
  loadStarExtras,
  type CelestialObject,
} from '@star/astro-data';
import { listEphemerisBodies, toCelestialObject } from '@star/astro-ephem';
import { DATA_SOURCES } from '../src/data-source/data-source.constants';

const prisma = new PrismaClient();

/** 归一化：去空白、转小写、去拉丁变音符号（中文原样保留）。拷贝自 packages/astro-data/src/search.ts 的 normalize()，两处必须保持一致。 */
function normalize(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** 是否含 CJK 字符（用于别名语言标记）。 */
function isZh(s: string): boolean {
  return /[一-鿿]/.test(s);
}

/** 数据质量评分：基础 30 + distanceLy 20 + spectralType 20 + descriptionZh 30。 */
function dataQualityScore(obj: CelestialObject): number {
  let score = 30;
  if (obj.distanceLy != null) score += 20;
  if (obj.spectralType) score += 20;
  if (obj.descriptionZh) score += 30;
  return score;
}

interface AliasRow {
  alias: string;
  lang: string;
  source: string;
}

/** 收集一颗星的全部可搜索别名（source 对齐 StarSearchResult.matchedOn 家族）。 */
function collectAliases(obj: CelestialObject): AliasRow[] {
  const rows: AliasRow[] = [
    { alias: obj.nameEn, lang: 'en', source: 'name' },
    { alias: obj.nameZh, lang: 'zh', source: 'name' },
  ];
  if (obj.bayer) rows.push({ alias: obj.bayer, lang: 'sci', source: 'bayer' });
  for (const alias of obj.aliases) {
    rows.push({ alias, lang: isZh(alias) ? 'zh' : 'en', source: 'alias' });
  }
  rows.push({ alias: obj.objectUid, lang: 'sci', source: 'catalog' });
  for (const id of Object.values(obj.catalogIds)) {
    rows.push({ alias: id, lang: 'sci', source: 'catalog' });
  }
  rows.push({ alias: obj.constellation, lang: 'en', source: 'constellation' });
  rows.push({ alias: obj.constellationZh, lang: 'zh', source: 'constellation' });
  return rows;
}

async function main(): Promise<void> {
  let starCount = 0;
  let aliasCount = 0;

  // 恒星增强字段（Phase 9C）：star-extras.json 经 loadStarExtras 懒加载（tsx 的
  // esbuild JSON 转换器支持动态 import）。ETL 未跑/文件缺失时返回空 Map——
  // 落库回到光谱型档位估算，与 9B 行为一致，seed 绝不因增强层缺席而失败。
  const extras = await loadStarExtras();

  for (const obj of FULL_CATALOG) {
    // 百科档案：derivePhysical 内部对 DSO 自动分派 deriveDsoProfile——
    // DB 与内存目录永远同式（单一真源）；stage/fate 空串（未知）落库为 null。
    // ci（B−V 色指数）在手时传入：温度经 Ballesteros 测光反解（连续、更准），
    // 光度/质量/寿命链路随之精化（derivePhysical 冻结契约 opts.ci，Phase 9C）
    const ci = extras.get(obj.objectUid)?.ci;
    const p = derivePhysical(obj, ci != null ? { ci } : undefined);
    const data = {
      type: obj.type.toUpperCase() as CelestialType,
      nameEn: obj.nameEn,
      nameZh: obj.nameZh,
      aliases: obj.aliases,
      bayer: obj.bayer ?? null,
      constellation: obj.constellation,
      constellationZh: obj.constellationZh,
      raDeg: obj.raDeg,
      decDeg: obj.decDeg,
      magnitude: obj.magnitude,
      distanceLy: obj.distanceLy,
      spectralType: obj.spectralType ?? null,
      catalogIds: obj.catalogIds,
      isNamable: obj.isNamable,
      isFeatured: obj.isFeatured,
      descriptionZh: obj.descriptionZh ?? null,
      /** 前端渲染优先级：越亮（星等越小）越高 */
      renderPriority: Math.round(Math.max(0, 7 - obj.magnitude) * 10),
      /** 精选星体搜索加权 */
      searchPriority: obj.isFeatured ? 100 : 0,
      dataQualityScore: dataQualityScore(obj),
      // 数据出处（handwritten / hyg-v41 / openngc），DSO 的 CC-BY-SA-4.0 署名义务可据此追溯
      sourceCatalog: obj.sourceCatalog ?? 'astro-data-seed-v1',
      // —— 百科档案列（Phase 7 encyclopedia，全部可空）——
      tempK: p?.tempK ?? null,
      massSolar: p?.massSolar ?? null,
      radiusSolar: p?.radiusSolar ?? null,
      luminositySolar: p?.luminositySolar ?? null,
      ageGyr: p?.ageGyr ?? null,
      lifespanGyr: p?.lifespanGyr ?? null,
      absoluteMag: p?.absoluteMag ?? null,
      stage: p?.stage ? p.stage : null,
      fate: p?.fate ? p.fate : null,
      bestMonth: p?.bestMonth ?? null,
      visibility: p?.visibility ?? null,
      funFacts: p?.funFacts ?? [],
    };

    await prisma.celestialObject.upsert({
      where: { objectUid: obj.objectUid },
      create: { objectUid: obj.objectUid, ...data },
      update: data,
    });
    starCount++;

    // 别名表：先清后灌，保证与当前目录一致
    await prisma.celestialNameAlias.deleteMany({ where: { objectUid: obj.objectUid } });
    const rows = collectAliases(obj).map((r) => ({
      objectUid: obj.objectUid,
      alias: r.alias,
      aliasNorm: normalize(r.alias),
      lang: r.lang,
      source: r.source,
    }));
    const created = await prisma.celestialNameAlias.createMany({
      data: rows,
      skipDuplicates: true,
    });
    aliasCount += created.count;
  }

  // —— 星历天体元数据行（太阳/月亮/行星）——
  // 坐标不落库（raDeg/decDeg=null + isEphemeris=true），任何直接读表的旁路都不会拿到会过期的行星坐标；
  // 读取时由 @star/astro-ephem 按请求时刻实时计算。合规：isNamable 恒为 false。
  let ephCount = 0;
  for (const meta of listEphemerisBodies()) {
    const data = {
      type: meta.kind.toUpperCase() as CelestialType, // SUN / MOON / PLANET
      nameEn: meta.nameEn,
      nameZh: meta.nameZh,
      aliases: meta.aliases,
      bayer: null,
      constellation: 'Solar System',
      constellationZh: '太阳系',
      raDeg: null,
      decDeg: null,
      isEphemeris: true,
      magnitude: meta.typicalMagnitude,
      distanceLy: null,
      spectralType: null,
      catalogIds: {},
      isNamable: false,
      isFeatured: true,
      descriptionZh: meta.descriptionZh,
      renderPriority: 100,
      searchPriority: 120,
      dataQualityScore: 80,
      sourceCatalog: 'astronomy-engine',
    };
    await prisma.celestialObject.upsert({
      where: { objectUid: meta.objectUid },
      create: { objectUid: meta.objectUid, ...data },
      update: data,
    });
    ephCount++;

    // 别名表复用 collectAliases 流程：借 toCelestialObject 快照收集（坐标与别名无关）
    const snapshot = toCelestialObject(meta.bodyId, new Date());
    await prisma.celestialNameAlias.deleteMany({ where: { objectUid: meta.objectUid } });
    const rows = collectAliases(snapshot).map((r) => ({
      objectUid: meta.objectUid,
      alias: r.alias,
      aliasNorm: normalize(r.alias),
      lang: r.lang,
      source: r.source,
    }));
    const created = await prisma.celestialNameAlias.createMany({
      data: rows,
      skipDuplicates: true,
    });
    aliasCount += created.count;
  }

  // —— 数据来源主数据（Phase 9C 溯源体系）——
  // 单一事实源：src/data-source/data-source.constants.ts（license/citation 逐字登记，绝不编造）。
  // retrievedAt 为 null 的行（运行时源/预留源）以 seed 执行时刻代填，notes 已注明语义。
  let sourceCount = 0;
  const seededAt = new Date();
  for (const src of DATA_SOURCES) {
    const data = {
      name: src.name,
      publisher: src.publisher,
      url: src.url,
      downloadUrl: src.downloadUrl ?? null,
      version: src.version,
      license: src.license,
      licenseUrl: src.licenseUrl ?? null,
      citationZh: src.citationZh,
      citationEn: src.citationEn,
      magComplete: src.magComplete ?? null,
      recordCount: src.recordCount ?? null,
      refreshPolicy: src.refreshPolicy,
      retrievedAt: src.retrievedAt ? new Date(src.retrievedAt) : seededAt,
      notes: src.notes ?? null,
    };
    await prisma.dataSource.upsert({
      where: { key: src.key },
      create: { key: src.key, ...data },
      update: data,
    });
    sourceCount++;
  }

  console.log(
    `种子完成：celestial_object ${starCount} 条 + 星历天体 ${ephCount} 条，celestial_name_alias ${aliasCount} 条，data_source ${sourceCount} 条`,
  );
}

main()
  .catch((e) => {
    console.error('种子失败：', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
