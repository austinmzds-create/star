import { describe, expect, it } from 'vitest';
import { deviceOrientationToLookDirection } from '../src/index.js';

/**
 * 锚点用例来自 W3C 设备方向定义的物理直觉：
 * 「视线」= 屏幕背面法向（设备 −z 轴）。
 */
describe('deviceOrientationToLookDirection', () => {
  it('手机平放桌面、屏幕朝上 (0,0,0) → 视线指向地心（alt=−90°）', () => {
    const d = deviceOrientationToLookDirection(0, 0, 0);
    expect(d.altitudeDeg).toBeCloseTo(-90, 6);
  });

  it('竖直举起、屏幕背面朝北 (0,90,0) → az=0°、alt=0°', () => {
    const d = deviceOrientationToLookDirection(0, 90, 0);
    expect(d.azimuthDeg).toBeCloseTo(0, 6);
    expect(d.altitudeDeg).toBeCloseTo(0, 6);
  });

  it('竖直举起、屏幕背面朝东 (270,90,0) → az=90°、alt=0°', () => {
    // α 逆时针（向西）为正：设备从朝北向西转 270° 即背面朝东。
    const d = deviceOrientationToLookDirection(270, 90, 0);
    expect(d.azimuthDeg).toBeCloseTo(90, 6);
    expect(d.altitudeDeg).toBeCloseTo(0, 6);
  });

  it('平放但屏幕朝下 (0,0,180) → 视线指向天顶（alt=+90°）', () => {
    const d = deviceOrientationToLookDirection(0, 0, 180);
    expect(d.altitudeDeg).toBeCloseTo(90, 6);
  });

  it('姿态连续性：β 从 90° 微增，高度角平滑越过 0 向上抬', () => {
    // 竖直（alt=0）再往后仰一点点（β>90°）→ 视线抬高。
    const base = deviceOrientationToLookDirection(0, 90, 0);
    const tilted = deviceOrientationToLookDirection(0, 91, 0);
    expect(tilted.altitudeDeg).toBeGreaterThan(base.altitudeDeg);
    expect(tilted.altitudeDeg).toBeCloseTo(1, 3);
    expect(tilted.azimuthDeg).toBeCloseTo(0, 3);
  });

  it('方位连续性：α 微转，方位角随之等量反向变化', () => {
    // α 向西转 10°（α=10）→ 背面方位从北向西偏 10° → az=350°。
    const d = deviceOrientationToLookDirection(10, 90, 0);
    expect(d.azimuthDeg).toBeCloseTo(350, 6);
    expect(d.altitudeDeg).toBeCloseTo(0, 6);
  });
});
