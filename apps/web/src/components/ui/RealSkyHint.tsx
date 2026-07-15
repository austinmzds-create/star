'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { exits, springs } from '@/lib/motionTokens';
import { writePref } from '@/lib/prefs';
import { useUniverse } from '@/lib/store';

/**
 * 「进 earth 建议切真实天空」一次性提示（Phase 10 契约 §1「建议不强制」）。
 *
 * 触发：setViewMode('earth') 时若 skyRealism 仍为 'all' 且用户从未处理过该建议
 * （realSkyHintSeen 未持久化），store 自增 realSkyHintNonce。本组件监听该 nonce
 * 弹出一枚可关闭的软提示——用户点「切到真实天空」即 setSkyRealism('naked')
 * （setter 内会写 seen），点「不用了」或 8s 后自动消失也写 seen。永不再自动弹。
 */
export function RealSkyHint() {
  const nonce = useUniverse((s) => s.realSkyHintNonce);
  const setSkyRealism = useUniverse((s) => s.setSkyRealism);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (nonce === 0) return; // 初值：从未触发
    setOpen(true);
    const t = window.setTimeout(() => {
      setOpen(false);
      writePref('realSkyHintSeen.v1', true); // 自动消失也视为已处理，不再骚扰
    }, 8000);
    return () => window.clearTimeout(t);
  }, [nonce]);

  const dismiss = () => {
    setOpen(false);
    writePref('realSkyHintSeen.v1', true);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16, transition: exits.fast }}
          transition={springs.panel}
          className="pointer-events-auto absolute bottom-24 left-1/2 z-30 -translate-x-1/2"
        >
          <div className="glass-strong flex items-center gap-3 rounded-2xl px-4 py-2.5 text-[12.5px]">
            <span aria-hidden className="text-[15px]">
              🌌
            </span>
            <span className="text-nebula-100/90">
              站在地球上了——要不要切到真实裸眼星空，像真的抬头？
            </span>
            <button
              onClick={() => setSkyRealism('naked')}
              className="rounded-full bg-amber-400/20 px-3 py-1 text-[12px] text-amber-100 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.45)] transition hover:bg-amber-400/30"
            >
              切到真实天空
            </button>
            <button
              onClick={dismiss}
              aria-label="不用了"
              className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-nebula-200/55 transition hover:bg-white/10 hover:text-white"
            >
              不用了
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
