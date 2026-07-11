import { CELESTIAL_CATALOG } from '@star/astro-data';
import { AppError, ErrorCodes } from '../common/errors/app-error';
import { CelestialController } from './celestial.controller';
import { CelestialService } from './celestial.service';
import { parseAtParam } from './dto/at-param';

/** 捕获同步抛出的 AppError（未抛出则测试失败）。 */
function catchAppError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error('应当抛出 AppError 但未抛出');
}

describe('CelestialService', () => {
  const service = new CelestialService();

  it('search("天狼") 首位命中天狼星', () => {
    const results = service.search('天狼');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.object.nameZh).toBe('天狼星');
    expect(results[0]!.object.objectUid).toBe('HIP32349');
  });

  it('search("sirius") 大小写不敏感命中', () => {
    const results = service.search('sirius');
    expect(results[0]!.object.nameEn).toBe('Sirius');
  });

  it('search 遵守 limit', () => {
    const results = service.search('HIP', 3);
    expect(results.length).toBeLessThanOrEqual(3);
    expect(results.length).toBeGreaterThan(0);
  });

  it('getByUid 已知 uid 返回对象', () => {
    const obj = service.getByUid('HIP32349');
    expect(obj.nameEn).toBe('Sirius');
  });

  it('getByUid 未知 uid 抛 CELESTIAL_NOT_FOUND', () => {
    const err = catchAppError(() => service.getByUid('HIP99999'));
    expect(err.code).toBe(ErrorCodes.CELESTIAL_NOT_FOUND);
  });

  it('getNamableByUid 对 isNamable=false 的星体抛 CELESTIAL_NOT_NAMABLE', () => {
    // 著名星（如天狼星）按合规红线 isNamable=false；再构造一份显式不可命名条目验证
    const custom = [{ ...CELESTIAL_CATALOG[0]!, objectUid: 'TEST-LOCKED', isNamable: false }];
    const customService = new CelestialService(custom);
    const err = catchAppError(() => customService.getNamableByUid('TEST-LOCKED'));
    expect(err.code).toBe(ErrorCodes.CELESTIAL_NOT_NAMABLE);
  });

  it('深空天体可搜索可点击：search("仙女座星系") 命中 M31，getByUid("M31") 返回真实坐标', () => {
    const results = service.search('仙女座星系');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.object.objectUid).toBe('M31');
    const m31 = service.getByUid('M31');
    expect(m31.type).toBe('galaxy');
    expect(m31.isFeatured).toBe(true);
    expect(m31.raDeg).toBeCloseTo(10.68, 0);
    expect(m31.decDeg).toBeCloseTo(41.27, 0);
  });

  it('合规锁：深空天体一律不可命名，getNamableByUid("M42") 抛 CELESTIAL_NOT_NAMABLE', () => {
    const err = catchAppError(() => service.getNamableByUid('M42'));
    expect(err.code).toBe(ErrorCodes.CELESTIAL_NOT_NAMABLE);
  });

  it('getNamableByUid 对可命名星体正常返回', () => {
    // 注入一颗显式可命名星体，避免依赖真实星表的命名候选判定（合规模型可能调整著名星）
    const custom = [{ ...CELESTIAL_CATALOG[0]!, objectUid: 'TEST-NAMABLE', isNamable: true }];
    const customService = new CelestialService(custom);
    expect(customService.getNamableByUid('TEST-NAMABLE').objectUid).toBe('TEST-NAMABLE');
  });
});

/** 两个赤经角的最小角距（度，处理 0/360 环绕）。 */
function raDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

describe('CelestialService · 星历天体（行星/日月）', () => {
  const service = new CelestialService();
  const at = new Date('2026-07-11T00:00:00Z');

  it('search("火星") 首位命中 EPH-MARS，坐标为有限数', () => {
    const results = service.search('火星', 8, at);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.object.objectUid).toBe('EPH-MARS');
    expect(Number.isFinite(results[0]!.object.raDeg)).toBe(true);
    expect(Number.isFinite(results[0]!.object.decDeg)).toBe(true);
  });

  it('search("荧惑") 古称命中火星，search("Jupiter") 命中木星', () => {
    expect(service.search('荧惑', 8, at)[0]!.object.objectUid).toBe('EPH-MARS');
    expect(service.search('Jupiter', 8, at)[0]!.object.objectUid).toBe('EPH-JUPITER');
  });

  it('getByUid("EPH-MOON") 坐标确随 at 变化（3 天赤经差 > 20°）', () => {
    const at2 = new Date(at.getTime() + 3 * 24 * 3600 * 1000);
    const moon1 = service.getByUid('EPH-MOON', at);
    const moon2 = service.getByUid('EPH-MOON', at2);
    expect(raDelta(moon1.raDeg, moon2.raDeg)).toBeGreaterThan(20);
  });

  it('getByUid("EPH-SUN") 返回 isEphemeris 快照且不改写缓存目录', () => {
    const sun1 = service.getByUid('EPH-SUN', at);
    expect(sun1.isEphemeris).toBe(true);
    expect(sun1.isNamable).toBe(false);
    expect(Number.isFinite(sun1.raDeg)).toBe(true);
    // 半年后太阳赤经应移动约 180°——若缓存被上一次调用改写则拿不到不同值
    const at2 = new Date('2027-01-08T00:00:00Z');
    const sun2 = service.getByUid('EPH-SUN', at2);
    expect(raDelta(sun1.raDeg, sun2.raDeg)).toBeGreaterThan(90);
    // 再用原时刻取值，与第一次逐字段一致（确定性 + 目录未被污染）
    expect(service.getByUid('EPH-SUN', at)).toEqual(sun1);
  });

  it('listAll 不含星历天体（证书/纪念册邻域星只能是恒星）', () => {
    expect(service.listAll().some((o) => o.isEphemeris)).toBe(false);
  });

  it('合规锁：getNamableByUid("EPH-MOON") 抛 CELESTIAL_NOT_NAMABLE', () => {
    const err = catchAppError(() => service.getNamableByUid('EPH-MOON'));
    expect(err.code).toBe(ErrorCodes.CELESTIAL_NOT_NAMABLE);
  });
});

describe('CelestialController · ?at= 与 ephemeris 响应块', () => {
  const controller = new CelestialController(new CelestialService());

  it('GET /celestial/EPH-MOON?at= 响应含 ephemeris 块与 moonPhase', () => {
    const res = controller.getByUid('EPH-MOON', { at: '2026-07-11T00:00:00Z' });
    expect(res.object.objectUid).toBe('EPH-MOON');
    expect(res.ephemeris).toBeDefined();
    expect(res.ephemeris!.computedAt).toBe(new Date('2026-07-11T00:00:00Z').toISOString());
    expect(res.ephemeris!.distanceAu).toBeGreaterThan(0.002);
    expect(res.ephemeris!.moonPhase).toBeDefined();
    expect(res.ephemeris!.moonPhase!.illumination).toBeGreaterThanOrEqual(0);
    expect(res.ephemeris!.moonPhase!.illumination).toBeLessThanOrEqual(1);
    // 行星有 ephemeris 块但没有 moonPhase
    const mars = controller.getByUid('EPH-MARS', { at: '2026-07-11T00:00:00Z' });
    expect(mars.ephemeris).toBeDefined();
    expect(mars.ephemeris!.moonPhase).toBeUndefined();
  });

  it('恒星 uid 的响应不含 ephemeris 块', () => {
    const res = controller.getByUid('HIP32349', {});
    expect(res.object.nameEn).toBe('Sirius');
    expect(res.ephemeris).toBeUndefined();
  });

  it('at 支持 epoch 毫秒；非法 at 抛 INVALID_QUERY（HTTP 400）', () => {
    const ms = Date.UTC(2026, 6, 11);
    const res = controller.getByUid('EPH-SUN', { at: String(ms) });
    expect(res.ephemeris!.computedAt).toBe(new Date(ms).toISOString());
    const err = catchAppError(() => parseAtParam('not-a-date'));
    expect(err.code).toBe(ErrorCodes.INVALID_QUERY);
    // 缺省 at 正常（用服务端当前时刻）
    expect(controller.getByUid('EPH-SUN', {}).ephemeris).toBeDefined();
  });

  it('search 接口对星历命中返回实时坐标', () => {
    const res = controller.search({ q: '太白', at: '2026-07-11T00:00:00Z' });
    expect(res.items[0]!.object.objectUid).toBe('EPH-VENUS');
    expect(Number.isFinite(res.items[0]!.object.raDeg)).toBe(true);
  });
});
