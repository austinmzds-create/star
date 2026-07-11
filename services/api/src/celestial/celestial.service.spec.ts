import { CELESTIAL_CATALOG } from '@star/astro-data';
import { AppError, ErrorCodes } from '../common/errors/app-error';
import { CelestialService } from './celestial.service';

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

  it('getNamableByUid 对可命名星体正常返回', () => {
    // 注入一颗显式可命名星体，避免依赖真实星表的命名候选判定（合规模型可能调整著名星）
    const custom = [{ ...CELESTIAL_CATALOG[0]!, objectUid: 'TEST-NAMABLE', isNamable: true }];
    const customService = new CelestialService(custom);
    expect(customService.getNamableByUid('TEST-NAMABLE').objectUid).toBe('TEST-NAMABLE');
  });
});
