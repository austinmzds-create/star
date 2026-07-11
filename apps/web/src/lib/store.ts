'use client';

import { create } from 'zustand';
import { DEFAULT_CITY, type City } from './cities';

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

  coupleMode: false,
  coupleSlotA: null,
  coupleSlotB: null,
  coupleFormOpen: false,

  selectStar: (uid) =>
    set((s) => ({
      selectedUid: uid,
      focusNonce: uid ? s.focusNonce + 1 : s.focusNonce,
      autoRotate: uid ? false : s.autoRotate,
    })),
  focusStar: (uid) =>
    set((s) => ({
      selectedUid: uid,
      focusNonce: s.focusNonce + 1,
      autoRotate: false,
    })),
  setCity: (city) => set({ city }),
  setObserveTime: (ms) => set({ observeTime: ms }),
  toggleAutoRotate: () => set((s) => ({ autoRotate: !s.autoRotate })),
  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),
  openMemorial: () => set({ memorialOpen: true }),
  closeMemorial: () => set({ memorialOpen: false }),
  resetView: () =>
    set((s) => ({ selectedUid: null, autoRotate: true, resetNonce: s.resetNonce + 1 })),

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
