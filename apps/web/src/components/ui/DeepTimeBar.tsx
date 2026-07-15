'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '@/lib/device';
import { exits, springs } from '@/lib/motionTokens';
import { useUniverse } from '@/lib/store';
import { ensureStarExtrasReady, getLoadedStarExtras } from '@/lib/useStarExtra';

/**
 * 星座时光机（Phase 9B「恒星自行」域，r-dyn §3c 模式 UI）。
 *
 * deepTimeYears 非 null 时替代普通时间条出现在 ControlBar 上方：
 *  - ±100,000 年【对数刻度】滑条——恒星自行是 mas/yr 量级，线性刻度下前
 *    1 万年全挤在几个像素里；对数刻度让「千年级」和「十万年级」都拖得动；
 *  - 当前年份大字（公元 / 公元前，历史纪年无 0 年：天文年 0 = 公元前 1 年）；
 *  - 预设跳转（±1 万 / ±10 万）带 0.9s 缓动 tween——恒星「飞」到新位而非闪跳；
 *  - 科普注记（跨域契约 §3 要求的不可外推声明 + 岁差取舍说明）。
 *
 * 与普通时间机器互斥：入口（TimeMachineBar「万年」按钮）先暂停播放再开模式；
 * 本组件再挂一道保险——模式中 timePlaying 变 true（任何路径恢复普通播放）
 * 即自动退出深时。渲染联动零 React：恒星位移在 TwinkleStars shader（uEpochYr）、
 * 连线形变在 constellation-render（100ms 节流 CPU 重算）；行星/小天体/卫星/
 * 彗尾的淡出由各自域实现（契约 §3，本组件不越界）。
 */

/** 滑条半程刻度数（±1000 步）。 */
const SLIDER_MAX = 1000;
/** 深时上限（与 store.setDeepTimeYears 的钳制一致）。 */
const YEARS_MAX = 100_000;

/** 对数滑条值 → 年数：y = sign(v)·(10^(|v|/200) − 1)，|v|=1000 → ≈10 万年。 */
function yearsFromSlider(v: number): number {
  const y = Math.round(Math.pow(10, Math.abs(v) / 200) - 1);
  return Math.sign(v) * Math.min(y, YEARS_MAX);
}

/** 年数 → 对数滑条值（yearsFromSlider 的逆）。 */
function sliderFromYears(y: number): number {
  return Math.sign(y) * Math.min(200 * Math.log10(Math.abs(y) + 1), SLIDER_MAX);
}

/**
 * 年份展示：deepTimeYears 是 J2000 偏移 → 天文年号 = 2000 + 偏移。
 * 历史纪年无公元 0 年（天文年 0 = 公元前 1 年），故公元前 N = 1 − 天文年号。
 */
function formatYear(years: number): string {
  const ay = 2000 + years;
  // 年号不加千分位（「公元 52026 年」而非「公元 52,026 年」，纪年读法惯例）
  return ay >= 1 ? `公元 ${ay} 年` : `公元前 ${1 - ay} 年`;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** 预设跳转档（对数刻度上的常用叙事锚点；+10 万年 = 北斗散架名场面）。 */
const PRESETS: Array<{ value: number; label: string }> = [
  { value: -100_000, label: '−10万' },
  { value: -10_000, label: '−1万' },
  { value: 0, label: '2000年' },
  { value: 10_000, label: '+1万' },
  { value: 100_000, label: '+10万' },
];

export function DeepTimeBar() {
  const deepTimeYears = useUniverse((s) => s.deepTimeYears);
  const setDeepTimeYears = useUniverse((s) => s.setDeepTimeYears);
  const timePlaying = useUniverse((s) => s.timePlaying);

  // ── 深时模式入口 await extras（9C 跨域契约）：主表 lean 化后自行数据在
  // star-extras.json 异步 chunk，未就绪时拨滑条只会「星空纹丝不动」——
  // 入口处 await ensureStarExtrasReady()（含目录回填 + 连线 pm 刷新），
  // 加载中滑条/预设禁用并给加载态；就绪即恢复（单例缓存，二次进入零等待）。
  // 降级态：chunk 拉取失败（离线等）resolve 空表——控件保持禁用并给出降级提示；
  // 单例不缓存空结果，重进模式（或点重试）会重新拉取。
  const [extrasState, setExtrasState] = useState<'loading' | 'ready' | 'failed'>(() =>
    getLoadedStarExtras() !== null ? 'ready' : 'loading',
  );
  const extrasReady = extrasState === 'ready';
  useEffect(() => {
    if (deepTimeYears == null || extrasState !== 'loading') return;
    let alive = true;
    void ensureStarExtrasReady().then((map) => {
      if (alive) setExtrasState(map.size > 0 ? 'ready' : 'failed');
    });
    return () => {
      alive = false;
    };
  }, [deepTimeYears, extrasState]);

  // 预设跳转 tween 的 rAF 句柄（手动拖滑条/退出时取消，避免打架）。
  const tweenRaf = useRef<number | null>(null);
  const cancelTween = (): void => {
    if (tweenRaf.current != null) {
      cancelAnimationFrame(tweenRaf.current);
      tweenRaf.current = null;
    }
  };

  // 互斥保险（契约 §3 语义补全）：深时模式中任何路径恢复了普通播放
  // （理论上入口已暂停，防其它 UI 直呼 setTimePlaying）→ 深时让位退出。
  useEffect(() => {
    if (timePlaying && deepTimeYears != null) {
      cancelTween();
      setDeepTimeYears(null);
    }
  }, [timePlaying, deepTimeYears, setDeepTimeYears]);

  // 卸载兜底：清掉进行中的 tween。
  useEffect(() => cancelTween, []);

  /** 预设跳转：0.9s easeInOutCubic 缓动写 store（reduced-motion 直接落点）。 */
  const tweenTo = (target: number): void => {
    cancelTween();
    const from = useUniverse.getState().deepTimeYears ?? 0;
    if (from === target || prefersReducedMotion()) {
      setDeepTimeYears(target);
      return;
    }
    const DUR_MS = 900;
    const t0 = performance.now();
    const step = (now: number): void => {
      const t = Math.min((now - t0) / DUR_MS, 1);
      setDeepTimeYears(Math.round(from + (target - from) * easeInOutCubic(t)));
      tweenRaf.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    tweenRaf.current = requestAnimationFrame(step);
  };

  const years = deepTimeYears ?? 0;

  return (
    <AnimatePresence>
      {deepTimeYears != null && (
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 14, transition: exits.fast }}
          transition={springs.panel}
          className="pointer-events-auto absolute bottom-20 left-1/2 z-20 w-[min(92vw,560px)] -translate-x-1/2"
        >
          <div className="glass space-y-2.5 rounded-2xl px-4 py-3">
            {/* 行1：标题 + 当前年份大字 + 退出 */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[11px] tracking-wide text-nebula-200/60">✦ 星座时光机</span>
              <span className="text-[20px] font-semibold tabular-nums text-white" aria-live="polite">
                {formatYear(years)}
              </span>
              <span className="text-[11px] tabular-nums text-nebula-200/50">
                J2000 {years >= 0 ? '+' : '−'}
                {Math.abs(years).toLocaleString('zh-CN')} 年
              </span>
              <button
                onClick={() => {
                  cancelTween();
                  setDeepTimeYears(null); // 退出即复原 J2000（shader/连线同步归位）
                }}
                className="ml-auto rounded-full bg-amber-400/20 px-3 py-1 text-[12px] text-amber-100 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.35)] transition hover:bg-amber-400/30"
              >
                ↺ 退出时光机
              </button>
            </div>

            {/* 行2：±10 万年对数滑条（extras 未就绪时禁用——拨了也不会动） */}
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-[10.5px] text-nebula-200/40">−10万年</span>
              <input
                type="range"
                min={-SLIDER_MAX}
                max={SLIDER_MAX}
                step={1}
                value={sliderFromYears(years)}
                disabled={!extrasReady}
                onPointerDown={cancelTween}
                onChange={(e) => {
                  cancelTween(); // 键盘方向键改值无 pointerdown，这里兜底
                  setDeepTimeYears(yearsFromSlider(Number(e.target.value)));
                }}
                className="h-1 w-full cursor-ew-resize appearance-none rounded-full bg-white/10 accent-nebula-400 disabled:cursor-wait disabled:opacity-40"
                aria-label="恒星自行时光机（对数刻度，±100,000 年）"
              />
              <span className="shrink-0 text-[10.5px] text-nebula-200/40">+10万年</span>
            </div>

            {/* 行3：预设跳转 + 叙事提示 / 加载态（star-extras 异步 chunk 在途） */}
            <div className="flex flex-wrap items-center gap-1.5">
              {PRESETS.map((p) => (
                <motion.button
                  key={p.value}
                  whileTap={{ scale: 0.96 }}
                  transition={springs.chip}
                  disabled={!extrasReady}
                  onClick={() => tweenTo(p.value)}
                  className={`tap-96 rounded-full px-2 py-0.5 text-[11px] transition disabled:opacity-40 ${
                    years === p.value
                      ? 'bg-nebula-500/30 text-white shadow-[inset_0_0_0_1px_rgba(140,155,255,0.4)]'
                      : 'text-nebula-200/55 hover:bg-white/5'
                  }`}
                >
                  {p.label}
                </motion.button>
              ))}
              {extrasState === 'ready' && (
                <span className="ml-auto text-[10.5px] text-nebula-200/45">
                  试试 +10万：北斗的勺柄会拉直
                </span>
              )}
              {extrasState === 'loading' && (
                <span
                  className="ml-auto inline-flex items-center gap-1.5 text-[10.5px] text-amber-200/70"
                  role="status"
                  aria-live="polite"
                >
                  <span className="h-2.5 w-2.5 animate-spin rounded-full border border-amber-200/30 border-t-amber-200/90" />
                  正在载入恒星自行数据（HYG）…
                </span>
              )}
              {extrasState === 'failed' && (
                <span
                  className="ml-auto inline-flex items-center gap-1.5 text-[10.5px] text-amber-200/80"
                  role="status"
                  aria-live="polite"
                >
                  自行数据加载失败，时光机暂不可用
                  <button
                    onClick={() => setExtrasState('loading')} // 单例不缓存空结果 → 重新拉取
                    className="rounded-full bg-amber-400/15 px-2 py-0.5 text-amber-100 transition hover:bg-amber-400/25"
                  >
                    重试
                  </button>
                </span>
              )}
            </div>

            {/* 行4：科普注记（跨域契约 §3 的不可外推声明 + 演示级取舍标注） */}
            <p className="text-[10.5px] leading-relaxed text-nebula-200/40">
              行星与太阳系天体位置在此尺度不可外推，已暂时淡出；岁差已略去——它不改变星座形状。
              恒星按 HYG 星表自行数据沿大圆匀速外推（演示级：略去视向速度带来的透视加速度）。
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
