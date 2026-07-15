/**
 * 统一拾取注册表（模块级单例，非 React 状态）。
 *
 * 把「点击可选中的一切」收敛到一张表：核心恒星 + 深空天体 + 行星日月。
 * CameraRig 点击时遍历本表做屏幕投影距离拾取（≈9500 条 × 一次 project，
 * 仅事件时刻执行，<2ms）；TargetHighlight / 镜头飞行用 resolveObjectPosition
 * 统一解析任意 uid 的世界坐标。
 *
 * 扩展星场（mag 6.5–7.5，1.7 万点）刻意【不进表】：无名称、无 uid、
 * 不可命名，点中也无信息卡可展示；且会把点击延迟翻倍、大幅提高误触率。
 *
 * 行星条目的 vec 与 ephemRegistry 的 EphemBodyState.vec 是【同一 Vector3 引用】，
 * 重算星历时原地 mutate，本表零重建——点击时刻读到的一定是当前 observeTime 的坐标。
 */

import { raDecToVector3 } from '@star/astro-core';
import { CELESTIAL_CATALOG, DEEP_SKY_CATALOG } from '@star/astro-data';
import * as THREE from 'three';
import { ephem, type EphemBodyState } from './ephemRegistry';
import { SPHERE_RADIUS } from './universe';

export type PickKind =
  | 'planet'
  | 'satellite'
  | 'minor'
  | 'dso-featured'
  | 'dso'
  | 'star-bright'
  | 'star';

export interface PickEntry {
  uid: string;
  kind: PickKind;
  /** 世界坐标；行星条目会被 ephemRegistry 原地 mutate。 */
  vec: THREE.Vector3;
  /** 命中半径（屏幕像素）。 */
  radiusPx: number;
  /** 同屏竞争时的优先级减免（score = 像素距离 - bias，越小越优先）。 */
  bias: number;
}

/** 各类目标的命中半径与优先级（渲染设计 §2.3）。 */
const PICK_SPEC: Record<PickKind, { radiusPx: number; bias: number }> = {
  planet: { radiusPx: 26, bias: 14 },
  satellite: { radiusPx: 22, bias: 12 },
  minor: { radiusPx: 18, bias: 8 },
  'dso-featured': { radiusPx: 22, bias: 10 },
  dso: { radiusPx: 16, bias: 6 },
  'star-bright': { radiusPx: 14, bias: 3 },
  star: { radiusPx: 12, bias: 0 },
};

export const pickEntries: PickEntry[] = [];
const entryByUid = new Map<string, PickEntry>();

let built = false;

/** 构建静态条目（恒星 + DSO）+ 行星条目（vec 共享 ephemRegistry 引用）。幂等。 */
export function ensureStaticEntries(): void {
  if (built) return;
  built = true;

  const push = (uid: string, kind: PickKind, vec: THREE.Vector3): void => {
    const spec = PICK_SPEC[kind];
    const entry: PickEntry = { uid, kind, vec, radiusPx: spec.radiusPx, bias: spec.bias };
    pickEntries.push(entry);
    entryByUid.set(uid, entry);
  };

  // 核心恒星（星历元数据行防御性跳过；CELESTIAL_CATALOG 目前为纯恒星）
  for (const obj of CELESTIAL_CATALOG) {
    if (obj.type !== 'star' || obj.isEphemeris) continue;
    const v = raDecToVector3({ raDeg: obj.raDeg, decDeg: obj.decDeg }, SPHERE_RADIUS);
    push(
      obj.objectUid,
      obj.magnitude < 3.5 ? 'star-bright' : 'star',
      new THREE.Vector3(v.x, v.y, v.z),
    );
  }

  // 深空天体（Messier 全著名，命中优先级高于亮星）
  for (const obj of DEEP_SKY_CATALOG) {
    const v = raDecToVector3({ raDeg: obj.raDeg, decDeg: obj.decDeg }, SPHERE_RADIUS);
    push(obj.objectUid, obj.isFeatured ? 'dso-featured' : 'dso', new THREE.Vector3(v.x, v.y, v.z));
  }

  // 行星日月：vec 直接复用 ephemRegistry 的同一 Vector3 引用（原地 mutate，零重建）
  for (const body of ephem.bodies.values()) {
    push(body.uid, 'planet', body.vec);
  }
}

// ── 行星放大后拾取半径同步（Phase 10 §4.5，「视觉炫酷」域） ──
// 与 PlanetsLayer.diskWorldSize 同式，避免跨组件 import；放大后点击热区随盘面
// 扩大（木星可点区 ~28px 半径，暗行星保底 26），关闭放大回落原值。
const MIN_PLANET_PX = 24;
const PLANET_GAIN = 2.0;
const PLANET_CAP = 46;

function planetWorldSize(body: EphemBodyState, magnify: boolean): number {
  if (body.kind === 'sun') return 90;
  if (body.kind === 'moon') return 64;
  const raw = body.displaySize * 1.3;
  if (!magnify) return raw;
  return THREE.MathUtils.clamp(body.displaySize * PLANET_GAIN, MIN_PLANET_PX, PLANET_CAP);
}

/**
 * 行星拾取半径重算（PlanetsLayer 在 useEffect([planetsEnlarged]) 首挂载 + 开关
 * 切换时调用）。radiusPx = 渲染盘半径 + 8 余量，钳制 26–40。sun/moon 亦按同式
 * （world 90/64 → 上限 40）。幂等，零重建（原地改 radiusPx）。
 */
export function updatePlanetPickRadii(magnify: boolean): void {
  ensureStaticEntries();
  for (const body of ephem.bodies.values()) {
    const entry = entryByUid.get(body.uid);
    if (!entry || entry.kind !== 'planet') continue;
    entry.radiusPx = THREE.MathUtils.clamp(planetWorldSize(body, magnify) / 2 + 8, 26, 40);
  }
}

/**
 * 动态条目注册（卫星/小天体层 mount 时调用）：与行星同款「共享 Vector3 引用、
 * 原地 mutate」纪律——层内每帧更新 vec，拾取/高亮/飞行自动跟随快速移动目标。
 * 幂等：uid 已存在则只更新 vec 引用（层重挂载时替换为新 buffer 的引用）。
 */
export function registerDynamicEntry(uid: string, kind: PickKind, vec: THREE.Vector3): void {
  const existing = entryByUid.get(uid);
  if (existing) {
    existing.vec = vec;
    existing.kind = kind;
    return;
  }
  const spec = PICK_SPEC[kind];
  const entry: PickEntry = { uid, kind, vec, radiusPx: spec.radiusPx, bias: spec.bias };
  pickEntries.push(entry);
  entryByUid.set(uid, entry);
}

/** 注销动态条目（层 unmount 时调用）；静态条目请勿注销。 */
export function unregisterEntry(uid: string): void {
  const entry = entryByUid.get(uid);
  if (!entry) return;
  entryByUid.delete(uid);
  const idx = pickEntries.indexOf(entry);
  if (idx >= 0) pickEntries.splice(idx, 1);
}

/** 按 uid 取拾取条目（含 kind，可用于高亮环尺寸分档）。 */
export function getPickEntry(uid: string): PickEntry | undefined {
  ensureStaticEntries();
  return entryByUid.get(uid);
}

/**
 * 统一解析任意天体的世界坐标：星/DSO 查静态条目，行星返回星历实时坐标
 * （同一引用，随 observeTime 更新）。未知 uid 返回 null。
 */
export function resolveObjectPosition(uid: string): THREE.Vector3 | null {
  return getPickEntry(uid)?.vec ?? null;
}
