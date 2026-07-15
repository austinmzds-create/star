'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { exits, springs } from '@/lib/motionTokens';
import { selectTimeTravel, useUniverse } from '@/lib/store';

/**
 * 时间机器（宇宙 V3-E）。
 *
 * 本组件【常驻挂载】（UniverseApp）：内部的 TimeController 时序 hooks
 * （播放 rAF 循环 / 实时 60s 心跳）不随面板开合中断；面板 UI 仅在
 * timePanelOpen 时出现在 ControlBar 上方（收起态按钮并入 ControlBar）。
 *
 * 时序纪律（设计 §3.2）：
 *  - 权威时间在 rAF 闭包内累加（模拟秒 = 帧间隔 × timeSpeed），
 *    【4Hz（250ms）节流】写 store.observeTime → EphemDriver 重算星历
 *    → 行星/月相/信息卡/地平线/晨昏全链路联动；
 *  - 外部写入（信息卡兜底/回到现在）单向对齐：每帧读 store，发现值不是
 *    自己上次写出的即以外部值重置累加基准，无环；
 *  - 实时模式（timeFollowsNow 且未播放）：60s 心跳对齐 Date.now()，
 *    顺带驱动 LST/晨昏缓慢演化，零额外定时器。
 */

/** 速度档位：模拟秒/真实秒。 */
const SPEEDS: Array<{ value: number; label: string }> = [
  { value: 1, label: '×1' },
  { value: 60, label: '1分/秒' },
  { value: 3600, label: '1时/秒' },
  { value: 86400, label: '1天/秒' },
  { value: 604800, label: '1周/秒' },
];

/** epoch ms → datetime-local 输入值（浏览器本地时区，"YYYY-MM-DDTHH:mm"）。 */
function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TimeMachineBar() {
  const timePanelOpen = useUniverse((s) => s.timePanelOpen);
  const timePlaying = useUniverse((s) => s.timePlaying);
  const timeSpeed = useUniverse((s) => s.timeSpeed);
  const timeFollowsNow = useUniverse((s) => s.timeFollowsNow);
  const observeTime = useUniverse((s) => s.observeTime);
  const timeTravel = useUniverse(selectTimeTravel);
  const setTimePanelOpen = useUniverse((s) => s.setTimePanelOpen);
  const setTimePlaying = useUniverse((s) => s.setTimePlaying);
  const setTimeSpeed = useUniverse((s) => s.setTimeSpeed);
  const travelTo = useUniverse((s) => s.travelTo);
  const setObserveTime = useUniverse((s) => s.setObserveTime);
  const resetToNow = useUniverse((s) => s.resetToNow);

  // ── TimeController：初始化（接管 StarInfoCard 的兜底，保留其 effect 无害） ──
  useEffect(() => {
    if (useUniverse.getState().observeTime == null) setObserveTime(Date.now());
  }, [setObserveTime]);

  // ── 播放循环：rAF 累加闭包内权威时间，4Hz 节流写 store ──
  useEffect(() => {
    if (!timePlaying) return;
    let raf = 0;
    let last = performance.now();
    let lastWriteAt = 0;
    let lastWritten = useUniverse.getState().observeTime ?? Date.now();
    let sim = lastWritten;
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      // 外部写入（信息卡/日期选/滑条）单向对齐：不是自己写出的值 → 重置基准
      const cur = useUniverse.getState().observeTime;
      if (cur != null && cur !== lastWritten) {
        sim = cur;
        lastWritten = cur;
      }
      sim += dt * timeSpeed;
      if (now - lastWriteAt >= 250) {
        lastWriteAt = now;
        lastWritten = sim;
        useUniverse.getState().setObserveTime(sim);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // 停止/变速时 flush 最终值，链路落在准确时刻
      useUniverse.getState().setObserveTime(sim);
    };
  }, [timePlaying, timeSpeed]);

  // ── 实时心跳：跟随现在时每 60s 对齐 Date.now()（LST/晨昏随之缓慢演化） ──
  useEffect(() => {
    if (!timeFollowsNow || timePlaying) return;
    const id = setInterval(() => {
      useUniverse.getState().setObserveTime(Date.now());
    }, 60_000);
    return () => clearInterval(id);
  }, [timeFollowsNow, timePlaying]);

  // ── ±24h 弹簧滑条（行3）：pointerdown 记锚点，250ms 节流写，松手归零可再拖 ──
  const [slider, setSlider] = useState(0); // 单位：分钟，-1440..1440
  const anchorRef = useRef<number | null>(null);
  const lastSlideWrite = useRef(0);
  const beginSlide = () => {
    // 播放中拖滑条 → 先暂停，避免 rAF 与手动写互相覆盖
    if (useUniverse.getState().timePlaying) setTimePlaying(false);
    anchorRef.current = useUniverse.getState().observeTime ?? Date.now();
    lastSlideWrite.current = 0;
  };
  const moveSlide = (v: number) => {
    // 键盘方向键改值时没有 pointerdown，锚点在此兜底初始化
    if (anchorRef.current == null) beginSlide();
    setSlider(v);
    const now = performance.now();
    if (now - lastSlideWrite.current >= 250) {
      lastSlideWrite.current = now;
      travelTo(anchorRef.current! + v * 60_000);
    }
  };
  const endSlide = () => {
    if (anchorRef.current != null && slider !== 0) travelTo(anchorRef.current + slider * 60_000);
    anchorRef.current = null;
    setSlider(0); // 弹簧回中：可反复拖动累积微调
  };

  const stepBy = (deltaMs: number) => {
    travelTo((useUniverse.getState().observeTime ?? Date.now()) + deltaMs);
  };

  const t = observeTime ?? Date.now();

  return (
    <AnimatePresence>
      {timePanelOpen && (
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 14, transition: exits.fast }}
          transition={springs.panel}
          className="pointer-events-auto absolute bottom-20 left-1/2 z-20 w-[min(92vw,560px)] -translate-x-1/2"
        >
          <div className="glass space-y-2.5 rounded-2xl px-4 py-3">
            {/* 行1：步进 / 播放 / 倍速 / 日期时间 / 回到现在 / 收起 */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
              <div className="flex items-center gap-1">
                <StepBtn onClick={() => stepBy(-86_400_000)} label="◀ 1天" title="回退一天" />
                <StepBtn onClick={() => stepBy(-3_600_000)} label="−1时" title="回退一小时" />
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  transition={springs.chip}
                  onClick={() => setTimePlaying(!timePlaying)}
                  title={timePlaying ? '暂停' : '播放'}
                  className={`tap-96 mx-0.5 flex h-8 w-8 items-center justify-center rounded-full text-[13px] transition ${
                    timePlaying
                      ? 'bg-amber-400/25 text-amber-100 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.4)]'
                      : 'bg-nebula-500/25 text-white hover:bg-nebula-500/40'
                  }`}
                >
                  {timePlaying ? '⏸' : '▶'}
                </motion.button>
                <StepBtn onClick={() => stepBy(3_600_000)} label="+1时" title="前进一小时" />
                <StepBtn onClick={() => stepBy(86_400_000)} label="1天 ▶" title="前进一天" />
              </div>

              <div className="mx-1 h-5 w-px bg-white/10" />

              <div className="flex items-center gap-1">
                {SPEEDS.map((s) => (
                  <motion.button
                    key={s.value}
                    whileTap={{ scale: 0.96 }}
                    transition={springs.chip}
                    onClick={() => setTimeSpeed(s.value)}
                    className={`tap-96 rounded-full px-2 py-0.5 text-[11px] transition ${
                      timeSpeed === s.value
                        ? 'bg-nebula-500/30 text-white shadow-[inset_0_0_0_1px_rgba(140,155,255,0.4)]'
                        : 'text-nebula-200/55 hover:bg-white/5'
                    }`}
                  >
                    {s.label}
                  </motion.button>
                ))}
              </div>

              <button
                onClick={() => setTimePanelOpen(false)}
                aria-label="收起时间条"
                className="ml-auto rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-nebula-200/60 transition hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* 行2：日期时间选择 + 状态 + 回到现在 */}
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="datetime-local"
                value={toLocalInputValue(t)}
                onChange={(e) => {
                  const ms = new Date(e.target.value).getTime();
                  if (!Number.isNaN(ms)) travelTo(ms);
                }}
                className="rounded-lg border border-white/10 bg-void/60 px-2 py-1 text-[12px] text-white [color-scheme:dark] focus:outline-none"
              />
              <span className="text-[11px] text-nebula-200/50">
                {timeTravel ? (
                  <span className="text-amber-200/90">⦿ 时间机器中</span>
                ) : (
                  '实时 · 每分钟对齐现在'
                )}
              </span>
              {timeTravel && (
                <button
                  onClick={resetToNow}
                  className="ml-auto rounded-full bg-amber-400/20 px-3 py-1 text-[12px] text-amber-100 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.35)] transition hover:bg-amber-400/30"
                >
                  ↺ 回到现在
                </button>
              )}
            </div>

            {/* 行3：±24h 弹簧滑条（松手回中，可反复拖动累积） */}
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-[10.5px] text-nebula-200/40">-24h</span>
              <input
                type="range"
                min={-1440}
                max={1440}
                step={5}
                value={slider}
                onPointerDown={beginSlide}
                onChange={(e) => moveSlide(Number(e.target.value))}
                onPointerUp={endSlide}
                onPointerCancel={endSlide}
                onBlur={endSlide}
                className="h-1 w-full cursor-ew-resize appearance-none rounded-full bg-white/10 accent-nebula-400"
                aria-label="时间微调（±24 小时）"
              />
              <span className="shrink-0 text-[10.5px] text-nebula-200/40">+24h</span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function StepBtn({ onClick, label, title }: { onClick: () => void; label: string; title: string }) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      transition={springs.chip}
      onClick={onClick}
      title={title}
      className="tap-96 rounded-full px-2 py-1 text-[11.5px] text-nebula-200/70 transition hover:bg-white/10 hover:text-white"
    >
      {label}
    </motion.button>
  );
}
