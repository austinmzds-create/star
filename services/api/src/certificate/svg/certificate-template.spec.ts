import { COMPLIANCE_NOTICE } from '../../common/compliance';
import { formatDec, formatRa } from './format';
import { gnomonicProject } from './projection';
import { renderCertificateSvg, type CertificateSvgInput } from './certificate-template';
import { renderStarMapSvg, type StarMapNeighbor } from './star-map';

function baseInput(overrides: Partial<CertificateSvgInput> = {}): CertificateSvgInput {
  return {
    memorialName: '致挚爱',
    occasionCode: 'LOVE',
    memorialDateIso: '2026-02-14',
    registrationNo: 'STAR-20260710-K7PX',
    blessingText: '愿这颗星一直亮着',
    star: {
      nameZh: '天狼星',
      nameEn: 'Sirius',
      constellationZh: '大犬座',
      raDeg: 101.287,
      decDeg: -16.716,
      magnitude: -1.46,
    },
    compliance: COMPLIANCE_NOTICE,
    ...overrides,
  };
}

describe('renderCertificateSvg', () => {
  it('输出以 <svg 开头、含 viewBox / registrationNo / 星名 / 合规片段', () => {
    const svg = renderCertificateSvg(baseInput());
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 1200 1600"');
    expect(svg).toContain('STAR-20260710-K7PX');
    expect(svg).toContain('天狼星');
    // 合规声明关键片段
    expect(svg).toContain('国际天文学联合会');
  });

  it('用户文本注入前转义：< > & " 全部实体化，不含裸标签', () => {
    const svg = renderCertificateSvg(baseInput({ memorialName: '<b>A&B"C' }));
    expect(svg).toContain('&lt;b&gt;A&amp;B&quot;C');
    expect(svg).not.toContain('<b>A');
  });

  it('blessing 为 null 时不崩、不出现 null 字样', () => {
    const svg = renderCertificateSvg(baseInput({ blessingText: null }));
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toContain('null');
  });

  it('超长 memorialName（41 码点）不抛错、行数受限', () => {
    const long = '星'.repeat(41);
    expect(() => renderCertificateSvg(baseInput({ memorialName: long }))).not.toThrow();
    const svg = renderCertificateSvg(baseInput({ memorialName: long }));
    // 折叠到 2 行 + 省略号
    expect(svg).toContain('…');
  });
});

describe('renderStarMapSvg', () => {
  const target = {
    nameZh: '天狼星',
    raDeg: 101.287,
    decDeg: -16.716,
    magnitude: -1.46,
    objectUid: 'HIP32349',
  };

  it('含 data-role="target" 且目标名出现一次', () => {
    const svg = renderStarMapSvg({ target, neighbors: [] });
    expect(svg).toContain('data-role="target"');
    const matches = svg.match(/天狼星/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('fov 外（90°）的邻居被剔除，其坐标不出现在输出', () => {
    const farNeighbor: StarMapNeighbor = {
      nameZh: '远星',
      raDeg: 191.287, // 约 90° 外
      decDeg: -16.716,
      magnitude: 2,
      objectUid: 'FAR-1',
    };
    const svg = renderStarMapSvg({ target, neighbors: [farNeighbor], fovDeg: 30 });
    expect(svg).not.toContain('远星');
  });

  it('视场内邻居被渲染', () => {
    const near: StarMapNeighbor = {
      nameZh: '近星',
      raDeg: 103, // 中心附近
      decDeg: -15,
      magnitude: 2,
      objectUid: 'NEAR-1',
    };
    const svg = renderStarMapSvg({ target, neighbors: [near], fovDeg: 30 });
    // 近星以 circle 渲染（无标签），至少不崩且含多个 circle
    expect(svg.startsWith('<svg')).toBe(true);
    expect((svg.match(/<circle/g) ?? []).length).toBeGreaterThan(1);
  });

  it('空 neighbors 不崩', () => {
    expect(() => renderStarMapSvg({ target, neighbors: [] })).not.toThrow();
  });
});

describe('format & projection', () => {
  it('formatRa(101.287) 约 06h 45m', () => {
    expect(formatRa(101.287)).toMatch(/^06h 45m/);
  });

  it('formatDec(-16.716) 含 -16°', () => {
    expect(formatDec(-16.716)).toContain('-16°');
  });

  it('gnomonicProject 中心自映射到 (0,0)', () => {
    const p = gnomonicProject(101.287, -16.716, 101.287, -16.716);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(0, 9);
  });
});
