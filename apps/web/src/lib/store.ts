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

  selectStar: (uid: string | null) => void;
  focusStar: (uid: string) => void;
  setCity: (city: City) => void;
  setObserveTime: (ms: number) => void;
  toggleAutoRotate: () => void;
  toggleLabels: () => void;
  openMemorial: () => void;
  closeMemorial: () => void;
  resetView: () => void;
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
}));
