import { makePublicSlug } from './public-slug';

describe('makePublicSlug', () => {
  it('默认 12 位，字符集为去混淆小写字母+数字', () => {
    const slug = makePublicSlug();
    expect(slug).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{12}$/);
  });

  it('支持自定义长度', () => {
    expect(makePublicSlug(8)).toHaveLength(8);
  });

  it('不含易混淆字符 0/o/1/i/l', () => {
    for (let i = 0; i < 200; i++) {
      expect(makePublicSlug()).not.toMatch(/[0o1il]/);
    }
  });

  it('抽样 1000 次无重复（弱唯一性冒烟）', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(makePublicSlug());
    expect(seen.size).toBe(1000);
  });
});
