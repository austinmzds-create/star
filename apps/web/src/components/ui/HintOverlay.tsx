'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useUniverse } from '@/lib/store';

export function HintOverlay() {
  const selectedUid = useUniverse((s) => s.selectedUid);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDismissed(true), 6000);
    return () => window.clearTimeout(t);
  }, []);

  const show = !dismissed && !selectedUid;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
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
