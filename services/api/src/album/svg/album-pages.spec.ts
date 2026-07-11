import { COMPLIANCE_NOTICE } from '../../common/compliance';
import { formatDec, formatRa } from '../../certificate/svg/format';
import { renderAlbumCombined, renderAlbumPages, type AlbumPagesInput } from './album-pages';

function makeInput(overrides: Partial<AlbumPagesInput> = {}): AlbumPagesInput {
  return {
    memorialName: '阿星',
    occasionCode: 'LOVE',
    memorialDateIso: '2026-02-14',
    registrationNo: 'STAR-20260711-K7PX',
    blessingText: '你是我的天狼星',
    storyText: '我们在这片星空下相遇。',
    letter: '今夜我在大犬座为你寻到一颗星，把它郑重登记、悄悄安放。',
    star: {
      nameZh: '天狼星',
      nameEn: 'Sirius',
      constellationZh: '大犬座',
      raDeg: 101.287,
      decDeg: -16.716,
      magnitude: -1.46,
      distanceLy: 8.6,
      spectralType: 'A1V',
      catalogIds: { hip: '32349', hd: '48915', uid: 'HIP32349' },
    },
    neighbors: [
      { nameZh: '老人星', raDeg: 95.988, decDeg: -52.696, magnitude: -0.74, objectUid: 'HIP30438' },
      { nameZh: '南河三', raDeg: 114.825, decDeg: 5.225, magnitude: 0.34, objectUid: 'HIP37279' },
    ],
    compliance: COMPLIANCE_NOTICE,
    ...overrides,
  };
}

describe('renderAlbumPages', () => {
  it('长度 6，name 顺序固定 cover→dedication', () => {
    const pages = renderAlbumPages(makeInput());
    expect(pages).toHaveLength(6);
    expect(pages.map((p) => p.name)).toEqual([
      'cover',
      'star-map',
      'story',
      'letter',
      'astro',
      'dedication',
    ]);
  });

  it('每页是完整 <svg>，含 viewBox="0 0 1200 1600"', () => {
    for (const page of renderAlbumPages(makeInput())) {
      expect(page.svg.startsWith('<svg')).toBe(true);
      expect(page.svg.endsWith('</svg>')).toBe(true);
      expect(page.svg).toContain('viewBox="0 0 1200 1600"');
    }
  });

  it('字段注入：cover 含纪念名；letter 含来信片段；astro 含 RA/Dec/星座/光谱/距离', () => {
    const pages = renderAlbumPages(makeInput());
    const byName = Object.fromEntries(pages.map((p) => [p.name, p.svg]));
    expect(byName.cover).toContain('阿星');
    expect(byName.letter).toContain('今夜我在大犬座');
    expect(byName.astro).toContain(formatRa(101.287));
    expect(byName.astro).toContain(formatDec(-16.716));
    expect(byName.astro).toContain('大犬座');
    expect(byName.astro).toContain('A1V');
    expect(byName.astro).toContain('8.6 光年');
    expect(byName.astro).toContain('HIP 32349');
  });

  it('注入防护：脚本标签被转义', () => {
    const pages = renderAlbumPages(makeInput({ memorialName: '<script>alert(1)</script>' }));
    for (const page of pages) {
      expect(page.svg).not.toContain('<script>');
    }
    const cover = pages.find((p) => p.name === 'cover')!.svg;
    expect(cover).toContain('&lt;script&gt;');
  });

  it('星图页复用 renderStarMapSvg：含目标星名 + 嵌套 <svg 900×900', () => {
    const map = renderAlbumPages(makeInput()).find((p) => p.name === 'star-map')!.svg;
    expect(map).toContain('天狼星');
    expect(map).toContain('viewBox="0 0 900 900"');
    // 嵌套 svg 被 embed 到 (150,380)
    expect(map).toContain('x="150"');
  });

  it('合规：dedication 页含合规关键片段，每页 footer 含 第 X / 6 页', () => {
    const pages = renderAlbumPages(makeInput());
    const ded = pages.find((p) => p.name === 'dedication')!.svg;
    expect(ded).toContain('国际天文学联合会');
    pages.forEach((p, i) => {
      expect(p.svg).toContain(`第 ${i + 1} / 6 页`);
    });
  });

  it('storyText/blessingText 为 null 不抛，走默认文案', () => {
    expect(() =>
      renderAlbumPages(makeInput({ storyText: null, blessingText: null })),
    ).not.toThrow();
    const story = renderAlbumPages(makeInput({ storyText: null, blessingText: null })).find(
      (p) => p.name === 'story',
    )!.svg;
    expect(story).toContain('愿这段心意');
  });
});

describe('renderAlbumCombined', () => {
  it('单 <svg>，viewBox 高 = 1600*6 + 40*5，含 6 处嵌套页，确定性', () => {
    const pages = renderAlbumPages(makeInput());
    const combined = renderAlbumCombined(pages, 'STAR-20260711-K7PX', COMPLIANCE_NOTICE);
    expect(combined.startsWith('<svg')).toBe(true);
    expect(combined.endsWith('</svg>')).toBe(true);
    const expectedH = 1600 * 6 + 40 * 5;
    expect(combined).toContain(`viewBox="0 0 1200 ${expectedH}"`);
    // 6 处嵌套页（x="0"）
    const matches = combined.match(/<svg[^>]*\sx="0"/g) ?? [];
    expect(matches.length).toBe(6);
    // 确定性
    const again = renderAlbumCombined(renderAlbumPages(makeInput()), 'STAR-20260711-K7PX', COMPLIANCE_NOTICE);
    expect(again).toBe(combined);
  });
});
