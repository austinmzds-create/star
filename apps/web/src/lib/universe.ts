import { raDecToVector3 } from '@star/astro-core';
import { CELESTIAL_CATALOG, type CelestialObject } from '@star/astro-data';
import * as THREE from 'three';

/** 天球半径：所有星体统一投影到该半径的球面内壁。 */
export const SPHERE_RADIUS = 1000;

/** 由光谱型推断显示颜色（线性 RGB，0–1）。 */
export function spectralColor(spectralType?: string): [number, number, number] {
  const letter = spectralType?.[0]?.toUpperCase();
  switch (letter) {
    case 'O':
    case 'B':
      return [0.61, 0.7, 1.0];
    case 'A':
      return [0.83, 0.89, 1.0];
    case 'F':
      return [1.0, 0.98, 0.94];
    case 'G':
      return [1.0, 0.95, 0.84];
    case 'K':
      return [1.0, 0.8, 0.56];
    case 'M':
      return [1.0, 0.66, 0.48];
    default:
      return [1.0, 1.0, 1.0];
  }
}

/** 视星等 -> 屏幕像素大小（越亮越大）。 */
export function magnitudeToSize(magnitude: number): number {
  return THREE.MathUtils.clamp(15 - magnitude * 2.3, 4.5, 20);
}

export interface StarAttributes {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  phases: Float32Array;
  count: number;
}

export interface CatalogRenderData extends StarAttributes {
  /** 与 CELESTIAL_CATALOG 同序的世界坐标，用于拾取与镜头飞行。 */
  vectors: THREE.Vector3[];
  objects: CelestialObject[];
}

/** 由精选真实星表构建可渲染属性 + 拾取用坐标。 */
export function buildCatalogRenderData(): CatalogRenderData {
  const objects = CELESTIAL_CATALOG;
  const count = objects.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const vectors: THREE.Vector3[] = [];

  objects.forEach((obj, i) => {
    const v = raDecToVector3({ raDeg: obj.raDeg, decDeg: obj.decDeg }, SPHERE_RADIUS);
    positions[i * 3] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;
    vectors.push(new THREE.Vector3(v.x, v.y, v.z));

    const [r, g, b] = spectralColor(obj.spectralType);
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;

    sizes[i] = magnitudeToSize(obj.magnitude);
    phases[i] = (i * 2.399963) % (Math.PI * 2);
  });

  return { positions, colors, sizes, phases, count, vectors, objects };
}

/** 均匀分布在单位球面上的随机方向。 */
function randomDirection(): THREE.Vector3 {
  const u = Math.random();
  const v = Math.random();
  const theta = 2 * Math.PI * u;
  const phi = Math.acos(2 * v - 1);
  return new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
  );
}

/**
 * 程序化环境星场：大量暗弱背景星 + 一条模拟银河的密集亮带。
 * 只为营造「铺满宇宙」的观感，不含真实数据。
 */
export function generateAmbientField(
  backgroundCount = 16000,
  milkyWayCount = 9000,
): StarAttributes {
  const count = backgroundCount + milkyWayCount;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);

  const r = SPHERE_RADIUS * 0.985;

  // 银河带的倾斜（绕 X 轴倾斜约 60°）
  const tilt = new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(62));

  for (let i = 0; i < count; i++) {
    let dir: THREE.Vector3;
    let tint: [number, number, number];
    let size: number;

    if (i < backgroundCount) {
      // 均匀背景星
      dir = randomDirection();
      const warm = Math.random();
      tint =
        warm > 0.82
          ? [1.0, 0.86, 0.7]
          : warm > 0.5
            ? [0.86, 0.9, 1.0]
            : [0.92, 0.94, 1.0];
      const intensity = 0.5 + Math.random() * 0.5;
      tint = [tint[0] * intensity, tint[1] * intensity, tint[2] * intensity];
      size = 1.1 + Math.random() * Math.random() * 2.8;
    } else {
      // 银河带：沿一个大圆聚集，垂直方向做高斯散布
      const along = Math.random() * Math.PI * 2;
      const spread = (Math.random() + Math.random() + Math.random() - 1.5) * 0.2;
      dir = new THREE.Vector3(
        Math.cos(along) * Math.cos(spread),
        Math.sin(spread),
        Math.sin(along) * Math.cos(spread),
      ).applyMatrix4(tilt);
      const intensity = 0.42 + Math.random() * 0.45;
      tint = [0.98 * intensity, 0.94 * intensity, 0.86 * intensity];
      size = 0.9 + Math.random() * 1.7;
    }

    positions[i * 3] = dir.x * r;
    positions[i * 3 + 1] = dir.y * r;
    positions[i * 3 + 2] = dir.z * r;
    colors[i * 3] = tint[0];
    colors[i * 3 + 1] = tint[1];
    colors[i * 3 + 2] = tint[2];
    sizes[i] = size;
    phases[i] = Math.random() * Math.PI * 2;
  }

  return { positions, colors, sizes, phases, count };
}

/** 供镜头飞行使用：把方向向量转成偏航/俯仰（与 CameraRig 中一致的约定）。 */
export function directionToYawPitch(dir: THREE.Vector3): { yaw: number; pitch: number } {
  const d = dir.clone().normalize();
  const pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
  const yaw = Math.atan2(-d.x, -d.z);
  return { yaw, pitch };
}
