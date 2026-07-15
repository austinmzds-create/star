'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { formatBeijingTime } from '@/lib/format';
import { springs, stagger } from '@/lib/motionTokens';
import { selectTimeTravel, useUniverse } from '@/lib/store';

/**
 * 底部控制条（宇宙 V3 重组）：只留高频项 —— 时间机器入口、情侣双星、
 * 回到全景、显示设置入口。自动旋转/名称标签/星座/银河等「设一次就不动」
 * 的低频开关收进 DisplaySettings 面板（「显示 ⚙」）。
 *
 * 「时间」按钮即 TimeMachineBar 的收起态：显示当前观测时刻（北京时间），
 * 偏离实时（selectTimeTravel）时琥珀高亮，点击在 ControlBar 上方展开时间条。
 */
export function ControlBar() {
  // 开场序曲 stagger（Phase 9A）：'playing' 期隐藏待命，结束后依次入场
  const overturePhase = useUniverse((s) => s.overturePhase);
  const coupleMode = useUniverse((s) => s.coupleMode);
  const timePanelOpen = useUniverse((s) => s.timePanelOpen);
  const settingsOpen = useUniverse((s) => s.settingsOpen);
  const observeTime = useUniverse((s) => s.observeTime);
  const timeTravel = useUniverse(selectTimeTravel);
  const setTimePanelOpen = useUniverse((s) => s.setTimePanelOpen);
  const openSettings = useUniverse((s) => s.openSettings);
  const closeSettings = useUniverse((s) => s.closeSettings);
  const resetView = useUniverse((s) => s.resetView);
  const enterCoupleMode = useUniverse((s) => s.enterCoupleMode);
  const exitCoupleMode = useUniverse((s) => s.exitCoupleMode);

  const clock = observeTime != null ? formatBeijingTime(new Date(observeTime)) : '--:--';

  return (
    // 定位层与动画层分离：外层 -translate-x-1/2 纯 CSS 定位；序曲入场动画
    // 包在内层 motion.div（framer 接管 transform，不能与定位 transform 同层）。
    <div className="pointer-events-auto absolute bottom-6 left-1/2 z-20 -translate-x-1/2">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={overturePhase === 'playing' ? { opacity: 0, y: 16 } : { opacity: 1, y: 0 }}
        transition={{
          ...springs.panel,
          delay: overturePhase === 'done' ? 2 * stagger.section : 0,
        }}
        className="glass flex items-center gap-1 rounded-full px-2 py-1.5"
      >
        {/* 时间机器收起态按钮（V3-E） */}
        <motion.button
          whileTap={{ scale: 0.96 }}
          transition={springs.chip}
          onClick={() => setTimePanelOpen(!timePanelOpen)}
          title="时间机器"
          className={`tap-96 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] transition ${
            timeTravel
              ? 'bg-amber-400/15 text-amber-100 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.45)]'
              : timePanelOpen
                ? 'bg-nebula-500/30 text-white shadow-[inset_0_0_0_1px_rgba(140,155,255,0.4)]'
                : 'text-nebula-200/60 hover:bg-white/5'
          }`}
        >
          <span aria-hidden>🕐</span>
          <span className="tabular-nums">{clock}</span>
          {timeTravel && <span className="h-1.5 w-1.5 rounded-full bg-amber-300" aria-hidden />}
        </motion.button>
        <div className="mx-1 h-5 w-px bg-white/10" />
        <Toggle active={coupleMode} onClick={coupleMode ? exitCoupleMode : enterCoupleMode}>
          ✦ 情侣双星
        </Toggle>
        <motion.button
          whileTap={{ scale: 0.96 }}
          transition={springs.chip}
          onClick={resetView}
          className="tap-96 rounded-full px-4 py-1.5 text-[13px] text-nebula-100 transition hover:bg-white/10"
        >
          回到全景
        </motion.button>
        <div className="mx-1 h-5 w-px bg-white/10" />
        <Toggle active={settingsOpen} onClick={settingsOpen ? closeSettings : openSettings}>
          显示 ⚙
        </Toggle>
        {/* 天象日历入口（独立路由 /almanac，不动 store） */}
        <Link
          href="/almanac"
          prefetch={false}
          aria-label="天象日历"
          className="rounded-full px-4 py-1.5 text-[13px] text-nebula-200/60 transition hover:bg-white/5 hover:text-nebula-100"
        >
          📅 天象
        </Link>
      </motion.div>
    </div>
  );
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      transition={springs.chip}
      onClick={onClick}
      className={`tap-96 rounded-full px-4 py-1.5 text-[13px] transition ${
        active
          ? 'bg-nebula-500/30 text-white shadow-[inset_0_0_0_1px_rgba(140,155,255,0.4)]'
          : 'text-nebula-200/60 hover:bg-white/5'
      }`}
    >
      {children}
    </motion.button>
  );
}
