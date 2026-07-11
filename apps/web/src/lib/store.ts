'use client';

import { CONSTELLATION_ABBR, getCelestialByUid } from '@star/astro-data';
import { isEphemerisUid } from '@star/astro-ephem/bodies';
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
  /** 是否显示真实银河全景层（MilkyWayLayer；关闭仅剩程序化氛围）。 */
  showMilkyWay: boolean;

  // ── 显示设置（宇宙 V3-F/G：坐标线与观测辅助，低频布尔） ──
  /** 黄道大圆 + 黄道十二宫刻度与宫名（GridLayer，金色）。 */
  showEcliptic: boolean;
  /** 天赤道 + RA/Dec 坐标网格（GridLayer，同属赤道参考系合并一组开关）。 */
  showEquatorGrid: boolean;
  /**
   * 观测视角辅助整组（HorizonLayer）：所选城市+时刻的地平线大圆、
   * 东南西北方位标、地平线下半球压暗与晨昏色调（G 组）。
   */
  showHorizon: boolean;
  /** 「显示 ⚙」设置面板开合。 */
  settingsOpen: boolean;
  /** 「影像与数据来源」致谢面板开合（CreditsPanel；DisplaySettings 亦可打开）。 */
  creditsOpen: boolean;

  // ── 时间机器（宇宙 V3-E，TimeMachineBar 消费） ──
  /** 时间条展开/收起（收起时仅剩 ControlBar 上的小时钟按钮）。 */
  timePanelOpen: boolean;
  /** 是否正在播放（TimeMachineBar 的 rAF 循环推进 observeTime）。 */
  timePlaying: boolean;
  /** 播放速度：模拟秒/真实秒（1|60|3600|86400|604800）。 */
  timeSpeed: number;
  /**
   * 实时模式：true 时 60s 心跳把 observeTime 对齐 Date.now()
   * （顺带驱动 LST/晨昏缓慢演化）；任何手动时间操作置 false。
   */
  timeFollowsNow: boolean;

  /** 命名弹窗是否打开。 */
  memorialOpen: boolean;
  /** 行星 3D 全屏查看器是否打开（仅选中星历天体时有意义）。 */
  planetViewerOpen: boolean;
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
  toggleMilkyWay: () => void;
  toggleEcliptic: () => void;
  toggleEquatorGrid: () => void;
  toggleHorizon: () => void;
  /** 打开显示设置面板（同时收起时间条，避免两个浮层叠在 ControlBar 上方）。 */
  openSettings: () => void;
  closeSettings: () => void;
  openCredits: () => void;
  closeCredits: () => void;
  /** 展开/收起时间条（展开时顺带关掉设置面板；收起不重置时间状态，播放继续）。 */
  setTimePanelOpen: (open: boolean) => void;
  /** 播放/暂停；置 true 时同时退出实时模式（timeFollowsNow=false）。 */
  setTimePlaying: (playing: boolean) => void;
  setTimeSpeed: (speed: number) => void;
  /** 手动时间旅行（滑条/日期选/步进按钮统一入口）：写 observeTime 并退出实时模式。 */
  travelTo: (ms: number) => void;
  /** 回到现在：observeTime 对齐 Date.now()、停止播放、恢复 60s 实时心跳。 */
  resetToNow: () => void;
  openMemorial: () => void;
  closeMemorial: () => void;
  /** 打开行星 3D 全屏查看器。 */
  openPlanetViewer: () => void;
  /** 关闭行星 3D 全屏查看器。 */
  closePlanetViewer: () => void;
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
  showMilkyWay: true,
  showEcliptic: false,
  showEquatorGrid: false,
  showHorizon: false,
  settingsOpen: false,
  creditsOpen: false,
  timePanelOpen: false,
  timePlaying: false,
  timeSpeed: 60,
  timeFollowsNow: true,
  memorialOpen: false,
  planetViewerOpen: false,
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
        // 3D 查看器只在选中星历天体时有宿主：取消选中/切到非星历天体即关闭
        planetViewerOpen: uid && isEphemerisUid(uid) ? s.planetViewerOpen : false,
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
        planetViewerOpen: isEphemerisUid(uid) ? s.planetViewerOpen : false,
        ...(abbr
          ? { activeConstellation: abbr, activeConstellationSource: 'select' as const }
          : {}),
      };
    }),
  setCity: (city) => set({ city }),
  setObserveTime: (ms) => set({ observeTime: ms }),
  toggleAutoRotate: () => set((s) => ({ autoRotate: !s.autoRotate })),
  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),
  toggleMilkyWay: () => set((s) => ({ showMilkyWay: !s.showMilkyWay })),
  toggleEcliptic: () => set((s) => ({ showEcliptic: !s.showEcliptic })),
  toggleEquatorGrid: () => set((s) => ({ showEquatorGrid: !s.showEquatorGrid })),
  toggleHorizon: () => set((s) => ({ showHorizon: !s.showHorizon })),
  openSettings: () => set({ settingsOpen: true, timePanelOpen: false }),
  closeSettings: () => set({ settingsOpen: false }),
  openCredits: () => set({ creditsOpen: true }),
  closeCredits: () => set({ creditsOpen: false }),
  setTimePanelOpen: (open) =>
    set(open ? { timePanelOpen: true, settingsOpen: false } : { timePanelOpen: false }),
  setTimePlaying: (playing) =>
    set(playing ? { timePlaying: true, timeFollowsNow: false } : { timePlaying: false }),
  setTimeSpeed: (speed) => set({ timeSpeed: speed }),
  travelTo: (ms) => set({ observeTime: ms, timeFollowsNow: false }),
  resetToNow: () =>
    set({ observeTime: Date.now(), timePlaying: false, timeFollowsNow: true }),
  openMemorial: () => set({ memorialOpen: true }),
  closeMemorial: () => set({ memorialOpen: false }),
  openPlanetViewer: () => set({ planetViewerOpen: true }),
  closePlanetViewer: () => set({ planetViewerOpen: false }),
  resetView: () =>
    set((s) => ({
      selectedUid: null,
      autoRotate: true,
      planetViewerOpen: false,
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

/**
 * 派生选择器：是否偏离实时（时间机器激活指示）。
 * 播放中，或 observeTime 与真实现在偏差 > 90s（容忍 60s 心跳间隙）即视为激活。
 * 注意含 Date.now()，仅在 store 变化时重算——播放时 4Hz、实时模式 60s 心跳，足够新鲜。
 */
export const selectTimeTravel = (s: Pick<UniverseState, 'timePlaying' | 'observeTime'>): boolean =>
  s.timePlaying || (s.observeTime != null && Math.abs(s.observeTime - Date.now()) > 90_000);
