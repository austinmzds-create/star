'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { raDecToVector3 } from '@star/astro-core';
import { DEEP_SKY_CATALOG, type CelestialObject } from '@star/astro-data';
import type { DeviceTier } from '@/lib/deviceTier';
import { SPHERE_RADIUS, type StarAttributes } from '@/lib/universe';
import { TwinkleStars } from './TwinkleStars';

/**
 * 星团星屑层（宇宙 V4 §3）：把 `type==='cluster' && angularSizeDeg` 的 DSO
 * 全部拼进**一个** Points（复用 TwinkleStars shader）——星团从「一颗光斑」
 * 变成肉眼可辨的一小撮星屑。中心柔光仍由 DeepSkyLayer 的 cluster sprite
 * 承担（那边已按角尺寸放大 featured 星团），二者叠加不新增纹理。
 *
 * draw call 账本：+1（高低端同为一个 Points；低端仅 featured 且数量减半，
 * 约 1600 点；高端约 6000 点，均在帧预算内）。
 *
 * 【拾取取舍：星屑完全不进 pickRegistry。】它们是程序化装饰点、无真实
 * 坐标语义；星团本体的点击仍落在 DeepSkyLayer 对应的 featured DSO 上。
 *
 * 【深时模式（9B 星座时光机）】复用 TwinkleStars shader 自动继承 aPm 通道，
 * 本层不提供 pms → 零填充：星屑在 ±10 万年拨盘下保持原位。演示级取舍——
 * 真实星团成员共享空间运动（如昴星团 ≈50 mas/yr），但星屑本就是程序化
 * 装饰且 DeepSkyLayer 的星团柔光 sprite 同样不动，二者一致即无撕裂感。
 *
 * 分布模型（useMemo 一次性构建，种子 = FNV-1a(objectUid)，会话间稳定）：
 *  - 球状星团（descriptionZh 含「球状」，Messier 全覆盖，其余按疏散处理）：
 *    半径按 u^2.2 分布——r^-2 式向心，边缘骤稀；成员整体偏老、色暖金。
 *  - 疏散星团：sqrt(u) 均匀盘 + 微团块扰动；基色年轻冷蓝，15% 概率暖星。
 *  - 显示半径 = 角尺寸一半，夹在 0.29°–1.7°（太小看不出「一撮」，太大
 *    会和邻近星团粘连）。
 */

/** 度 → 弧度（本文件只在构建期用，不引 astro-core 的常量以免额外依赖面）。 */
const DEG2RAD = Math.PI / 180;

/**
 * 著名星团的星屑数量手册：亮而大的给足数量（M45 昴星团 90 颗），
 * 其余 featured 34、普通 14——数量差即视觉等级差。
 */
const FAMOUS: Record<string, number> = {
  M45: 90,
  M44: 72,
  M13: 84,
  M22: 64,
  NGC869: 60,
  NGC884: 60,
  M7: 56,
  M6: 48,
  M35: 40,
  M37: 40,
  M41: 40,
  M46: 40,
};

/** FNV-1a 字符串散列：objectUid → 32 位种子（会话间稳定，无需持久化）。 */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32：小而好的确定性 PRNG，每个星团一个独立流。 */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 参与撒屑的星团 + 各自数量（低端：仅 featured 且数量减半）。 */
function pickClusters(tier: DeviceTier): Array<{ obj: CelestialObject; n: number }> {
  const out: Array<{ obj: CelestialObject; n: number }> = [];
  for (const obj of DEEP_SKY_CATALOG) {
    if (obj.type !== 'cluster' || obj.angularSizeDeg === undefined) continue;
    if (tier === 'low' && !obj.isFeatured) continue;
    const base = FAMOUS[obj.objectUid] ?? (obj.isFeatured ? 34 : 14);
    out.push({ obj, n: tier === 'low' ? Math.max(4, Math.round(base * 0.5)) : base });
  }
  return out;
}

/** 一次性构建全部星屑属性（≈6000 点 <3ms，发生在 useMemo，非帧循环）。 */
function buildSprinkleAttributes(tier: DeviceTier): StarAttributes {
  const clusters = pickClusters(tier);
  const count = clusters.reduce((sum, c) => sum + c.n, 0);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);

  const center = new THREE.Vector3();
  const t1 = new THREE.Vector3();
  const t2 = new THREE.Vector3();
  const up = new THREE.Vector3();
  const p = new THREE.Vector3();

  let w = 0;
  for (const { obj, n } of clusters) {
    const rand = mulberry32(fnv1a(obj.objectUid));
    // 球状判定走中文简介关键词：Messier 球状全覆盖，其余缺描述的按疏散处理
    const isGlobular = obj.descriptionZh?.includes('球状') ?? false;
    const isFamous = obj.objectUid in FAMOUS;
    // 显示半径（弧度）：0.29°–1.7°
    const rRad = THREE.MathUtils.clamp(((obj.angularSizeDeg ?? 0) / 2) * DEG2RAD, 0.005, 0.03);

    const c = raDecToVector3({ raDeg: obj.raDeg, decDeg: obj.decDeg }, 1);
    center.set(c.x, c.y, c.z);
    // 切平面正交基：center 接近极轴时换参考向量，避免叉积退化
    up.set(0, 1, 0);
    if (Math.abs(center.y) > 0.9) up.set(1, 0, 0);
    t1.crossVectors(up, center).normalize();
    t2.crossVectors(center, t1).normalize();

    for (let i = 0; i < n; i++) {
      const u = rand();
      const phi = rand() * Math.PI * 2;
      // 球状：u^2.2 向心聚集；疏散：sqrt(u) 均匀盘 × 随机收缩造微团块
      const rr = isGlobular ? rRad * Math.pow(u, 2.2) : rRad * Math.sqrt(u) * (0.6 + 0.4 * rand());
      p.copy(center)
        .addScaledVector(t1, rr * Math.cos(phi))
        .addScaledVector(t2, rr * Math.sin(phi))
        .normalize()
        // 略沉于恒星层（1000）：星屑不遮真实亮星
        .multiplyScalar(SPHERE_RADIUS * 0.988);

      positions[w * 3] = p.x;
      positions[w * 3 + 1] = p.y;
      positions[w * 3 + 2] = p.z;

      // 疏散（年轻）冷蓝为主 + 15% 暖星；球状（年老）整体暖金
      let cr: number;
      let cg: number;
      let cb: number;
      if (isGlobular) {
        cr = 1.0;
        cg = 0.92;
        cb = 0.72;
      } else if (rand() < 0.15) {
        cr = 1.0;
        cg = 0.85;
        cb = 0.62;
      } else {
        cr = 0.8;
        cg = 0.87;
        cb = 1.0;
      }
      // 径向衰减：外围星屑更暗，撮状轮廓由亮度而非硬边界给出
      const dim = 1.0 - 0.45 * (rr / rRad);
      colors[w * 3] = cr * dim;
      colors[w * 3 + 1] = cg * dim;
      colors[w * 3 + 2] = cb * dim;

      let size = 1.3 + rand() * 1.8;
      if (isFamous) size = Math.min(size * 1.25, 3.8);
      sizes[w] = size;
      // 相位独立随机：与主星场闪烁错开，避免整撮同步呼吸
      phases[w] = rand() * Math.PI * 2;
      w++;
    }
  }

  return { positions, colors, sizes, phases, count };
}

/** 星团星屑层：单 Points、复用 TwinkleStars shader，不参与拾取。 */
export function ClusterSprinkleLayer({ tier }: { tier: DeviceTier }) {
  const attributes = useMemo(() => buildSprinkleAttributes(tier), [tier]);
  if (attributes.count === 0) return null;
  return <TwinkleStars attributes={attributes} twinkle={0.5} sizeScale={1} renderOrder={1} />;
}
