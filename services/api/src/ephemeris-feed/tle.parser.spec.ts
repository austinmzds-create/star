import { BUILTIN_TLE_SATS } from './builtin-snapshot';
import { CELESTRAK_ISS_FIXTURE } from './fixtures/sbdb.fixture';
import {
  parseCelestrakGroupTle,
  parseCelestrakTle,
  parseTleEpoch,
  tleChecksumOk,
} from './tle.parser';

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

describe('parseCelestrakGroupTle · 整组解析（宽容跳过坏行，不抛错）', () => {
  /** 用两条合法行体拼一个三行/条的组响应（名称行 + l1 + l2）。 */
  function groupText(): string {
    const a = BUILTIN_TLE_SATS[0]!;
    const b = BUILTIN_TLE_SATS[2]!;
    return `STARLINK-1001\r\n${a.l1}\r\n${a.l2}\r\nSTARLINK-1002\r\n${b.l1}\r\n${b.l2}\r\n`;
  }

  it('多条三行块解析出全部合法条目，携带 NORAD 目录号', () => {
    const rows = parseCelestrakGroupTle(groupText());
    expect(rows).toHaveLength(2);
    expect(rows[0]!.name).toBe('STARLINK-1001');
    expect(rows[0]!.noradId).toBe(25544);
    expect(rows[1]!.noradId).toBe(20580);
    for (const r of rows) {
      expect(r.l1).toHaveLength(69);
      expect(r.l2).toHaveLength(69);
      expect(r.epochAt).not.toBeNull();
    }
  });

  it('组内单条坏行（校验和被破坏）被静默跳过，其余照收', () => {
    const a = BUILTIN_TLE_SATS[0]!;
    const b = BUILTIN_TLE_SATS[2]!;
    const badL1 = a.l1.slice(0, 68) + (a.l1[68] === '0' ? '1' : '0'); // 篡改校验位
    const text = `BAD\r\n${badL1}\r\n${a.l2}\r\nGOOD\r\n${b.l1}\r\n${b.l2}\r\n`;
    const rows = parseCelestrakGroupTle(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.noradId).toBe(20580);
  });

  it('空/无数据响应 → 空数组（绝不抛错）', () => {
    expect(parseCelestrakGroupTle('No GP data found\r\n')).toEqual([]);
    expect(parseCelestrakGroupTle('')).toEqual([]);
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
