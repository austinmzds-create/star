'use client';

/**
 * 开场序曲导演状态机（Phase 9A，r-fx §3.a 时间轴，总 6.5s）。
 *
 * 时间轴（t 秒）：
 *   0–0.8    纯黑幕布（OvertureOverlay DOM 层负责渐隐）
 *   0.5–3.0  银河 + 星场从 20% 亮度抬升至 100%（fxBus.setGlobalFade，GL 零 React）
 *   1.0–4.5  镜头缓推：fov 72→60 + yaw/pitch 缓移至默认观景位（maath damp）
 *   3.8–5.2  标题「星辰纪念」letter-spacing 收拢浮现（Overlay 层）
 *   5.2–6.5  标题让位，store.overturePhase → 'done'，首屏 UI stagger 入场
 *   0–4.0    环境音 0→目标音量 ramp（仅当引擎已被用户手势启动过——绝不
 *            在手势栈外创建 AudioContext）
 *
 * 跨域纪律（冻结契约）：
 * - 相机只走 cameraBus 外部姿态通道（driveCamera/releaseCamera，陀螺仪同款）；
 *   CameraRig 不为序曲改任何优先级。任何一方调用 releaseCamera（如深链
 *   focusStar 触发镜头飞行抢占）都会经 subscribeCameraRelease 通知到这里，
 *   序曲立即静默收尾——「被打断即结束」的语义天然成立。
 * - fov 缓推不改 CameraRig：外部姿态通道只有 yaw/pitch，fov 经 CameraRig
 *   自己的 wheel 公共交互通道驱动——向 canvas 派发合成 WheelEvent
 *   （deltaMode=0 像素模式，deltaY = Δfov/0.03 与 rig 的映射精确互逆），
 *   rig 内部的 targetFov damp（0.16s）天然把 8Hz 的离散推量平滑成缓推。
 *   初始 60→72 的抬升发生在纯黑幕布期（t<0.8s），用户不可见。
 *   canvas 迟迟未挂载（懒加载慢网）则放弃 fov 编排，只保留 yaw 缓移与淡入。
 * - 亮度只写 fxBus.setGlobalFade（TwinkleStars/MilkyWayLayer 每帧乘入）；
 *   结束/被打断必须写回 1，渲染层无需感知序曲存在。
 *
 * 只演一次：localStorage star.overtureSeen.v1（启动即标记，刷新不强迫重看）。
 * 退化：prefers-reduced-motion / perfTier low / 深链进入 → 'reduced'，
 * 由 Overlay 做 0.6s 交叉淡入，不走本状态机。
 */

import { damp } from 'maath/easing';
import { isAmbientRunning, setAmbientVolume } from './audioEngine';
import { driveCamera, releaseCamera, subscribeCameraRelease } from './cameraBus';
import { setGlobalFade } from './fxBus';
import { getPerfTier } from './perfBus';
import { readPref, writePref } from './prefs';
import { useUniverse } from './store';

// ── 时间轴常量（秒） ──
const T_VEIL = 0.8; // 纯黑幕布结束
const T_FADE_START = 0.5; // 星场/银河亮度抬升起点
const T_FADE_END = 3.0;
const T_CAM_START = 1.0; // 镜头缓推起点
const T_CAM_END = 4.5;
const T_TITLE = 3.8; // 标题浮现
const T_YIELD = 5.2; // 标题让位 + UI stagger
const T_END = 6.5;
const T_AUDIO_RAMP = 4.0;

/** 起始亮度：星场从 20% 抬升（纯黑期也不至于全灭，幕布掀开即有微光）。 */
const FADE_FLOOR = 0.2;

/** 相机开合位：终点 = CameraRig 默认观景位（yaw 0.7 / pitch 0.12），
 * 序曲结束后与「回到全景」/新会话的画面无缝一致；起点向左下偏出一段，
 * 首帧 snap 发生在纯黑幕布期，不可见。 */
const CAM_END = { yaw: 0.7, pitch: 0.12 };
const CAM_START = { yaw: 0.42, pitch: 0.06 };
/** maath damp 平滑时间（秒）：t=1.0 换目标后 ~3.2s 内收敛，恰在 4.5s 前到位。 */
const CAM_SMOOTH = 1.05;

/** fov 缓推区间与 rig 的 wheel 映射常数（CameraRig onWheel：fov += deltaY*0.03）。 */
const FOV_WIDE = 72;
const FOV_HOME = 60;
const WHEEL_FOV_PER_DELTA = 0.03;

/** 序曲被打上的舞台标记（Overlay 据此编排 DOM 层动画）。 */
export type OvertureStage = 'black' | 'reveal' | 'title' | 'yield';

export type OvertureMode = 'full' | 'reduced' | 'skip';

const SEEN_KEY = 'overtureSeen.v1'; // prefs 前缀后即 star.overtureSeen.v1

/**
 * 决定本次进入的序曲形态：
 * - 已看过 → skip；
 * - 深链（?focus/?con/?t）→ skip：用户意图是直达目标，镜头飞行优先；
 * - reduced-motion / 低档设备 → reduced（0.6s 交叉淡入）；
 * - 其余 → full。
 *
 * 深链判定同时看当前 URL 与「原始文档 URL」（navigation entry）：
 * DeepLinkBoot 消费完深链会 router.replace 清查询串，本判定与它没有
 * 时序保证（PostFX.fxForcedOff 同款踩坑）——被清了就查首个文档 URL 兜底。
 */
export function decideOvertureMode(): OvertureMode {
  if (typeof window === 'undefined') return 'skip';
  if (readPref(SEEN_KEY, false)) return 'skip';
  const DEEP_LINK = /[?&](focus|con|t)=/;
  if (DEEP_LINK.test(window.location.search)) return 'skip';
  try {
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (nav && DEEP_LINK.test(new URL(nav.name, window.location.origin).search)) return 'skip';
  } catch {
    /* 判定失败按无深链处理 */
  }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || getPerfTier() === 'low') return 'reduced';
  return 'full';
}

/** 标记已看过（full 与 reduced 首帧即标记：中途刷新不强迫重看）。 */
export function markOvertureSeen(): void {
  writePref(SEEN_KEY, true);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

export interface OvertureHandle {
  /** 任意点击跳过：直接快进到终态（幂等）。 */
  skip: () => void;
  /** 组件卸载/路由切换清理：与 skip 同一收尾（幂等，重复调用无害）。 */
  dispose: () => void;
}

/**
 * 启动完整序曲。调用前提：decideOvertureMode() === 'full' 且 WebGL canvas
 * 已挂载（Overlay 负责等待——保证 fov 的 wheel 通道与相机就绪）。
 * onStage 在舞台切换时回调（'black'→'reveal'→'title'→'yield'）；
 * onEnd 在 6.5s 自然结束 / 跳过 / 被打断时回调一次。
 */
export function startOverture(
  canvas: HTMLCanvasElement,
  onStage: (stage: OvertureStage) => void,
  onEnd: () => void,
): OvertureHandle {
  markOvertureSeen();
  useUniverse.getState().setOverturePhase('playing');

  let raf = 0;
  let finished = false;
  let stage: OvertureStage = 'black';
  let last = performance.now();
  const t0 = last;

  // 相机姿态载体（damp 直接改字段；首帧即接管外部姿态通道）
  const cam = { yaw: CAM_START.yaw, pitch: CAM_START.pitch };
  let camReleased = false; // 4.5s 缓推完成后主动释放，防止把释放误判为打断
  driveCamera(cam.yaw, cam.pitch);
  setGlobalFade(FADE_FLOOR);

  // ── fov 缓推簿记：镜像 rig 内部 targetFov（初值 60，映射精确互逆不会漂）──
  let fovTarget = FOV_HOME;
  let lastWheelAt = 0;
  const nudgeFov = (desired: number, now: number, force = false): void => {
    // 8Hz 派发足够：rig 的 damp(0.16s) 把离散步长平滑掉；更高频只会
    // 空刷 regress()（交互降载），让序曲期间画质白降。force 供收尾归位用
    //（绕过节流，保证 targetFov 精确落回 60）。
    if (!force && now - lastWheelAt < 125 && Math.abs(desired - fovTarget) < 3) return;
    const deltaY = (desired - fovTarget) / WHEEL_FOV_PER_DELTA;
    if (Math.abs(deltaY) < 1) return;
    lastWheelAt = now;
    fovTarget = desired;
    canvas.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY,
        deltaMode: 0, // 像素模式：rig 侧不乘 16
        clientX: Math.round(window.innerWidth / 2), // 锚点居中，补偿量对称近零
        clientY: Math.round(window.innerHeight / 2),
        cancelable: true,
      }),
    );
  };
  // 纯黑幕布期一次性抬到 72（damp 约 0.5s 到位，掀幕时已就位）
  nudgeFov(FOV_WIDE, last);

  // ── 环境音 ramp：仅当引擎已在运行（用户此前手势开启过）──
  const rampAudio = isAmbientRunning();
  if (rampAudio) setAmbientVolume(0);
  let lastAudioAt = 0;

  const setStage = (s: OvertureStage): void => {
    if (stage === s) return;
    stage = s;
    onStage(s);
  };

  /** 终态收尾（自然结束/跳过/被打断三条路共用，幂等）。 */
  const finish = (): void => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    unsubRelease();
    if (!camReleased) {
      camReleased = true;
      releaseCamera();
    }
    setGlobalFade(1);
    // fov 归位：把 rig 的 targetFov 拨回 60，rig 自己 damp 收敛（≈0.4s）
    nudgeFov(FOV_HOME, performance.now(), true);
    if (rampAudio) setAmbientVolume(useUniverse.getState().ambientVolume);
    useUniverse.getState().setOverturePhase('done');
    onEnd();
  };

  // 外部抢占（深链镜头飞行 / 陀螺仪等任何 releaseCamera）→ 静默结束
  const unsubRelease = subscribeCameraRelease(() => {
    if (!camReleased) {
      camReleased = true; // 相机已被别人接管，不再重复 release
      finish();
    }
  });

  const tick = (now: number): void => {
    if (finished) return;
    const t = (now - t0) / 1000;
    const dt = Math.min((now - last) / 1000, 0.1); // 标签页切走回来不跳帧爆冲
    last = now;

    // ① 亮度抬升：0.5–3.0s smoothstep 0.2→1（GL uniform 消费，零 React）
    setGlobalFade(
      FADE_FLOOR + (1 - FADE_FLOOR) * smoothstep((t - T_FADE_START) / (T_FADE_END - T_FADE_START)),
    );

    // ② 相机缓移：1.0s 起把 damp 目标切到终点位，收敛即是缓推的「减速尾」
    if (!camReleased) {
      const target = t < T_CAM_START ? CAM_START : CAM_END;
      damp(cam, 'yaw', target.yaw, CAM_SMOOTH, dt);
      damp(cam, 'pitch', target.pitch, CAM_SMOOTH, dt);
      driveCamera(cam.yaw, cam.pitch);
      // ③ fov 72→60：easeInOutCubic 曲线离散派发，rig 侧 damp 补间
      const p = easeInOutCubic(
        Math.min(Math.max((t - T_CAM_START) / (T_CAM_END - T_CAM_START), 0), 1),
      );
      nudgeFov(FOV_WIDE - (FOV_WIDE - FOV_HOME) * p, now);
      if (t >= T_CAM_END) {
        camReleased = true;
        releaseCamera(); // 主动释放：静止 2s 后自动旋转自然缓入，衔接顺滑
      }
    }

    // ④ 环境音 4s 线性 ramp（10Hz 写增益足够，引擎内部再做 0.1s 平滑）
    if (rampAudio && now - lastAudioAt >= 100) {
      lastAudioAt = now;
      const v = useUniverse.getState().ambientVolume * Math.min(t / T_AUDIO_RAMP, 1);
      setAmbientVolume(v);
    }

    // ⑤ 舞台推进（Overlay 消费）
    if (t >= T_YIELD) {
      if (stage !== 'yield') {
        useUniverse.getState().setOverturePhase('done'); // UI stagger 入场
        setStage('yield');
      }
    } else if (t >= T_TITLE) setStage('title');
    else if (t >= T_VEIL) setStage('reveal');

    if (t >= T_END) {
      finish();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return {
    skip: finish,
    dispose: finish,
  };
}
