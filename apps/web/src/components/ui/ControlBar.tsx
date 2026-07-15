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
 *
 * 观察模式切换（Phase 9B 地平锁定，用户拍板要显眼）：条上首位常驻
 * 「🌍 站在地球上看 / ✨ 自由环视」，earth 激活态用琥珀点——与时间旅行的
 * 激活语义同风格（两者都表示「你看到的不是默认天球」）。
 */
export function ControlBar() {
  // 开场序曲 stagger（Phase 9A）：'playing' 期隐藏待命，结束后依次入场
  const overturePhase = useUniverse((s) => s.overturePhase);
  const viewMode = useUniverse((s) => s.viewMode);
  const setViewMode = useUniverse((s) => s.setViewMode);
  // 真实天空（Phase 10）：一键在「满天繁星 ↔ 真实裸眼」间切；具体光污染档在
  // 「显示 ⚙」精调（这里只管开关）。
  const skyRealism = useUniverse((s) => s.skyRealism);
  const setSkyRealism = useUniverse((s) => s.setSkyRealism);
  const realSky = skyRealism === 'naked';
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
        {/* 观察模式（9B）：earth = 所选城市的真实地平视角，天空随时间旋转 */}
        <motion.button
          whileTap={{ scale: 0.96 }}
          transition={springs.chip}
          onClick={() => setViewMode(viewMode === 'earth' ? 'free' : 'earth')}
          title={
            viewMode === 'earth'
              ? '站在地球上看：所选城市的地平视角，时间快进天空会旋转。点击切回自由环视'
              : '自由环视天球中。点击切换到「站在地球上看」——真实地平视角'
          }
          className={`tap-96 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] transition ${
            viewMode === 'earth'
              ? 'bg-amber-400/15 text-amber-100 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.45)]'
              : 'text-nebula-200/60 hover:bg-white/5'
          }`}
        >
          <span aria-hidden>{viewMode === 'earth' ? '🌍' : '✨'}</span>
          <span>{viewMode === 'earth' ? '站在地球上看' : '自由环视'}</span>
          {viewMode === 'earth' && (
            <span className="h-1.5 w-1.5 rounded-full bg-amber-300" aria-hidden />
          )}
        </motion.button>
        {/* 真实天空（Phase 10）：naked 激活态用琥珀点（与 viewMode/timeTravel 同语义：
          你看到的不是默认满天） */}
        <motion.button
          whileTap={{ scale: 0.96 }}
          transition={springs.chip}
          onClick={() => setSkyRealism(realSky ? 'all' : 'naked')}
          title={
            realSky
              ? '真实裸眼星空：只显示当前光污染档下肉眼能看到的星。点击切回满天繁星'
              : '满天繁星（含程序化填充）。点击切换到真实裸眼星空——只留肉眼可见的星'
          }
          className={`tap-96 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] transition ${
            realSky
              ? 'bg-amber-400/15 text-amber-100 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.45)]'
              : 'text-nebula-200/60 hover:bg-white/5'
          }`}
        >
          <span aria-hidden>{realSky ? '🌌' : '✨'}</span>
          <span>{realSky ? '真实天空' : '满天繁星'}</span>
          {realSky && <span className="h-1.5 w-1.5 rounded-full bg-amber-300" aria-hidden />}
        </motion.button>
        <div className="mx-1 h-5 w-px bg-white/10" />
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
