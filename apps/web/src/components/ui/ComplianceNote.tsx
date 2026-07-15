'use client';

import { motion } from 'framer-motion';
import { springs, stagger } from '@/lib/motionTokens';
import { useUniverse } from '@/lib/store';

export function ComplianceNote() {
  // 开场序曲 stagger（Phase 9A）：末位入场，'playing' 期隐藏待命
  const overturePhase = useUniverse((s) => s.overturePhase);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={overturePhase === 'playing' ? { opacity: 0, y: 10 } : { opacity: 1, y: 0 }}
      transition={{
        ...springs.panel,
        delay: overturePhase === 'done' ? 3 * stagger.section : 0,
      }}
      className="pointer-events-none absolute bottom-5 right-6 z-10 max-w-[280px] text-right"
    >
      <p className="text-[10.5px] leading-relaxed text-nebula-200/35">
        本平台提供基于真实星体坐标的私人纪念命名登记，
        <br className="hidden sm:block" />
        不代表国际天文学联合会（IAU）或任何官方天文机构的命名。
      </p>
    </motion.div>
  );
}
