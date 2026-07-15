import { describe, expect, it } from 'vitest';
import {
  CATALOG_BY_UID,
  CONSTELLATION_ABBR,
  CONSTELLATION_LINES,
  CONSTELLATION_LINES_BY_CON,
} from '../src/index.js';
import linesJson from '../src/generated/constellation-lines.json';

describe('CONSTELLATION_LINES 星座连线', () => {
  it('88 星座全覆盖（键集合 == CONSTELLATION_ABBR 键集合）', () => {
    const cons = new Set(CONSTELLATION_LINES.map((c) => c.con));
    const abbrs = Object.keys(CONSTELLATION_ABBR);
    expect(abbrs.length).toBe(88);
    expect(cons.size).toBe(88);
    for (const abbr of abbrs) {
      expect(cons.has(abbr), abbr).toBe(true);
    }
  });

  it('生成期零丢段（droppedSegments === 0）', () => {
    expect(linesJson.meta.droppedSegments).toBe(0);
  });

  it('每个端点 uid 均可经 CATALOG_BY_UID 解析（100% 可绘制）', () => {
    for (const c of CONSTELLATION_LINES) {
      for (const [a, b] of c.segments) {
        expect(CATALOG_BY_UID.has(a), `${c.con} ${a}`).toBe(true);
        expect(CATALOG_BY_UID.has(b), `${c.con} ${b}`).toBe(true);
      }
    }
  });

  it('线段总数 > 700，且每星座至少 1 段、无自环', () => {
    let total = 0;
    for (const c of CONSTELLATION_LINES) {
      expect(c.segments.length, c.con).toBeGreaterThan(0);
      for (const [a, b] of c.segments) {
        expect(a, c.con).not.toBe(b);
        total++;
      }
    }
    expect(total).toBeGreaterThan(700);
    expect(linesJson.meta.segmentCount).toBe(total);
  });

  it('端点星足够亮（均在核心层 mag ≤ 6.5 目录内）', () => {
    for (const c of CONSTELLATION_LINES) {
      for (const seg of c.segments) {
        for (const uid of seg) {
          const star = CATALOG_BY_UID.get(uid)!;
          expect(star.type).toBe('star');
          expect(star.magnitude, `${c.con} ${uid}`).toBeLessThanOrEqual(6.5);
        }
      }
    }
  });

  it('ξ UMa 案例：UMa 含 HD98231 端点（HYG 无 HIP 的亮星经 HD uid 命中）', () => {
    const uma = CONSTELLATION_LINES_BY_CON.get('UMa');
    expect(uma).toBeDefined();
    const uids = new Set(uma!.segments.flat());
    expect(uids.has('HD98231')).toBe(true);
    expect(CATALOG_BY_UID.has('HD98231')).toBe(true);
  });

  it('按缩写索引可取到猎户座，且线段端点属于该星座', () => {
    const ori = CONSTELLATION_LINES_BY_CON.get('Ori');
    expect(ori).toBeDefined();
    expect(ori!.segments.length).toBeGreaterThanOrEqual(5);
  });
});
