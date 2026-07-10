/**
 * 种子脚本：把 @star/astro-data 的 CELESTIAL_CATALOG 灌入
 * celestial_object + celestial_name_alias，为 Phase 3 的 pg_trgm DB 化搜索铺路。
 *
 * 运行方式（仅在有真实 Postgres 的环境）：pnpm --filter @star/api db:seed
 * 本地无 DB 的容器不要运行。
 */
import { PrismaClient, type CelestialType } from '@prisma/client';
import { CELESTIAL_CATALOG, type CelestialObject } from '@star/astro-data';

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

  for (const obj of CELESTIAL_CATALOG) {
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
      sourceCatalog: 'astro-data-seed-v1',
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

  console.log(`种子完成：celestial_object ${starCount} 条，celestial_name_alias ${aliasCount} 条`);
}

main()
  .catch((e) => {
    console.error('种子失败：', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
