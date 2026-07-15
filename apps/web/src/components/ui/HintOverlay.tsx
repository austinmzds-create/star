'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { exits } from '@/lib/motionTokens';
import { useUniverse } from '@/lib/store';

export function HintOverlay() {
  const selectedUid = useUniverse((s) => s.selectedUid);
  // 序曲联动（Phase 9A）：'playing' 期不显示、6s 消隐计时也不启动——
  // 否则首访用户的手势提示会在序曲幕后白白烧完。
  const overturePhase = useUniverse((s) => s.overturePhase);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (overturePhase === 'playing') return;
    const t = window.setTimeout(() => setDismissed(true), 6000);
    return () => window.clearTimeout(t);
  }, [overturePhase]);

  const show = !dismissed && !selectedUid && overturePhase !== 'playing';

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: exits.base }}
          // 氛围级淡入：0.6s 属 scenePace 场景层节奏，不套小件 token
          transition={{ duration: 0.6 }}
          className="pointer-events-none absolute bottom-24 left-1/2 z-10 -translate-x-1/2"
        >
          <div className="flex items-center gap-4 text-[12.5px] tracking-wide text-nebula-200/55">
            <span>拖动 · 环视星空</span>
            <span className="text-nebula-200/25">|</span>
            <span>滚轮 · 缩放</span>
            <span className="text-nebula-200/25">|</span>
            <span>搜索或点击 · 飞向一颗星</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
