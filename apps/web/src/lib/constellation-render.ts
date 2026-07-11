/**
 * 星座连线渲染数据（Star Walk 式依次点亮动画的几何基础）。
 *
 * 数据源：@star/astro-data 的 CONSTELLATION_LINES（d3-celestial 连线，端点已是
 * objectUid，直接 CATALOG_BY_UID 查坐标，零转换）。全 88 座合并为一个
 * BufferGeometry（LineSegments 语义），一次 draw call；「依次点亮」的时序在
 * 构建期折进每顶点属性 aT0/aT1，运行期 shader 只做一个 smoothstep。
 */

import { raDecToVector3 } from '@star/astro-core';
import { CATALOG_BY_UID, CONSTELLATION_ABBR, CONSTELLATION_LINES } from '@star/astro-data';
import * as THREE from 'three';
import { SPHERE_RADIUS } from './universe';

// ── 动画时序参数（默认值总表，见 docs/architecture.md 星座一节） ──

/** 单段点亮时长（秒）。 */
export const SEGMENT_RISE_SEC = 0.6;
/** 相邻线段的点亮延迟（秒）——「依次亮起」的节奏。 */
export const SEGMENT_STAGGER_SEC = 0.08;
/** 失活整体淡出时长（秒，不倒放逐段）。 */
export const FADE_OUT_SEC = 0.4;
/** reduced-motion 下统一的点亮/淡出时长（秒）。 */
export const REDUCED_MOTION_DUR_SEC = 0.2;
/** 开关开、未激活时连线的基础淡显透明度。 */
export const LINE_BASE_ALPHA = 0.08;
/** 连线所在球面半径：紧贴恒星层内侧（depthWrite=false，仅语义分层）。 */
export const LINE_RADIUS = SPHERE_RADIUS * 0.996;
/** 名称 Sprite 所在半径。 */
export const NAME_RADIUS = SPHERE_RADIUS * 0.93;
/** 艺术图切平面所在半径（恒星层与连线之间偏下）。 */
export const ART_RADIUS = SPHERE_RADIUS * 0.99;

/** 注视激活阈值（度）：大座不必看到质心才亮，小座不误触。 */
export function activateThresholdDeg(radiusDeg: number): number {
  return THREE.MathUtils.clamp(radiusDeg * 0.6, 8, 20);
}
/** 滞回：已激活座的失活阈值 = 激活阈值 + 3°，防边界抖动。 */
export const GAZE_HYSTERESIS_DEG = 3;

/** 单个星座的渲染期信息。 */
export interface ConstellationRenderInfo {
  /** IAU 3 字母缩写，如 'Ori'。 */
  abbr: string;
  /** 在 uProgress 数组中的下标（0..consCount-1）。 */
  index: number;
  /** 中文名 / 拉丁名（来自 CONSTELLATION_ABBR）。 */
  nameZh: string;
  nameEn: string;
  /** 质心方向（单位向量；端点单位向量求和归一化，天然规避 RA 跨 0°/360°）。 */
  centroid: THREE.Vector3;
  /** 外接角半径（度）：质心到最远端点的角距。 */
  radiusDeg: number;
  /** 有效线段数。 */
  segCount: number;
  /** 依次点亮总时长（秒）：SEGMENT_RISE + STAGGER×(n−1)。 */
  riseDurSec: number;
}

/** 全 88 座合并后的渲染数据（一次 useMemo 构建，<2ms）。 */
export interface ConstellationRenderData {
  /** 顶点坐标：段数×2×3（LineSegments）。 */
  positions: Float32Array;
  /** 每顶点：星座索引。 */
  aCon: Float32Array;
  /** 每顶点：本段点亮起点/终点（座内归一化进度）。 */
  aT0: Float32Array;
  aT1: Float32Array;
  /** 每顶点：呼吸相位（段索引 × 黄金角）。 */
  aPhase: Float32Array;
  vertexCount: number;
  cons: ConstellationRenderInfo[];
  byAbbr: Map<string, ConstellationRenderInfo>;
}

/** 由星座连线表 + 星表坐标构建合并几何数据（纯函数，可单测）。 */
export function buildConstellationRenderData(): ConstellationRenderData {
  // 第一遍：解析每座的有效线段端点坐标（缺 uid 的段防御性丢弃）。
  interface ResolvedCon {
    abbr: string;
    segs: [THREE.Vector3, THREE.Vector3][]; // 单位向量
  }
  const resolved: ResolvedCon[] = [];
  let totalSegs = 0;

  for (const con of CONSTELLATION_LINES) {
    const segs: [THREE.Vector3, THREE.Vector3][] = [];
    for (const [ua, ub] of con.segments) {
      const a = CATALOG_BY_UID.get(ua);
      const b = CATALOG_BY_UID.get(ub);
      if (!a || !b) continue; // 生成脚本已保证 100% 可解析，这里仅兜底。
      const va = raDecToVector3({ raDeg: a.raDeg, decDeg: a.decDeg }, 1);
      const vb = raDecToVector3({ raDeg: b.raDeg, decDeg: b.decDeg }, 1);
      segs.push([new THREE.Vector3(va.x, va.y, va.z), new THREE.Vector3(vb.x, vb.y, vb.z)]);
    }
    if (segs.length === 0) continue;
    resolved.push({ abbr: con.con, segs });
    totalSegs += segs.length;
  }

  const vertexCount = totalSegs * 2;
  const positions = new Float32Array(vertexCount * 3);
  const aCon = new Float32Array(vertexCount);
  const aT0 = new Float32Array(vertexCount);
  const aT1 = new Float32Array(vertexCount);
  const aPhase = new Float32Array(vertexCount);
  const cons: ConstellationRenderInfo[] = [];

  let v = 0; // 顶点游标
  let globalSeg = 0;

  resolved.forEach((con, index) => {
    const n = con.segs.length;
    const riseDurSec = SEGMENT_RISE_SEC + SEGMENT_STAGGER_SEC * (n - 1);

    // 质心：全部端点单位向量求和归一化（向量平均，规避 RA 绕圈问题）。
    const centroid = new THREE.Vector3();
    for (const [a, b] of con.segs) centroid.add(a).add(b);
    centroid.normalize();
    // 外接角半径：质心到最远端点的角距。
    let maxAngle = 0;
    for (const [a, b] of con.segs) {
      maxAngle = Math.max(maxAngle, centroid.angleTo(a), centroid.angleTo(b));
    }
    const radiusDeg = THREE.MathUtils.radToDeg(maxAngle);

    con.segs.forEach(([a, b], i) => {
      const t0 = (SEGMENT_STAGGER_SEC * i) / riseDurSec;
      const t1 = (SEGMENT_STAGGER_SEC * i + SEGMENT_RISE_SEC) / riseDurSec;
      const phase = (globalSeg * 2.399963) % (Math.PI * 2); // 黄金角散布
      for (const p of [a, b]) {
        positions[v * 3] = p.x * LINE_RADIUS;
        positions[v * 3 + 1] = p.y * LINE_RADIUS;
        positions[v * 3 + 2] = p.z * LINE_RADIUS;
        aCon[v] = index;
        aT0[v] = t0;
        aT1[v] = t1;
        aPhase[v] = phase;
        v++;
      }
      globalSeg++;
    });

    const meta = CONSTELLATION_ABBR[con.abbr];
    cons.push({
      abbr: con.abbr,
      index,
      nameZh: meta?.zh ?? con.abbr,
      nameEn: meta?.en ?? con.abbr,
      centroid,
      radiusDeg,
      segCount: n,
      riseDurSec,
    });
  });

  return {
    positions,
    aCon,
    aT0,
    aT1,
    aPhase,
    vertexCount,
    cons,
    byAbbr: new Map(cons.map((c) => [c.abbr, c])),
  };
}

// ── 模块级懒单例：CameraRig（飞向星座质心）与 SearchPanel 等 DOM 侧共享 ──

let cached: ConstellationRenderData | null = null;

/** 取全局唯一一份渲染数据（首次调用时构建）。 */
export function getConstellationRenderData(): ConstellationRenderData {
  if (!cached) cached = buildConstellationRenderData();
  return cached;
}
