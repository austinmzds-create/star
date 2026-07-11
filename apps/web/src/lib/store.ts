'use client';

import { CONSTELLATION_ABBR, getCelestialByUid } from '@star/astro-data';
import { create } from 'zustand';
import { DEFAULT_CITY, type City } from './cities';

/** 星座全英文名 → IAU 3 字母缩写（目录里恒星的 constellation 存全英文名）。 */
const CONSTELLATION_EN_TO_ABBR: Record<string, string> = Object.fromEntries(
  Object.entries(CONSTELLATION_ABBR).map(([abbr, v]) => [v.en, abbr]),
);

/** 由天体 uid 推断其所属星座缩写；无星座（如行星/日月）返回 null。 */
function constellationAbbrOfUid(uid: string): string | null {
  const obj = getCelestialByUid(uid);
  const con = obj?.constellation;
  if (!con) return null;
  // 兼容两种存法：全英文名（'Orion'）或本就是缩写（'Ori'）。
  return CONSTELLATION_EN_TO_ABBR[con] ?? (CONSTELLATION_ABBR[con] ? con : null);
}

/** 星座被激活的来源：注视扫过 / 点选恒星联动 / 搜索星座。 */
export type ConstellationSource = 'gaze' | 'select' | 'search';

interface UniverseState {
  /** 当前选中的星体 objectUid。 */
  selectedUid: string | null;
  /** 每次「聚焦」自增，用于即使选中同一颗星也能重新触发镜头飞行。 */
  focusNonce: number;
  /** 观测城市。 */
  city: City;
  /** 观测时刻（epoch ms）；null 表示尚未在客户端初始化。 */
  observeTime: number | null;
  /** 是否自动旋转。 */
  autoRotate: boolean;
  /** 是否显示亮星标签。 */
  showLabels: boolean;
  /** 命名弹窗是否打开。 */
  memorialOpen: boolean;
  /** 每次「回到全景」自增，供相机复位 FOV/朝向。 */
  resetNonce: number;

  // ── 星座层（连线动画 / 艺术图，由 ConstellationLayer 消费） ──
  /** 是否显示星座层（连线 + 名称 + 艺术图）；关闭时整层不渲染。 */
  showConstellations: boolean;
  /** 当前激活（点亮动画）的星座 IAU 3 字母缩写，如 'Ori'；null 为无。 */
  activeConstellation: string | null;
  /**
   * 激活来源。'select'/'search' 为「钉住」态（注视判定不覆盖），
   * 用户拖拽后由 clearPinnedConstellation 降回 'gaze' 接管。
   */
  activeConstellationSource: ConstellationSource | null;
  /** 搜索星座 → 镜头飞向星座质心的触发器（每次搜索选中自增）。 */
  constellationFocusNonce: number;

  // ── 情侣双星（Couple）挑选流程 ──
  /** 是否处于「情侣双星」挑选模式（开启后选星改为加入双星托盘）。 */
  coupleMode: boolean;
  /** 双星槽位 A 的 objectUid（第一颗）。 */
  coupleSlotA: string | null;
  /** 双星槽位 B 的 objectUid（第二颗）。 */
  coupleSlotB: string | null;
  /** 双星命名表单弹窗是否打开。 */
  coupleFormOpen: boolean;

  selectStar: (uid: string | null) => void;
  focusStar: (uid: string) => void;
  setCity: (city: City) => void;
  setObserveTime: (ms: number) => void;
  toggleAutoRotate: () => void;
  toggleLabels: () => void;
  openMemorial: () => void;
  closeMemorial: () => void;
  resetView: () => void;
  toggleConstellations: () => void;
  /** 激活某星座的连线点亮动画（低频：搜索/点击/注视去抖后写入）。 */
  setActiveConstellation: (abbr: string | null) => void;
  /** 注视判定写入（仅当当前非钉住态时生效；同值去重，不抖 React）。 */
  setGazeConstellation: (abbr: string | null) => void;
  /** 点选恒星 / 搜索星座 → 钉住激活；search 时自增 constellationFocusNonce 触发镜头飞行。 */
  activateConstellation: (abbr: string, source: 'select' | 'search') => void;
  /** 解除钉住（用户拖拽后调用），降级回注视接管；星座本身随注视自然淡出。 */
  clearPinnedConstellation: () => void;

  /** 进入情侣双星模式（清空槽位）。 */
  enterCoupleMode: () => void;
  /** 退出情侣双星模式（清空槽位与表单）。 */
  exitCoupleMode: () => void;
  /** 把一颗星加入双星：填入首个空槽；已在槽位内则移出（可再选）。返回不需要。 */
  addStarToCouple: (uid: string) => void;
  /** 移除指定槽位的星。 */
  removeCoupleSlot: (slot: 'A' | 'B') => void;
  /** 打开双星命名表单弹窗。 */
  openCoupleForm: () => void;
  /** 关闭双星命名表单弹窗。 */
  closeCoupleForm: () => void;
}

export const useUniverse = create<UniverseState>((set) => ({
  selectedUid: null,
  focusNonce: 0,
  city: DEFAULT_CITY,
  observeTime: null,
  autoRotate: true,
  showLabels: true,
  memorialOpen: false,
  resetNonce: 0,

  showConstellations: true,
  activeConstellation: null,
  activeConstellationSource: null,
  constellationFocusNonce: 0,

  coupleMode: false,
  coupleSlotA: null,
  coupleSlotB: null,
  coupleFormOpen: false,

  selectStar: (uid) =>
    set((s) => {
      // 联动：点选的天体若有所属星座，同步钉住该星座（DSO/行星无星座时自然跳过）。
      const abbr = uid ? constellationAbbrOfUid(uid) : null;
      return {
        selectedUid: uid,
        focusNonce: uid ? s.focusNonce + 1 : s.focusNonce,
        autoRotate: uid ? false : s.autoRotate,
        ...(uid
          ? abbr
            ? { activeConstellation: abbr, activeConstellationSource: 'select' as const }
            : {}
          : // 点空处取消选择 → 解除钉住，注视判定重新接管。
            s.activeConstellationSource === 'select' || s.activeConstellationSource === 'search'
            ? { activeConstellationSource: 'gaze' as const }
            : {}),
      };
    }),
  focusStar: (uid) =>
    set((s) => {
      const abbr = constellationAbbrOfUid(uid);
      return {
        selectedUid: uid,
        focusNonce: s.focusNonce + 1,
        autoRotate: false,
        ...(abbr
          ? { activeConstellation: abbr, activeConstellationSource: 'select' as const }
          : {}),
      };
    }),
  setCity: (city) => set({ city }),
  setObserveTime: (ms) => set({ observeTime: ms }),
  toggleAutoRotate: () => set((s) => ({ autoRotate: !s.autoRotate })),
  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),
  openMemorial: () => set({ memorialOpen: true }),
  closeMemorial: () => set({ memorialOpen: false }),
  resetView: () =>
    set((s) => ({
      selectedUid: null,
      autoRotate: true,
      resetNonce: s.resetNonce + 1,
      activeConstellation: null,
      activeConstellationSource: null,
    })),
  toggleConstellations: () =>
    set((s) => ({
      showConstellations: !s.showConstellations,
      // 关闭星座层时同时清掉激活态，避免重开时旧星座突然亮起。
      activeConstellation: s.showConstellations ? null : s.activeConstellation,
      activeConstellationSource: s.showConstellations ? null : s.activeConstellationSource,
    })),
  setActiveConstellation: (abbr) => set({ activeConstellation: abbr }),
  setGazeConstellation: (abbr) =>
    set((s) => {
      // 钉住态（select/search）不被注视覆盖；同值去重避免 React 抖动。
      if (s.activeConstellationSource === 'select' || s.activeConstellationSource === 'search')
        return {};
      if (s.activeConstellation === abbr) return {};
      return {
        activeConstellation: abbr,
        activeConstellationSource: abbr ? ('gaze' as const) : null,
      };
    }),
  activateConstellation: (abbr, source) =>
    set((s) => ({
      activeConstellation: abbr,
      activeConstellationSource: source,
      // 搜索星座 → 触发镜头飞行，并停下自动旋转（与选星一致的沉浸体验）。
      ...(source === 'search'
        ? { constellationFocusNonce: s.constellationFocusNonce + 1, autoRotate: false }
        : {}),
    })),
  clearPinnedConstellation: () =>
    set((s) =>
      s.activeConstellationSource === 'select' || s.activeConstellationSource === 'search'
        ? { activeConstellationSource: 'gaze' as const }
        : {},
    ),

  enterCoupleMode: () =>
    set({ coupleMode: true, coupleSlotA: null, coupleSlotB: null, coupleFormOpen: false }),
  exitCoupleMode: () =>
    set({ coupleMode: false, coupleSlotA: null, coupleSlotB: null, coupleFormOpen: false }),
  addStarToCouple: (uid) =>
    set((s) => {
      // 已在某槽 → 移出（允许重新挑选）
      if (s.coupleSlotA === uid) return { coupleSlotA: null };
      if (s.coupleSlotB === uid) return { coupleSlotB: null };
      // 填入首个空槽：A 优先，其次 B；两槽皆满则替换 B（最近一次为准）
      if (!s.coupleSlotA) return { coupleSlotA: uid };
      if (!s.coupleSlotB) return { coupleSlotB: uid };
      return { coupleSlotB: uid };
    }),
  removeCoupleSlot: (slot) =>
    set(slot === 'A' ? { coupleSlotA: null } : { coupleSlotB: null }),
  openCoupleForm: () => set({ coupleFormOpen: true }),
  closeCoupleForm: () => set({ coupleFormOpen: false }),
}));
