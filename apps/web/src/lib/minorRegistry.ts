/**
 * 小天体状态注册表（模块级单例，镜像 ephemRegistry 模式）。
 *
 * 6 个小天体（谷神/灶神/智神 3 小行星 + 哈雷/恩克/庞斯-布鲁克斯 3 彗星）
 * 的地心 J2000 坐标由 @star/astro-ephem 的
 * minorBodies（JPL 根数 + 开普勒求解）按 observeTime 计算。
 * 状态槽保持独立注册表（不与 ephemRegistry 合表），但重算入口有两个：
 * MinorBodiesLayer（懒加载）订阅 observeTime 驱动 + EphemDriver 实时模式
 * 30s 心跳直驱——astro-ephem 小天体代码已被 StarInfoCard 静态引入主包，
 * EphemDriver 引 recomputeMinorBodies 增量≈1KB，不再有包体顾虑。
 *
 * 每个天体的 vec 是【固定引用、原地 mutate】的 THREE.Vector3：
 * pickRegistry 动态条目直接持同一引用，重算时拾取表零重建。
 */

import { raDecToVector3 } from '@star/astro-core';
import {
  getMinorBodyEquatorial,
  listMinorBodies,
  registerCometPhotometry,
  registerMinorBodyMeta,
  registerMinorBodyOrbit,
  type MinorBodyId,
  type MinorBodyMeta,
} from '@star/astro-ephem';
import * as THREE from 'three';
import { fetchMinorBodiesFeed, type MinorBodyFeedEntry } from './api';
import { appendDynamicMinorRows } from './solarSystem';
import { SPHERE_RADIUS } from './universe';

/** 单个小天体的当前状态（坐标为最近一次 recomputeMinorBodies 时刻的值）。 */
export interface MinorBodyState {
  uid: string;
  id: MinorBodyId;
  kind: 'asteroid' | 'comet';
  nameZh: string;
  colorHex: string;
  raDeg: number;
  decDeg: number;
  /** 地心距离（AU）。 */
  distanceAu: number;
  /** 日心距离（AU）。 */
  helioDistanceAu: number;
  /**
   * 彗尾当前是否可见（Phase 9B）：仅彗星有意义，由 CometTailLayer 按
   * observeTime 量化键写入（视角长与亮度双阈值判定，演示级）。
   * 注意（集成验证修订）：StarInfoCard 的「彗尾可见 · 演示级」徽章不读
   * 本字段——旗标由懒 chunk 在挂载后写入，而卡片只随 store 变化重渲染，
   * 深链/暂停态下会读到写入前的旧值；徽章改用同一纯函数
   * （computeCometTailGeometry，同 1h 量化键）同步推导。本字段保留给
   * 层内状态恢复（deepTime 退出）与调试消费。
   */
  tailVisible: boolean;
  /** 天球世界坐标——固定引用、原地 mutate，勿替换实例。 */
  vec: THREE.Vector3;
}

interface MinorRegistry {
  /** 每次 recomputeMinorBodies 自增；消费方 useFrame 比较版本才搬坐标。 */
  version: number;
  /** 最近一次计算的时刻（epoch ms）；0 表示尚未计算。 */
  computedAtMs: number;
  states: Map<string, MinorBodyState>;
}

function createRegistry(): MinorRegistry {
  const states = new Map<string, MinorBodyState>();
  for (const meta of listMinorBodies()) {
    states.set(meta.objectUid, {
      uid: meta.objectUid,
      id: meta.id,
      kind: meta.kind,
      nameZh: meta.nameZh,
      colorHex: meta.colorHex,
      raDeg: 0,
      decDeg: 0,
      distanceAu: 0,
      helioDistanceAu: 0,
      tailVisible: false,
      vec: new THREE.Vector3(),
    });
  }
  return { version: 0, computedAtMs: 0, states };
}

export const minor: MinorRegistry = createRegistry();

// ── 动态花名册（Phase 9C）：/api/v1/minor-bodies 动态注册现役亮彗星 ─────────
//
// 启动（MinorBodiesLayer 挂载）时拉一次 feed：合法彗星逐体注册进 astro-ephem
// （meta + 轨道 + 光度）并追加状态槽；失败/未配置 API 一律静默回退内置 6 体常量。
// rosterVersion 供渲染层（MinorBodiesLayer/CometTailLayer）useSyncExternalStore
// 订阅——版本变化即重建几何缓冲；内置 6 体恒在花名册最前，槽位稳定。

/** 彗星渲染预算（跨域契约）：全场景彗尾/尾线成本封顶；超出按 M1 取最亮。 */
export const MAX_COMET_ROSTER = 8;

let rosterVersion = 0;
const rosterListeners = new Set<() => void>();

/** 当前花名册版本（0 = 仅内置 6 体）。 */
export function getMinorRosterVersion(): number {
  return rosterVersion;
}

/** 订阅花名册变化（useSyncExternalStore 契约：返回退订函数）。 */
export function subscribeMinorRoster(listener: () => void): () => void {
  rosterListeners.add(listener);
  return () => rosterListeners.delete(listener);
}

/** 内置彗星的既有别名/编号（动态 feed 去重用：1P/2P/12P 已有手养元数据与光度）。 */
const BUILTIN_COMET_DESIGNATIONS = ['1P', '2P', '12P'];

/** feed 名字是否与内置彗星重复（如 '1P/Halley'）。 */
function isBuiltinComet(name: string): boolean {
  const head = name.trim().split('/')[0]?.trim().toUpperCase();
  return head !== undefined && BUILTIN_COMET_DESIGNATIONS.includes(head);
}

/** feed id → 稳定 uid（'MB-DYN-' 前缀 + 大写字母数字，与内置 uid 无碰撞空间）。 */
function feedIdToUid(id: string): string {
  return 'MB-DYN-' + id.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * 注册单颗动态彗星（meta + 轨道 + 光度 + 状态槽 + 搜索目录行）。
 * 任一步校验失败抛错——调用方逐体 try/catch 跳过，绝不带病渲染。
 */
function registerDynamicComet(body: MinorBodyFeedEntry): void {
  const id = 'dyn-' + body.id.toLowerCase();
  const uid = feedIdToUid(body.id);
  if (minor.states.has(uid)) return; // 幂等
  const meta: MinorBodyMeta = {
    id,
    objectUid: uid,
    kind: 'comet',
    nameZh: body.nameZh ?? body.name,
    nameEn: body.name,
    aliases: [body.name, ...(body.nameZh ? [body.nameZh] : [])],
    colorHex: '#9fc8e8', // 动态彗星统一冰蓝（区分内置手调色，Additive 下和谐）
    typicalMagnitude: body.m1 ?? 12,
    // 合规红线：只述事实，无命名/产权暗示；isNamable=false 由目录行落实
    descriptionZh:
      `${body.nameZh ?? body.name}：现役彗星，轨道根数来自 JPL Small-Body Database` +
      `（历元 JD ${body.epochJd.toFixed(1)}，服务端每日刷新）；二体开普勒外推，演示级精度。`,
  };
  // 先注册轨道（校验最严，失败则 meta 不落）——顺序保证不留半注册状态
  registerMinorBodyOrbit(id, {
    e: body.e,
    qAu: body.qAu,
    aAu: body.aAu,
    iDeg: body.iDeg,
    omDeg: body.omDeg,
    wDeg: body.wDeg,
    tpJd: body.tpJd,
    maDeg: body.maDeg,
    epochJd: body.epochJd,
    sourceNote: `JPL SBDB（/api/v1/minor-bodies 每日刷新），epoch JD ${body.epochJd.toFixed(1)}`,
  });
  registerMinorBodyMeta(meta);
  if (Number.isFinite(body.m1)) {
    // K 斜率 feed 未含：取 n=4 标准假设（K=10，演示级，见 astro-ephem 注释）
    registerCometPhotometry(id, {
      absMag: body.m1!,
      slopeK: 10,
      sourceNote: 'JPL SBDB M1（K 取 n=4 标准假设）',
    });
  }
  minor.states.set(uid, {
    uid,
    id,
    kind: 'comet',
    nameZh: meta.nameZh,
    colorHex: meta.colorHex,
    raDeg: 0,
    decDeg: 0,
    distanceAu: 0,
    helioDistanceAu: 0,
    tailVisible: false,
    vec: new THREE.Vector3(),
  });
  appendDynamicMinorRows([meta]); // 搜索目录 + byUid（信息卡/搜索面板可见）
}

let ensurePromise: Promise<void> | null = null;

/**
 * 确保动态花名册已加载（单例，幂等；MinorBodiesLayer 挂载时调用）。
 * feed 失败 / 未配置 API → 静默回退内置 6 体（现状行为零变化）。
 * 预算纪律：彗星总数（含内置 3）封顶 MAX_COMET_ROSTER，超出按 M1 最亮优先；
 * feed 中与内置重复的 1P/2P/12P 剔除（内置有手养中文名与 MPC 光度参数，保留）。
 */
export function ensureMinorBodiesRoster(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const feed = await fetchMinorBodiesFeed();
      if (!feed) return;
      const builtinComets = [...minor.states.values()].filter((s) => s.kind === 'comet').length;
      const budget = Math.max(0, MAX_COMET_ROSTER - builtinComets);
      const candidates = feed.bodies
        .filter((b) => b && b.kind === 'comet' && typeof b.name === 'string' && !isBuiltinComet(b.name))
        .sort((a, b) => (a.m1 ?? 99) - (b.m1 ?? 99)) // M1 越小越亮
        .slice(0, budget);
      let added = 0;
      for (const body of candidates) {
        try {
          registerDynamicComet(body);
          added++;
        } catch (err) {
          // 单体坏根数只跳过该体（e 超域/缺 tp 等），不拖垮整批
          if (process.env.NODE_ENV === 'development') {
            console.warn('[minorRegistry] 动态彗星注册失败，已跳过：', body.id, err);
          }
        }
      }
      if (added > 0) {
        minor.computedAtMs = 0; // 强制下一次 recompute（新槽位坐标还是 0）
        rosterVersion++;
        for (const fn of rosterListeners) fn();
      }
    })();
  }
  return ensurePromise;
}

/**
 * 整批重算 6 个小天体（开普勒 + HelioVector，<1.5ms）。
 * 仅在 observeTime 变化（MinorBodiesLayer effect）或实时模式 30s 心跳
 * （EphemDriver）时调用——小天体日运动角分级，绝不逐帧计算；
 * 相同 dateMs 去重直接 return，两路驱动幂等无争。
 */
export function recomputeMinorBodies(dateMs: number): void {
  if (dateMs === minor.computedAtMs && minor.version > 0) return;
  const date = new Date(dateMs);
  for (const state of minor.states.values()) {
    const eq = getMinorBodyEquatorial(state.id, date);
    state.raDeg = eq.raDeg;
    state.decDeg = eq.decDeg;
    state.distanceAu = eq.distanceAu;
    state.helioDistanceAu = eq.helioDistanceAu;
    const v = raDecToVector3({ raDeg: eq.raDeg, decDeg: eq.decDeg }, SPHERE_RADIUS * 0.99);
    state.vec.set(v.x, v.y, v.z); // 原地 mutate：pickRegistry 持同一引用
  }
  minor.computedAtMs = dateMs;
  minor.version += 1;
}

/**
 * 写入彗尾可见状态（Phase 9B）：CometTailLayer 按 1h 量化键低频调用。
 * 只改字段不 bump version——version 语义是「坐标已重算」，彗尾旗标由
 * UI 侧在自身渲染节奏里读取即可。未知 uid 静默忽略（层卸载竞态防御）。
 */
export function setCometTailVisible(uid: string, visible: boolean): void {
  const state = minor.states.get(uid);
  if (state) state.tailVisible = visible;
}
