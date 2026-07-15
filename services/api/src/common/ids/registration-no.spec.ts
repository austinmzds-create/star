import { makeRegistrationNo } from './registration-no';

describe('makeRegistrationNo', () => {
  it('格式为 STAR-YYYYMMDD-XXXX，日期段等于注入的 now', () => {
    const no = makeRegistrationNo(new Date('2026-07-10T12:00:00Z'));
    expect(no).toMatch(/^STAR-\d{8}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
    expect(no.startsWith('STAR-20260710-')).toBe(true);
  });

  it('后缀字符集不含易混淆字符 0/O/1/I/L', () => {
    for (let i = 0; i < 200; i++) {
      const suffix = makeRegistrationNo().split('-')[2]!;
      expect(suffix).not.toMatch(/[0O1IL]/);
    }
  });

  it('抽样 1000 次几乎无重复（弱唯一性冒烟）', () => {
    // 4 位后缀共 31^4 ≈ 92 万组合，1000 次抽样按生日悖论期望碰撞 ≈ 0.5 次，
    // 断言「完全无重复」会以约 42% 概率随机失败；给 10 次碰撞容差（P(>10) 可忽略）。
    // 真实唯一性由 DB @unique + 冲突重试兜底，此处只冒烟随机性本身。
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(makeRegistrationNo());
    expect(seen.size).toBeGreaterThan(990);
  });
});
