'use client';

import { motion } from 'framer-motion';
import { DISCLAIMER_ZH } from '@/app/credits/sources';
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
      {/* 免责声明升级（Phase 9C 合规核心）：DISCLAIMER_ZH 单一口径——
        引用 IAU-CSN 官方名录作为权威锚点，与命名弹窗/来源页逐字同句 */}
      <p className="text-[10.5px] leading-relaxed text-nebula-200/35">{DISCLAIMER_ZH}</p>
    </motion.div>
  );
}
