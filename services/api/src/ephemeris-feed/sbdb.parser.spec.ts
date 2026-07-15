import {
  FIXTURE_NOW_JD,
  SBDB_CERES_FIXTURE,
  SBDB_QUERY_FIXTURE,
} from './fixtures/sbdb.fixture';
import {
  cometDesignation,
  designationToId,
  filterActiveComets,
  parseSbdbQueryResponse,
  parseSbdbSingleBody,
  type SbdbQueryResponse,
} from './sbdb.parser';

describe('cometDesignation · SBDB full_name → 编号提取', () => {
  it('周期彗星：1P/Halley → 1P，3D/Biela → 3D', () => {
    expect(cometDesignation('    1P/Halley')).toBe('1P');
    expect(cometDesignation('    3D/Biela')).toBe('3D');
    expect(cometDesignation('   24P/Schaumasse')).toBe('24P');
  });

  it('临时编号：C/2023 A3 (Tsuchinshan-ATLAS) → C/2023 A3；分裂碎片 K1-D 保留后缀', () => {
    expect(cometDesignation('     C/2023 A3 (Tsuchinshan-ATLAS)')).toBe('C/2023 A3');
    expect(cometDesignation('     C/2025 K1-D (ATLAS)')).toBe('C/2025 K1-D');
    expect(cometDesignation('P/2025 UX109 (Ye)')).toBe('P/2025 UX109');
  });

  it('史料彗星（公元前/早期纪年）：C/-146 P1 与 C/240 V1 可识别（上游真实存在的形态）', () => {
    expect(cometDesignation('C/-146 P1')).toBe('C/-146 P1');
    expect(cometDesignation('C/240 V1')).toBe('C/240 V1');
  });

  it('无法识别的名字抛错（宁失败不猜测）', () => {
    expect(() => cometDesignation('Oumuamua???')).toThrow(/无法从 full_name 提取/);
  });

  it('designationToId 去符号：C/2023 A3 → C2023A3', () => {
    expect(designationToId('C/2023 A3')).toBe('C2023A3');
    expect(designationToId('1P')).toBe('1P');
    expect(designationToId('C/2025 K1-D')).toBe('C2025K1D');
  });
});

describe('parseSbdbQueryResponse · 批量彗星解析（真实响应 fixture）', () => {
  it('全部 8 行解析成功，数值逐字透传（1P 全精度锚点）', () => {
    const rows = parseSbdbQueryResponse(SBDB_QUERY_FIXTURE);
    expect(rows).toHaveLength(8);
    const halley = rows.find((r) => r.designation === '1P')!;
    expect(halley.dto).toMatchObject({
      id: '1P',
      name: '1P/Halley',
      nameZh: '哈雷彗星',
      kind: 'comet',
      e: 0.9679359956953211,
      qAu: 0.5748638313743413,
      aAu: 17.92863504856923,
      iDeg: 162.1905300439129,
      omDeg: 59.09894720612437,
      wDeg: 112.2414314637764,
      tpJd: 2446469.973616146677,
      epochJd: 2439875.5,
      m1: 5.5,
      m2: 13.6,
    });
  });

  it('近抛物线彗星 e>1、a 为负值原样透传；M2 缺测省键', () => {
    const rows = parseSbdbQueryResponse(SBDB_QUERY_FIXTURE);
    const a3 = rows.find((r) => r.designation === 'C/2023 A3')!;
    expect(a3.dto.e).toBeGreaterThan(1);
    expect(a3.dto.aAu).toBeLessThan(0);
    expect(a3.dto.nameZh).toBe('紫金山-阿特拉斯彗星');
    expect('m2' in a3.dto).toBe(false);
  });

  it('缺必需列 / 关键值非数值 → 抛错（坏批次绝不入库）', () => {
    const noField: SbdbQueryResponse = {
      fields: ['full_name', 'e'],
      data: [['1P/Halley', '0.9']],
    };
    expect(() => parseSbdbQueryResponse(noField)).toThrow(/缺少必需列/);

    const badRow: SbdbQueryResponse = {
      fields: [...SBDB_QUERY_FIXTURE.fields],
      data: [
        [
          '  99P/Fake',
          'not-a-number',
          '1.0',
          '2.0',
          '1.0',
          '1.0',
          '1.0',
          '2461000.5',
          '0.0',
          '2461000.5',
          '9.0',
          null,
        ],
      ],
    };
    expect(() => parseSbdbQueryResponse(badRow)).toThrow(/非有限数值/);
  });
});

describe('filterActiveComets · 现役亮彗星过滤（|tp−now|≤2 年 && M1≤12 + 白名单）', () => {
  const parsed = parseSbdbQueryResponse(SBDB_QUERY_FIXTURE);
  const kept = filterActiveComets(parsed, FIXTURE_NOW_JD);
  const ids = kept.map((b) => b.id);

  it('规则命中：C2024G2（M1=4.6，tp 在窗内）、C2023A3、C2025K1D 保留', () => {
    expect(ids).toContain('C2024G2');
    expect(ids).toContain('C2023A3');
    expect(ids).toContain('C2025K1D');
  });

  it('白名单永久保留：1P（tp=1986 早已出窗）与 2P（M1=15.6 超限）仍在', () => {
    expect(ids).toEqual(expect.arrayContaining(['1P', '2P', '12P']));
  });

  it('规则剔除：3D/Biela（tp=1874）与 24P（M1=14.6）不保留', () => {
    expect(ids).not.toContain('3D');
    expect(ids).not.toContain('24P');
    expect(kept).toHaveLength(6);
  });

  it('按 M1 从亮到暗排序（C2024G2 4.6 首位）', () => {
    expect(ids[0]).toBe('C2024G2');
    const m1s = kept.map((b) => b.m1 ?? Infinity);
    expect([...m1s].sort((a, b) => a - b)).toEqual(m1s);
  });
});

describe('parseSbdbSingleBody · 小行星单体解析（Ceres fixture）', () => {
  const target = { sstr: '1', id: 'ceres', nameZh: '谷神星' };

  it('全字段逐字透传，kind=asteroid', () => {
    const dto = parseSbdbSingleBody(SBDB_CERES_FIXTURE, target);
    expect(dto).toMatchObject({
      id: 'ceres',
      name: '1 Ceres (A801 AA)',
      nameZh: '谷神星',
      kind: 'asteroid',
      epochJd: 2461200.5,
      e: 0.07969229514816586,
      aAu: 2.765552595034094,
      qAu: 2.545159361382861,
      iDeg: 10.58802780183462,
      omDeg: 80.24862682043221,
      wDeg: 73.29421453021587,
      maDeg: 274.4193463761342,
    });
  });

  it('des 与请求 sstr 不一致 → 抛错（防上游模糊匹配串号）', () => {
    expect(() =>
      parseSbdbSingleBody(SBDB_CERES_FIXTURE, { sstr: '2', id: 'pallas', nameZh: '智神星' }),
    ).toThrow(/不一致/);
  });

  it('缺 orbit.elements → 抛错', () => {
    expect(() => parseSbdbSingleBody({ object: { des: '1' } }, target)).toThrow(
      /缺少 orbit\.elements/,
    );
  });
});
