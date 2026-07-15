/**
 * star-extras 懒加载单测（Phase 9C，跨域契约 2）。
 *
 * 锚点期望值全部先对缓存 CSV（scripts/.cache/hygdata.csv，HYG v41）与
 * IAU-CSN.txt（pas.rochester.edu，2026-07-15 抓取）实读核实再写入断言，绝非手编。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CELESTIAL_CATALOG, loadStarExtras } from '../src/index.js';

describe('loadStarExtras · 懒加载单例', () => {
  it('并发两次调用返回同一 Map 实例（单例缓存）', async () => {
    const [a, b] = await Promise.all([loadStarExtras(), loadStarExtras()]);
    expect(a).toBe(b);
    expect(a).toBe(await loadStarExtras());
  });

  it('规模合理：≈ 核心层 + 允许名单（比邻星）', async () => {
    const extras = await loadStarExtras();
    expect(extras.size).toBeGreaterThanOrEqual(8000);
    expect(extras.size).toBeLessThanOrEqual(11000);
    // 核心层 uid 覆盖率 100%（extras 覆盖全部核心层星）
    let missing = 0;
    for (const s of CELESTIAL_CATALOG) {
      if (!extras.has(s.objectUid)) missing++;
    }
    expect(missing).toBe(0);
  });

  it('字段完整性锚点：天狼星（pm/ci/聚星/IAU 名）', async () => {
    const extras = await loadStarExtras();
    const sirius = extras.get('HIP32349')!;
    expect(sirius.pmRa).toBeCloseTo(-546.0, 0);
    expect(sirius.pmDec).toBeCloseTo(-1223.1, 0);
    expect(sirius.ci).toBeCloseTo(0.01, 2); // CSV ci=0.009 → round 0.01
    expect(sirius.multiple).toBe(true); // base='Gl 244'（天狼 B 同组）
    expect(sirius.iauName).toBe('Sirius');
  });

  it('变星锚点：北极星（var=Alp，幅度 1.99–1.95；HYG 语义 varMin=最暗）', async () => {
    const extras = await loadStarExtras();
    const polaris = extras.get('HIP11767')!;
    expect(polaris.varMin).toBeCloseTo(1.99, 2);
    expect(polaris.varMax).toBeCloseTo(1.95, 2);
    expect(polaris.varMin!).toBeGreaterThan(polaris.varMax!); // 最暗端星等更大
    expect(polaris.ci).toBeCloseTo(0.64, 2);
    expect(polaris.iauName).toBe('Polaris');
  });

  it('IAU-CSN 官方名：织女星 Vega；命中条数 ≥300；非命名星无 iauName', async () => {
    const extras = await loadStarExtras();
    expect(extras.get('HIP91262')?.iauName).toBe('Vega');
    let named = 0;
    for (const ex of extras.values()) {
      if (ex.iauName) named++;
    }
    expect(named).toBeGreaterThanOrEqual(300); // 2026-07-15 实测 339
    expect(named).toBeLessThan(600); // IAU-CSN 总量级上限（防解析串列）
  });

  it('允许名单：比邻星（核心层外）有完整记录', async () => {
    const extras = await loadStarExtras();
    const proxima = extras.get('HIP70890')!;
    expect(proxima.pmRa).toBeCloseTo(-3775.6, 1);
    expect(proxima.pmDec).toBeCloseTo(768.2, 1);
    expect(proxima.ci).toBeCloseTo(1.81, 2);
    expect(proxima.iauName).toBe('Proxima Centauri');
  });

  it('字段值域：pm |·|<10500 mas/yr、ci ∈ (-1, 6)、变星幅度成对有限', async () => {
    const extras = await loadStarExtras();
    for (const [uid, ex] of extras) {
      if (ex.pmRa !== undefined) {
        expect(Number.isFinite(ex.pmRa), uid).toBe(true);
        expect(Number.isFinite(ex.pmDec!), uid).toBe(true);
        expect(Math.abs(ex.pmRa)).toBeLessThan(10500);
        expect(Math.abs(ex.pmDec!)).toBeLessThan(10500);
      }
      if (ex.ci !== undefined) {
        expect(ex.ci).toBeGreaterThan(-1);
        expect(ex.ci).toBeLessThan(6);
      }
      if (ex.varMin !== undefined) expect(ex.varMax, uid).toBeDefined();
      if (ex.iauName !== undefined) expect(ex.iauName.length).toBeGreaterThan(0);
    }
  });
});

describe('lean 主表（First Load 回收契约）', () => {
  it('bright-stars.json 原始文本不含 pmra/pmdec/ci 键（增强字段绝不回流主 chunk）', () => {
    const raw = readFileSync(resolve(__dirname, '../src/generated/bright-stars.json'), 'utf8');
    expect(raw.includes('"pmra"')).toBe(false);
    expect(raw.includes('"pmdec"')).toBe(false);
    expect(raw.includes('"ci"')).toBe(false);
  });

  it('iau-csn-meta.json 溯源元数据完整（许可/引用/抓取时间/条数）', () => {
    const meta = JSON.parse(
      readFileSync(resolve(__dirname, '../src/generated/iau-csn-meta.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(meta.license).toBe('CC BY 4.0');
    expect(meta.publisher).toContain('WGSN');
    expect(typeof meta.retrievedAt).toBe('string');
    expect(meta.recordCount as number).toBeGreaterThanOrEqual(400);
    expect(String(meta.citationText)).toContain('非 IAU 官方命名'); // 免责声明反向引用（合规红线）
    expect(Array.isArray(meta.approvalDateRange)).toBe(true);
  });
});
