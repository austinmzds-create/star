'use client';

import { motion } from 'framer-motion';
import { springs } from '@/lib/motionTokens';
import { useUniverse } from '@/lib/store';

export function BrandMark() {
  // 开场序曲 stagger（Phase 9A）：首位入场（delay 0），'playing' 期隐藏待命
  const overturePhase = useUniverse((s) => s.overturePhase);

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={overturePhase === 'playing' ? { opacity: 0, y: -12 } : { opacity: 1, y: 0 }}
      transition={springs.panel}
      className="pointer-events-none absolute left-6 top-6 z-20 select-none"
    >
      <div className="flex items-center gap-3">
        <div className="relative h-9 w-9">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-nebula-400 to-nebula-700 opacity-70 blur-[6px]" />
          <div className="absolute inset-[6px] rounded-full bg-white shadow-[0_0_16px_4px_rgba(150,165,255,0.8)]" />
        </div>
        <div>
          <div className="text-[15px] font-semibold tracking-[0.2em] text-white">星辰纪念</div>
          <div className="text-[10px] tracking-[0.3em] text-nebula-200/70">STELLAR MEMORIAL</div>
        </div>
      </div>
    </motion.div>
  );
}
