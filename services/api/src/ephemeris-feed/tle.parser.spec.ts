import { BUILTIN_TLE_SATS } from './builtin-snapshot';
import { CELESTRAK_ISS_FIXTURE } from './fixtures/sbdb.fixture';
import { parseCelestrakTle, parseTleEpoch, tleChecksumOk } from './tle.parser';

describe('parseCelestrakTle · Celestrak GP 响应解析（真实响应 fixture）', () => {
  it('3 行响应（名称行补空格 + \\r\\n）解析成功，校验和通过', () => {
    const parsed = parseCelestrakTle(CELESTRAK_ISS_FIXTURE, 25544);
    expect(parsed.name).toBe('ISS (ZARYA)');
    expect(parsed.l1).toHaveLength(69);
    expect(parsed.l2).toHaveLength(69);
    expect(tleChecksumOk(parsed.l1)).toBe(true);
    expect(tleChecksumOk(parsed.l2)).toBe(true);
  });

  it('历元解析：26196.12126347 → 2026-07-15（UTC 年积日 196）', () => {
    const parsed = parseCelestrakTle(CELESTRAK_ISS_FIXTURE, 25544);
    expect(parsed.epochAt).not.toBeNull();
    expect(parsed.epochAt!.toISOString().slice(0, 10)).toBe('2026-07-15');
  });

  it('NORAD 目录号不匹配 → 抛错（防上游/代理串号）', () => {
    expect(() => parseCelestrakTle(CELESTRAK_ISS_FIXTURE, 48274)).toThrow(/目录号/);
  });

  it('校验和被破坏 → 抛错（坏行绝不入库）', () => {
    // 篡改 l1 第 20 列的一位数字（历元字段内），校验位不再匹配
    const corrupted = CELESTRAK_ISS_FIXTURE.replace('26196.12126347', '26196.12126348');
    expect(() => parseCelestrakTle(corrupted, 25544)).toThrow(/校验和/);
  });

  it('行长度非 69 → 抛错', () => {
    const truncated = CELESTRAK_ISS_FIXTURE.replace(/9999\r\n/, '999\r\n');
    expect(() => parseCelestrakTle(truncated, 25544)).toThrow(/长度|校验和|TLE 行/);
  });

  it('缺 TLE 行 → 抛错', () => {
    expect(() => parseCelestrakTle('No GP data found\r\n', 25544)).toThrow(/缺少 TLE 行/);
  });
});

describe('内置 TLE 兜底快照完整性（与 web 侧同批次，server 口径自校验）', () => {
  it('3 颗卫星（ISS/天宫/HST）快照行全部通过 mod-10 校验', () => {
    expect(BUILTIN_TLE_SATS).toHaveLength(3);
    for (const sat of BUILTIN_TLE_SATS) {
      expect(tleChecksumOk(sat.l1)).toBe(true);
      expect(tleChecksumOk(sat.l2)).toBe(true);
      expect(parseTleEpoch(sat.l1)).not.toBeNull();
    }
  });

  it('快照 id 与 web 卫星 uid 对齐（SAT- 前缀），历元为 2026-07-11 批次', () => {
    expect(BUILTIN_TLE_SATS.map((s) => s.id)).toEqual(['SAT-ISS', 'SAT-TIANGONG', 'SAT-HST']);
    for (const sat of BUILTIN_TLE_SATS) {
      expect(parseTleEpoch(sat.l1)!.toISOString().slice(0, 10)).toBe('2026-07-11');
    }
  });
});
