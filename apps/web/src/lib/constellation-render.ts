/**
 * 星座连线渲染数据（Star Walk 式依次点亮动画的几何基础）。
 *
 * 数据源：@star/astro-data 的 CONSTELLATION_LINES（d3-celestial 连线，端点已是
 * objectUid，直接 CATALOG_BY_UID 查坐标，零转换）。全 88 座合并为一个
 * BufferGeometry（LineSegments 语义），一次 draw call；「依次点亮」的时序在
 * 构建期折进每顶点属性 aT0/aT1，运行期 shader 只做一个 smoothstep。
 */

import { raDecToVector3 } from '@star/astro-core';
import {
  CATALOG_BY_UID,
  CONSTELLATION_ABBR,
  CONSTELLATION_LINES,
  type CelestialObject,
} from '@star/astro-data';
import * as THREE from 'three';
import { MAS_YR_TO_RAD_YR, magnitudeToSize, SPHERE_RADIUS } from './universe';

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
  /** 成员星位置（连线端点按 uid 去重 × LINE_RADIUS），供激活时的强调闪烁光环。 */
  memberPositions: Float32Array;
  /** 成员星光环像素尺寸（≈恒星点尺寸 ×2.6，随亮度分级）。 */
  memberSizes: Float32Array;
  /** 成员星闪烁相位（黄金角散布，避免整座同步呼吸）。 */
  memberPhases: Float32Array;
  /** 成员星数量。 */
  memberCount: number;
  /** 成员星 J2000 基准单位方向（深时重算的不变基，memberCount×3）。 */
  memberBaseDir: Float32Array;
  /** 成员星自行切向速度向量（rad/yr，缺测为零向量，memberCount×3）。 */
  memberPmVec: Float32Array;
  /** 成员星 objectUid（9C：extras 加载后按 uid 刷新 pmVec 用）。 */
  memberUids: string[];
  /** 成员星亮度排名（0=最亮 α 星…；心跳/ping 分级用，memberCount）。 */
  memberRanks: Float32Array;
  /**
   * 艺术图自动对齐（Phase 10 §2.2）：由连线端点包围盒在质心切平面内导出，
   * 供无手调 meta 的座作画锚定回退（已校准 20 座仍优先用 CONSTELLATION_ART）。
   */
  artAnchor: THREE.Vector3;
  artSizeDeg: number;
  artRollDeg: number;
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
  /** 每顶点：沿段归一化坐标（起点 0 / 终点 1）；片元内插值后驱动逐段「描线」与流光。 */
  aEnd: Float32Array;
  /** 每顶点 J2000 基准单位方向（深时重算的不变基，vertexCount×3）。 */
  baseDir: Float32Array;
  /** 每顶点自行切向速度向量（rad/yr，与 TwinkleStars shader 同一推导，vertexCount×3）。 */
  pmVec: Float32Array;
  /** 每顶点 objectUid（9C：extras 加载后按 uid 刷新 pmVec 用）。 */
  vertexUids: string[];
  vertexCount: number;
  cons: ConstellationRenderInfo[];
  byAbbr: Map<string, ConstellationRenderInfo>;

  // ── 发光丝带几何（Phase 10 §1：high/mid tier；每段 6 顶点非索引，2 三角） ──
  /** 段数（= vertexCount/2）。ribbon 顶点数 = segCount×6。 */
  segCount: number;
  /** ribbon 本顶点端点世界坐标（×LINE_RADIUS，深时原地覆写；rCount×3）。 */
  ribbonPos: Float32Array;
  /** ribbon 同段另一端点世界坐标（算屏幕方向用；rCount×3）。 */
  ribbonOther: Float32Array;
  /** ribbon 顶点：−1/+1 丝带上下沿（rCount）。 */
  ribbonSide: Float32Array;
  /** ribbon 顶点：本段基础像素半宽（按较亮端分级；rCount）。 */
  ribbonWidth: Float32Array;
  /** ribbon 顶点：星座索引（rCount）。 */
  ribbonCon: Float32Array;
  /** ribbon 顶点：本段点亮起点/终点（座内归一化，rCount）。 */
  ribbonT0: Float32Array;
  ribbonT1: Float32Array;
  /** ribbon 顶点：呼吸/流光相位（rCount）。 */
  ribbonPhase: Float32Array;
  /** ribbon 顶点：沿段坐标（本端点是段起 0 / 段终 1，rCount）。 */
  ribbonEnd: Float32Array;
  /** ribbon 深时不变基（本端点单位方向 + 自行速度；rCount×3）。 */
  ribbonBaseThis: Float32Array;
  ribbonPmThis: Float32Array;
  /** ribbon 深时不变基（另一端点单位方向 + 自行速度；rCount×3）。 */
  ribbonBaseOther: Float32Array;
  ribbonPmOther: Float32Array;
}

/**
 * ribbon 每段 6 顶点模板：[本端点(0=A/1=B), 丝带侧(−1/+1)]。
 * 两三角覆盖四边形：A₋ A₊ B₋ / B₋ A₊ B₊（本端点决定 aEnd/深时基）。
 */
const RIBBON_ROWS: readonly [number, number][] = [
  [0, -1],
  [0, 1],
  [1, -1],
  [1, -1],
  [0, 1],
  [1, 1],
];

/**
 * 恒星自行切向速度向量（rad/yr）：east/north 切向量与 TwinkleStars 顶点 shader
 * 逐行同式（y=北天极约定），保证深时模式下连线端点与星点像素级贴合。
 * 缺测（无 pmRaMasYr）→ 零向量（该端点不动）。构建期一次性调用，允许分配。
 */
function pmTangentVec(obj: CelestialObject, pn: THREE.Vector3): THREE.Vector3 {
  const out = new THREE.Vector3();
  if (obj.pmRaMasYr === undefined || obj.pmDecMasYr === undefined) return out;
  const east = new THREE.Vector3(0, 1, 0).cross(pn);
  east.divideScalar(Math.max(east.length(), 1e-6)); // 极点退化保护（与 shader 同式）
  const north = pn.clone().cross(east);
  return out
    .addScaledVector(east, obj.pmRaMasYr * MAS_YR_TO_RAD_YR)
    .addScaledVector(north, obj.pmDecMasYr * MAS_YR_TO_RAD_YR);
}

/** 由星座连线表 + 星表坐标构建合并几何数据（纯函数，可单测）。 */
export function buildConstellationRenderData(): ConstellationRenderData {
  // 第一遍：解析每座的有效线段端点坐标（缺 uid 的段防御性丢弃）。
  interface ResolvedCon {
    abbr: string;
    segs: [THREE.Vector3, THREE.Vector3][]; // 单位向量
    /** 各段两端点的自行切向速度（rad/yr，与 segs 同序，深时重算用）。 */
    segPms: [THREE.Vector3, THREE.Vector3][];
    /** 各段两端点 uid（与 segs 同序；9C extras 到达后刷新 pm 用）。 */
    segUids: [string, string][];
    /** 各段两端点星等（与 segs 同序；ribbon 按较亮端定粗细用）。 */
    segMags: [number, number][];
    /** 端点按 uid 去重后的成员星（单位向量 + 光环像素尺寸 + 自行速度 + uid）。 */
    members: { vec: THREE.Vector3; sizePx: number; pm: THREE.Vector3; uid: string }[];
  }
  const resolved: ResolvedCon[] = [];
  let totalSegs = 0;

  for (const con of CONSTELLATION_LINES) {
    const segs: [THREE.Vector3, THREE.Vector3][] = [];
    const segPms: [THREE.Vector3, THREE.Vector3][] = [];
    const segUids: [string, string][] = [];
    const segMags: [number, number][] = [];
    const members: { vec: THREE.Vector3; sizePx: number; pm: THREE.Vector3; uid: string }[] = [];
    const seen = new Set<string>();
    for (const [ua, ub] of con.segments) {
      const a = CATALOG_BY_UID.get(ua);
      const b = CATALOG_BY_UID.get(ub);
      if (!a || !b) continue; // 生成脚本已保证 100% 可解析，这里仅兜底。
      const va = raDecToVector3({ raDeg: a.raDeg, decDeg: a.decDeg }, 1);
      const vb = raDecToVector3({ raDeg: b.raDeg, decDeg: b.decDeg }, 1);
      const pa = new THREE.Vector3(va.x, va.y, va.z);
      const pb = new THREE.Vector3(vb.x, vb.y, vb.z);
      const pmA = pmTangentVec(a, pa);
      const pmB = pmTangentVec(b, pb);
      segs.push([pa, pb]);
      segPms.push([pmA, pmB]);
      segUids.push([ua, ub]);
      segMags.push([a.magnitude, b.magnitude]);
      // 成员星去重：光环尺寸 ≈ 恒星点尺寸 ×2.6（强调而不吞没本体）。
      if (!seen.has(ua)) {
        seen.add(ua);
        members.push({
          vec: pa,
          sizePx: THREE.MathUtils.clamp(magnitudeToSize(a.magnitude) * 2.6, 14, 52),
          pm: pmA,
          uid: ua,
        });
      }
      if (!seen.has(ub)) {
        seen.add(ub);
        members.push({
          vec: pb,
          sizePx: THREE.MathUtils.clamp(magnitudeToSize(b.magnitude) * 2.6, 14, 52),
          pm: pmB,
          uid: ub,
        });
      }
    }
    if (segs.length === 0) continue;
    resolved.push({ abbr: con.con, segs, segPms, segUids, segMags, members });
    totalSegs += segs.length;
  }

  const vertexCount = totalSegs * 2;
  const positions = new Float32Array(vertexCount * 3);
  const aCon = new Float32Array(vertexCount);
  const aT0 = new Float32Array(vertexCount);
  const aT1 = new Float32Array(vertexCount);
  const aPhase = new Float32Array(vertexCount);
  const aEnd = new Float32Array(vertexCount);
  const baseDir = new Float32Array(vertexCount * 3);
  const pmVec = new Float32Array(vertexCount * 3);
  const vertexUids: string[] = new Array<string>(vertexCount);
  const cons: ConstellationRenderInfo[] = [];

  // 发光丝带（§1）：每段 6 顶点（非索引）。全 88 座合并仍一次 draw。
  const segCount = totalSegs;
  const rCount = segCount * 6;
  const ribbonPos = new Float32Array(rCount * 3);
  const ribbonOther = new Float32Array(rCount * 3);
  const ribbonSide = new Float32Array(rCount);
  const ribbonWidth = new Float32Array(rCount);
  const ribbonCon = new Float32Array(rCount);
  const ribbonT0 = new Float32Array(rCount);
  const ribbonT1 = new Float32Array(rCount);
  const ribbonPhase = new Float32Array(rCount);
  const ribbonEnd = new Float32Array(rCount);
  const ribbonBaseThis = new Float32Array(rCount * 3);
  const ribbonPmThis = new Float32Array(rCount * 3);
  const ribbonBaseOther = new Float32Array(rCount * 3);
  const ribbonPmOther = new Float32Array(rCount * 3);

  let v = 0; // 顶点游标（base 2/seg）
  let rv = 0; // ribbon 顶点游标（6/seg）
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

    // §1.4 描线节奏：起始时刻按 easeOut 分布（主干先勾、末梢渐次「先快后缓」）。
    const spreadSec = riseDurSec - SEGMENT_RISE_SEC; // = STAGGER×(n−1)
    const denom = Math.max(n - 1, 1);
    con.segs.forEach(([a, b], i) => {
      const xf = i / denom;
      const startSec = (1 - (1 - xf) * (1 - xf)) * spreadSec; // ease(x)=1−(1−x)²
      const t0 = startSec / riseDurSec;
      const t1 = (startSec + SEGMENT_RISE_SEC) / riseDurSec;
      const phase = (globalSeg * 2.399963) % (Math.PI * 2); // 黄金角散布
      const pms = con.segPms[i]!;
      const uids = con.segUids[i]!;
      const mags = con.segMags[i]!;
      [a, b].forEach((p, end) => {
        vertexUids[v] = uids[end]!;
        positions[v * 3] = p.x * LINE_RADIUS;
        positions[v * 3 + 1] = p.y * LINE_RADIUS;
        positions[v * 3 + 2] = p.z * LINE_RADIUS;
        // 深时不变基：单位方向 + 自行速度（positions 会被 applyConstellationDeepTime 原地覆写）
        baseDir[v * 3] = p.x;
        baseDir[v * 3 + 1] = p.y;
        baseDir[v * 3 + 2] = p.z;
        const pm = pms[end]!;
        pmVec[v * 3] = pm.x;
        pmVec[v * 3 + 1] = pm.y;
        pmVec[v * 3 + 2] = pm.z;
        aCon[v] = index;
        aT0[v] = t0;
        aT1[v] = t1;
        aPhase[v] = phase;
        aEnd[v] = end; // 0=段起点 1=段终点，片元插值 → 沿段坐标
        v++;
      });

      // ── ribbon 6 顶点（§1.1）：本段基础半宽按较亮端 magnitudeToSize 分级 ──
      const width = THREE.MathUtils.clamp(
        1.6 + (6.5 - Math.min(mags[0], mags[1])) * 0.32,
        1.6,
        4.2,
      );
      const ends: [THREE.Vector3, THREE.Vector3] = [a, b];
      const endPms: [THREE.Vector3, THREE.Vector3] = [pms[0], pms[1]];
      for (const [thisEnd, side] of RIBBON_ROWS) {
        const otherEnd = 1 - thisEnd;
        const pt = ends[thisEnd]!;
        const po = ends[otherEnd]!;
        const pmT = endPms[thisEnd]!;
        const pmO = endPms[otherEnd]!;
        ribbonPos[rv * 3] = pt.x * LINE_RADIUS;
        ribbonPos[rv * 3 + 1] = pt.y * LINE_RADIUS;
        ribbonPos[rv * 3 + 2] = pt.z * LINE_RADIUS;
        ribbonOther[rv * 3] = po.x * LINE_RADIUS;
        ribbonOther[rv * 3 + 1] = po.y * LINE_RADIUS;
        ribbonOther[rv * 3 + 2] = po.z * LINE_RADIUS;
        ribbonBaseThis[rv * 3] = pt.x;
        ribbonBaseThis[rv * 3 + 1] = pt.y;
        ribbonBaseThis[rv * 3 + 2] = pt.z;
        ribbonPmThis[rv * 3] = pmT.x;
        ribbonPmThis[rv * 3 + 1] = pmT.y;
        ribbonPmThis[rv * 3 + 2] = pmT.z;
        ribbonBaseOther[rv * 3] = po.x;
        ribbonBaseOther[rv * 3 + 1] = po.y;
        ribbonBaseOther[rv * 3 + 2] = po.z;
        ribbonPmOther[rv * 3] = pmO.x;
        ribbonPmOther[rv * 3 + 1] = pmO.y;
        ribbonPmOther[rv * 3 + 2] = pmO.z;
        ribbonSide[rv] = side;
        ribbonWidth[rv] = width;
        ribbonCon[rv] = index;
        ribbonT0[rv] = t0;
        ribbonT1[rv] = t1;
        ribbonPhase[rv] = phase;
        ribbonEnd[rv] = thisEnd;
        rv++;
      }
      globalSeg++;
    });

    // 成员星强调光环数据（激活时才挂 Points，常态零成本）。
    const memberCount = con.members.length;
    const memberPositions = new Float32Array(memberCount * 3);
    const memberSizes = new Float32Array(memberCount);
    const memberPhases = new Float32Array(memberCount);
    const memberBaseDir = new Float32Array(memberCount * 3);
    const memberPmVec = new Float32Array(memberCount * 3);
    const memberUids: string[] = new Array<string>(memberCount);
    con.members.forEach((m, i) => {
      memberUids[i] = m.uid;
      memberPositions[i * 3] = m.vec.x * LINE_RADIUS;
      memberPositions[i * 3 + 1] = m.vec.y * LINE_RADIUS;
      memberPositions[i * 3 + 2] = m.vec.z * LINE_RADIUS;
      memberBaseDir[i * 3] = m.vec.x;
      memberBaseDir[i * 3 + 1] = m.vec.y;
      memberBaseDir[i * 3 + 2] = m.vec.z;
      memberPmVec[i * 3] = m.pm.x;
      memberPmVec[i * 3 + 1] = m.pm.y;
      memberPmVec[i * 3 + 2] = m.pm.z;
      memberSizes[i] = m.sizePx;
      memberPhases[i] = (i * 2.399963) % (Math.PI * 2);
    });

    // 成员亮度排名（§1.5 心跳/ping 分级）：sizePx 越大越亮 → 降序即 α 星 rank 0。
    const memberRanks = new Float32Array(memberCount);
    const order = Array.from({ length: memberCount }, (_, i) => i).sort(
      (i, j) => (memberSizes[j] ?? 0) - (memberSizes[i] ?? 0),
    );
    order.forEach((mi, rank) => {
      memberRanks[mi] = rank;
    });

    // 艺术图自动对齐（§2.2）：质心切平面内投影成员端点算包围盒 → 锚点/尺寸。
    const up0 =
      Math.abs(centroid.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const uAxis = up0.clone().addScaledVector(centroid, -up0.dot(centroid)).normalize();
    const rAxis = new THREE.Vector3().crossVectors(centroid, uAxis);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const m of con.members) {
      const x = Math.atan2(m.vec.dot(rAxis), m.vec.dot(centroid));
      const y = Math.atan2(m.vec.dot(uAxis), m.vec.dot(centroid));
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const artSizeDeg = THREE.MathUtils.radToDeg(Math.max(maxX - minX, maxY - minY)) * 1.3;
    const artAnchor = centroid
      .clone()
      .addScaledVector(rAxis, Math.tan(cx))
      .addScaledVector(uAxis, Math.tan(cy))
      .normalize();

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
      memberPositions,
      memberSizes,
      memberPhases,
      memberCount,
      memberBaseDir,
      memberPmVec,
      memberUids,
      memberRanks,
      artAnchor,
      artSizeDeg,
      artRollDeg: 0,
    });
  });

  return {
    positions,
    aCon,
    aT0,
    aT1,
    aPhase,
    aEnd,
    baseDir,
    pmVec,
    vertexUids,
    vertexCount,
    cons,
    byAbbr: new Map(cons.map((c) => [c.abbr, c])),
    segCount,
    ribbonPos,
    ribbonOther,
    ribbonSide,
    ribbonWidth,
    ribbonCon,
    ribbonT0,
    ribbonT1,
    ribbonPhase,
    ribbonEnd,
    ribbonBaseThis,
    ribbonPmThis,
    ribbonBaseOther,
    ribbonPmOther,
  };
}

// ── 模块级懒单例：CameraRig（飞向星座质心）与 SearchPanel 等 DOM 侧共享 ──

let cached: ConstellationRenderData | null = null;

/** 取全局唯一一份渲染数据（首次调用时构建）。 */
export function getConstellationRenderData(): ConstellationRenderData {
  if (!cached) cached = buildConstellationRenderData();
  return cached;
}

// ── 深时形变（Phase 9B 星座时光机，r-dyn §3c）────────────────────────────
// 恒星本体的自行位移在 TwinkleStars 顶点 shader 内按 uEpochYr 逐帧完成；
// 连线端点/成员光环是 CPU 侧几何，须用【同一公式】重算才能与星点贴合：
// p' = n̂·cosθ + t̂·sinθ（精确大圆旋转，θ=|pmVec·years|——小角度近似在
// ±10 万年 × 秒级自行下失真达两位数度，见 TwinkleStars shader 注释）。
// 调用方（ConstellationLayer）以 100ms 节流触发；≈2100 顶点一次 <0.5ms。
// 已知取舍（演示级）：质心 centroid 保持 J2000——注视判定/镜头飞行的目标
// 在深时下偏移 ≤ 数度（多数星座形变远小于外接半径），不值得为其重排序。

/** 最近一次应用的深时年数（0 = J2000 原位）。 */
let appliedDeepTimeYears = 0;
/** 形变版本号：每次原地重写 positions 后自增，渲染层据此置 needsUpdate。 */
let deepTimeGeoVersion = 0;

/** 当前形变版本（ConstellationLines / MemberGlow 在 useFrame 内比对）。 */
export function getConstellationDeepTimeVersion(): number {
  return deepTimeGeoVersion;
}

/** 单点大圆位移：base/pm 平铺数组第 i 点 → out 第 i 点（×LINE_RADIUS，零分配）。 */
function displacePoint(
  out: Float32Array,
  base: Float32Array,
  pm: Float32Array,
  i: number,
  years: number,
): void {
  const j = i * 3;
  const tx = pm[j]! * years;
  const ty = pm[j + 1]! * years;
  const tz = pm[j + 2]! * years;
  const theta = Math.max(Math.hypot(tx, ty, tz), 1e-12);
  const c = Math.cos(theta);
  const s = Math.sin(theta) / theta;
  out[j] = (base[j]! * c + tx * s) * LINE_RADIUS;
  out[j + 1] = (base[j + 1]! * c + ty * s) * LINE_RADIUS;
  out[j + 2] = (base[j + 2]! * c + tz * s) * LINE_RADIUS;
}

/**
 * 把全部 88 座连线端点 + 成员光环点位形变到 J2000+years（原地覆写，幂等）。
 * years=0 即复原。同值直接返回；数据未构建（星座层从未挂载）也直接返回——
 * 首次 build 输出的就是 J2000 位，挂载方负责在 effect 里对齐现值。
 */
export function applyConstellationDeepTime(years: number): void {
  if (!cached || years === appliedDeepTimeYears) return;
  appliedDeepTimeYears = years;
  deepTimeGeoVersion++;
  const { positions, baseDir, pmVec, vertexCount, cons } = cached;
  for (let i = 0; i < vertexCount; i++) {
    displacePoint(positions, baseDir, pmVec, i, years);
  }
  // 发光丝带端点：this/other 两路各自形变（与 base 同公式，保证与星点贴合）。
  const { ribbonPos, ribbonBaseThis, ribbonPmThis, ribbonOther, ribbonBaseOther, ribbonPmOther } =
    cached;
  const rCount = cached.segCount * 6;
  for (let i = 0; i < rCount; i++) {
    displacePoint(ribbonPos, ribbonBaseThis, ribbonPmThis, i, years);
    displacePoint(ribbonOther, ribbonBaseOther, ribbonPmOther, i, years);
  }
  for (const con of cons) {
    for (let i = 0; i < con.memberCount; i++) {
      displacePoint(con.memberPositions, con.memberBaseDir, con.memberPmVec, i, years);
    }
  }
}

/**
 * 按目录现值原地刷新全部 pmVec/memberPmVec（Phase 9C）。
 *
 * 9C 主表 lean 化后，目录 pm 由 star-extras 异步回填（applyStarExtrasToCatalog）；
 * 本渲染数据是模块级懒单例，若在回填【之前】已构建（星座层通常先挂载），
 * pmVec 全零 → 深时形变失效。extras 就绪后（useStarExtra.ensureStarExtrasReady）
 * 调用本函数：按构建期留存的 vertexUids/memberUids 重推切向速度（与构建期同一
 * pmTangentVec 公式），若当前正处深时形变则用新 pm 立即重应用。
 * 未构建（星座层从未挂载）直接返回——之后的 build 读的已是回填后的目录。
 */
export function refreshConstellationPmFromCatalog(): void {
  if (!cached) return;
  const { pmVec, baseDir, vertexUids, vertexCount, cons } = cached;
  const pn = new THREE.Vector3();
  for (let i = 0; i < vertexCount; i++) {
    const obj = CATALOG_BY_UID.get(vertexUids[i] ?? '');
    if (!obj) continue;
    pn.set(baseDir[i * 3]!, baseDir[i * 3 + 1]!, baseDir[i * 3 + 2]!);
    const pm = pmTangentVec(obj, pn);
    pmVec[i * 3] = pm.x;
    pmVec[i * 3 + 1] = pm.y;
    pmVec[i * 3 + 2] = pm.z;
  }
  for (const con of cons) {
    for (let i = 0; i < con.memberCount; i++) {
      const obj = CATALOG_BY_UID.get(con.memberUids[i] ?? '');
      if (!obj) continue;
      pn.set(con.memberBaseDir[i * 3]!, con.memberBaseDir[i * 3 + 1]!, con.memberBaseDir[i * 3 + 2]!);
      const pm = pmTangentVec(obj, pn);
      con.memberPmVec[i * 3] = pm.x;
      con.memberPmVec[i * 3 + 1] = pm.y;
      con.memberPmVec[i * 3 + 2] = pm.z;
    }
  }
  // 丝带 pm：从刚刷新的 base pmVec 按确定性布局回填（ribbon 端点即 base 端点，
  // 段 s 的 base 端点索引 = 2s+end；rv=6s+k 的 this/other 端由 RIBBON_ROWS 决定）。
  const { ribbonPmThis, ribbonPmOther, segCount } = cached;
  for (let s = 0; s < segCount; s++) {
    for (let k = 0; k < 6; k++) {
      const thisEnd = RIBBON_ROWS[k]![0];
      const otherEnd = 1 - thisEnd;
      const rvi = (s * 6 + k) * 3;
      const bThis = (s * 2 + thisEnd) * 3;
      const bOther = (s * 2 + otherEnd) * 3;
      ribbonPmThis[rvi] = pmVec[bThis]!;
      ribbonPmThis[rvi + 1] = pmVec[bThis + 1]!;
      ribbonPmThis[rvi + 2] = pmVec[bThis + 2]!;
      ribbonPmOther[rvi] = pmVec[bOther]!;
      ribbonPmOther[rvi + 1] = pmVec[bOther + 1]!;
      ribbonPmOther[rvi + 2] = pmVec[bOther + 2]!;
    }
  }
  // 正处深时形变：用新 pm 立即重应用（重置去重哨兵后复用同一入口，版本号随之自增，
  // 渲染层在 useFrame 里对版本号变化置 needsUpdate）。J2000 原位（0）无需动 positions。
  if (appliedDeepTimeYears !== 0) {
    const years = appliedDeepTimeYears;
    appliedDeepTimeYears = Number.NaN; // 哨兵：绕过 applyConstellationDeepTime 的同值短路
    applyConstellationDeepTime(years);
  }
}

// ── 星座就近点选（CameraRig 在天体拾取未命中后调用） ──

/** 点到连线段的屏幕距离阈值（px）：手指/鼠标点在线附近即命中。 */
export const PICK_LINE_PX = 22;
/** 兜底阈值（px）：无线段命中时按质心投影就近判定（点在星座「腹地」）。 */
export const PICK_CENTROID_PX = 60;

/** 投影 scratch（仅点击时刻使用，无并发）。 */
const pickVec = new THREE.Vector3();

/**
 * 屏幕空间星座就近判定：px/py 为相对画布左上角的像素坐标。
 * 遍历全部 ~700 段连线，两端投影屏幕后算点到线段 2D 距离，≤22px 取最近者；
 * 无命中再试各座质心投影 ≤60px。全部顶点仅点击时刻计算（<1ms），不进帧循环。
 */
export function pickConstellationAt(
  px: number,
  py: number,
  camera: THREE.Camera,
  rect: { width: number; height: number },
  centroidFallback = true,
): string | null {
  const data = getConstellationRenderData();
  const { positions, aCon, cons } = data;
  let bestAbbr: string | null = null;
  let bestD = PICK_LINE_PX;

  const segCount = data.vertexCount / 2;
  for (let s = 0; s < segCount; s++) {
    const i = s * 2;
    // 端点 A / B 投影（v.z>1 = 相机背面，剔除；单端出界的擦边段直接放弃，避免畸变距离）。
    pickVec
      .set(positions[i * 3] ?? 0, positions[i * 3 + 1] ?? 0, positions[i * 3 + 2] ?? 0)
      .project(camera);
    if (pickVec.z > 1) continue;
    const ax = (pickVec.x * 0.5 + 0.5) * rect.width;
    const ay = (-pickVec.y * 0.5 + 0.5) * rect.height;
    pickVec
      .set(positions[i * 3 + 3] ?? 0, positions[i * 3 + 4] ?? 0, positions[i * 3 + 5] ?? 0)
      .project(camera);
    if (pickVec.z > 1) continue;
    const bx = (pickVec.x * 0.5 + 0.5) * rect.width;
    const by = (-pickVec.y * 0.5 + 0.5) * rect.height;

    // 点到线段 2D 距离（垂足夹到端点内）。
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 1e-6 ? THREE.MathUtils.clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1) : 0;
    const d = Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
    if (d <= bestD) {
      bestD = d;
      bestAbbr = cons[Math.round(aCon[i] ?? -1)]?.abbr ?? null;
    }
  }
  if (bestAbbr) return bestAbbr;
  // 悬停变体（Phase 10）：只认真正压在线上（≤22px），不走质心兜底——否则整个
  // 星座腹地都会触发气泡，太吵。
  if (!centroidFallback) return null;

  // 兜底：质心投影就近（覆盖「点在星座图形内部但离线较远」的情形）。
  let bestC = PICK_CENTROID_PX;
  for (const info of cons) {
    pickVec.copy(info.centroid).multiplyScalar(LINE_RADIUS).project(camera);
    if (pickVec.z > 1) continue;
    const sx = (pickVec.x * 0.5 + 0.5) * rect.width;
    const sy = (-pickVec.y * 0.5 + 0.5) * rect.height;
    const d = Math.hypot(sx - px, sy - py);
    if (d <= bestC) {
      bestC = d;
      bestAbbr = info.abbr;
    }
  }
  return bestAbbr;
}

/**
 * 悬停专用星座命中（Phase 10「悬停万物」）：仅测连线段（≤22px），跳过质心兜底
 * ——悬停只认真正压在线上的位置，不给「悬停一片腹地都弹气泡」的困扰。
 */
export function pickConstellationHoverAt(
  px: number,
  py: number,
  camera: THREE.Camera,
  rect: { width: number; height: number },
): string | null {
  return pickConstellationAt(px, py, camera, rect, false);
}
