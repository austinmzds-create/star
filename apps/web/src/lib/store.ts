'use client';

import { CONSTELLATION_ABBR, getCelestialByUid } from '@star/astro-data';
import { isEphemerisUid } from '@star/astro-ephem/bodies';
import { create } from 'zustand';
import { DEFAULT_CITY, type City } from './cities';
import { writePref } from './prefs';

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

/**
 * 开场序曲阶段（Phase 9A 动效序曲）：'playing' 期间首屏 UI（BrandMark/
 * SearchPanel/ControlBar 等）保持隐藏待命，转 'done' 时按 stagger 依次入场。
 * 'idle' 是 SSR/未决初值——UI 侧只把 'playing' 当隐藏信号，其余一律可见，
 * 保证非主页路由与序曲被禁用的场景永不因此丢 UI。
 */
export type OverturePhase = 'idle' | 'playing' | 'done';

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

  // ── 轨迹与动态天体（Phase 6B 目标 6/7/8） ──
  /** 行星轨迹：选中行星/月亮时画 ±N 天视轨迹折线（无选中时零几何零成本）。 */
  showPlanetTrails: boolean;
  /** 人造卫星层（ISS/天宫/哈勃，TLE+SGP4 演示精度）；默认关，satellite.js 懒加载。 */
  showSatellites: boolean;
  /** 小行星与彗星层（谷神/灶神/智神/哈雷，演示级 ±0.5°）；Phase 8 起默认开。 */
  showMinorBodies: boolean;
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
  /**
   * 全天体查看器（恒星/DSO）当前展示的 objectUid；null 为关闭。
   * 星历天体不落在此：openObjectViewer 内部转发到 planetViewerOpen
   * （复用现有 PlanetViewerModal）。跨域契约（冻结），勿改名。
   */
  objectViewerUid: string | null;
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
  /**
   * 星座富面板展示对象（点击天区就近判定命中后钉住）。
   * 互斥规则：selectedUid 非空时 StarInfoCard 优先，本面板隐藏但状态保留
   * （关掉天体卡即回到面板）；左下注视小卡在本值非空时降级为纯提示。
   */
  focusedConstellation: string | null;

  // ── 情侣双星（Couple）挑选流程 ──
  /** 是否处于「情侣双星」挑选模式（开启后选星改为加入双星托盘）。 */
  coupleMode: boolean;
  /** 双星槽位 A 的 objectUid（第一颗）。 */
  coupleSlotA: string | null;
  /** 双星槽位 B 的 objectUid（第二颗）。 */
  coupleSlotB: string | null;
  /** 双星命名表单弹窗是否打开。 */
  coupleFormOpen: boolean;

  // ── 体验层（Phase 6B-UX：红光/环境音/陀螺仪，均低频布尔） ──
  /** 红光护眼模式（顶层 multiply 覆盖层；持久化 star.redLight）。 */
  redLightOn: boolean;
  /** 环境音开关（audioEngine；持久化 star.ambientOn；实际发声需用户手势后）。 */
  ambientOn: boolean;
  /** 环境音音量 0–1（持久化 star.ambientVolume；实际增益另有 0.06 硬上限）。 */
  ambientVolume: number;
  /** 陀螺仪指星模式是否激活（仅移动端；高频姿态走 cameraBus，不进 store）。 */
  gyroActive: boolean;
  /** 开场序曲阶段（低频，仅 lib/overture 写；UI stagger 消费）。 */
  overturePhase: OverturePhase;

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
  togglePlanetTrails: () => void;
  toggleSatellites: () => void;
  toggleMinorBodies: () => void;
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
  /**
   * 打开全天体查看器（跨域契约，冻结）：星历 uid 转发到行星查看器
   * （零重写复用），其余写 objectViewerUid。
   */
  openObjectViewer: (uid: string) => void;
  /** 关闭全天体查看器（顺带关行星查看器，两者互斥共用一个「大窗」心智）。 */
  closeObjectViewer: () => void;
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
  /** 点击天区命中星座（就近判定）：钉住点亮 + 打开右侧星座富面板，清掉天体选中。 */
  selectConstellation: (abbr: string) => void;
  /** 关闭星座富面板（连线点亮态保留，随注视/拖拽自然退出）。 */
  closeConstellationPanel: () => void;

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

  // ── 体验层 action（Phase 6B-UX） ──
  toggleRedLight: () => void;
  setAmbientOn: (on: boolean) => void;
  setAmbientVolume: (v: number) => void;
  /** 置 true 时顺带关闭自动旋转（指星模式下两者互斥）。 */
  setGyroActive: (active: boolean) => void;
  /** 序曲阶段写入口（仅 lib/overture 调用；同值去重防 React 抖动）。 */
  setOverturePhase: (phase: OverturePhase) => void;
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
  showPlanetTrails: true, // 仅选中行星时才有几何，常驻零成本
  showSatellites: false, // 硬约束：默认关（satellite.js 只在开启时懒加载）
  showMinorBodies: true, // 默认开：4 个开普勒天体重算 <1ms/30s，Points 1 draw，懒 chunk 不进首包
  settingsOpen: false,
  creditsOpen: false,
  timePanelOpen: false,
  timePlaying: false,
  timeSpeed: 60,
  timeFollowsNow: true,
  memorialOpen: false,
  planetViewerOpen: false,
  objectViewerUid: null,
  resetNonce: 0,

  showConstellations: true,
  activeConstellation: null,
  activeConstellationSource: null,
  constellationFocusNonce: 0,
  focusedConstellation: null,

  coupleMode: false,
  coupleSlotA: null,
  coupleSlotB: null,
  coupleFormOpen: false,

  // 体验层：SSR 首帧一律取默认值，由 ExperienceHydrator 在客户端读 prefs
  // 后一次性 set（避免 create 阶段读 localStorage 造成 SSR/CSR 水合不一致）。
  redLightOn: false,
  ambientOn: false,
  ambientVolume: 0.5,
  gyroActive: false,
  overturePhase: 'idle',

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
        // 全天体查看器：切换选中即关闭（与 planetViewerOpen 同一收敛纪律）
        objectViewerUid: null,
        // 场景点选到天体 → 星座富面板让位（点空处不清，关卡后面板可回来）。
        ...(uid ? { focusedConstellation: null } : {}),
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
        objectViewerUid: null,
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
  togglePlanetTrails: () => set((s) => ({ showPlanetTrails: !s.showPlanetTrails })),
  toggleSatellites: () => set((s) => ({ showSatellites: !s.showSatellites })),
  toggleMinorBodies: () => set((s) => ({ showMinorBodies: !s.showMinorBodies })),
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
  resetToNow: () => set({ observeTime: Date.now(), timePlaying: false, timeFollowsNow: true }),
  openMemorial: () => set({ memorialOpen: true }),
  closeMemorial: () => set({ memorialOpen: false }),
  openPlanetViewer: () => set({ planetViewerOpen: true }),
  closePlanetViewer: () => set({ planetViewerOpen: false }),
  openObjectViewer: (uid) =>
    // 星历天体（行星/日月）已有专属 3D 查看器：直接转发，不进 objectViewerUid
    set(isEphemerisUid(uid) ? { planetViewerOpen: true } : { objectViewerUid: uid }),
  closeObjectViewer: () => set({ objectViewerUid: null, planetViewerOpen: false }),
  resetView: () =>
    set((s) => ({
      selectedUid: null,
      autoRotate: true,
      planetViewerOpen: false,
      objectViewerUid: null,
      resetNonce: s.resetNonce + 1,
      activeConstellation: null,
      activeConstellationSource: null,
      focusedConstellation: null,
    })),
  toggleConstellations: () =>
    set((s) => ({
      showConstellations: !s.showConstellations,
      // 关闭星座层时同时清掉激活态与富面板，避免重开时旧星座突然亮起。
      activeConstellation: s.showConstellations ? null : s.activeConstellation,
      activeConstellationSource: s.showConstellations ? null : s.activeConstellationSource,
      focusedConstellation: s.showConstellations ? null : s.focusedConstellation,
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
  selectConstellation: (abbr) =>
    set({
      focusedConstellation: abbr,
      selectedUid: null,
      planetViewerOpen: false,
      objectViewerUid: null,
      autoRotate: false,
      // 复用钉住机制：连线立即开始 Star Walk 式描线，注视判定不抢。
      activeConstellation: abbr,
      activeConstellationSource: 'select',
    }),
  closeConstellationPanel: () => set({ focusedConstellation: null }),

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
  removeCoupleSlot: (slot) => set(slot === 'A' ? { coupleSlotA: null } : { coupleSlotB: null }),
  openCoupleForm: () => set({ coupleFormOpen: true }),
  closeCoupleForm: () => set({ coupleFormOpen: false }),

  toggleRedLight: () =>
    set((s) => {
      const on = !s.redLightOn;
      writePref('redLight', on);
      return { redLightOn: on };
    }),
  setAmbientOn: (on) => {
    writePref('ambientOn', on);
    set({ ambientOn: on });
  },
  setAmbientVolume: (v) => {
    const c = Math.min(1, Math.max(0, v));
    writePref('ambientVolume', c);
    set({ ambientVolume: c });
  },
  setGyroActive: (active) =>
    set(active ? { gyroActive: true, autoRotate: false } : { gyroActive: false }),
  setOverturePhase: (phase) =>
    set((s) => (s.overturePhase === phase ? {} : { overturePhase: phase })),
}));

/**
 * 派生选择器：是否偏离实时（时间机器激活指示）。
 * 播放中，或 observeTime 与真实现在偏差 > 90s（容忍 60s 心跳间隙）即视为激活。
 * 注意含 Date.now()，仅在 store 变化时重算——播放时 4Hz、实时模式 60s 心跳，足够新鲜。
 */
export const selectTimeTravel = (s: Pick<UniverseState, 'timePlaying' | 'observeTime'>): boolean =>
  s.timePlaying || (s.observeTime != null && Math.abs(s.observeTime - Date.now()) > 90_000);
