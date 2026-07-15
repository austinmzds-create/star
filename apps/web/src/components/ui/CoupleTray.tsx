'use client';

import { getCelestialByUid } from '@star/astro-data';
import { AnimatePresence, motion } from 'framer-motion';
import { exits, springs } from '@/lib/motionTokens';
import { useUniverse } from '@/lib/store';

// 情侣双星挑选托盘：进入双星模式后常驻底部，展示两个槽位。
// 用户在星图中点选星星 → StarInfoCard 的按钮把星加入首个空槽（见 StarInfoCard）。
// 两槽皆满即可「填写双纪念名」，打开 CoupleModal 完成登记。

export function CoupleTray() {
  const coupleMode = useUniverse((s) => s.coupleMode);
  const slotA = useUniverse((s) => s.coupleSlotA);
  const slotB = useUniverse((s) => s.coupleSlotB);
  const removeCoupleSlot = useUniverse((s) => s.removeCoupleSlot);
  const openCoupleForm = useUniverse((s) => s.openCoupleForm);
  const exitCoupleMode = useUniverse((s) => s.exitCoupleMode);

  const bothFilled = Boolean(slotA && slotB);

  return (
    <AnimatePresence>
      {coupleMode && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24, transition: exits.base }}
          transition={springs.panel}
          className="pointer-events-auto absolute bottom-24 left-1/2 z-30 w-[min(94vw,520px)] -translate-x-1/2"
        >
          <div className="glass-strong rounded-3xl p-5">
            <div className="flex items-center justify-between">
              <div className="text-[13px] font-medium text-white">情侣双星 · 选择两颗星</div>
              <motion.button
                whileTap={{ scale: 0.96 }}
                transition={springs.chip}
                onClick={exitCoupleMode}
                className="tap-96 rounded-full border border-white/10 px-2.5 py-0.5 text-[12px] text-nebula-200/60 transition hover:bg-white/10 hover:text-white"
              >
                退出
              </motion.button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <Slot role="A" uid={slotA} onRemove={() => removeCoupleSlot('A')} />
              <Slot role="B" uid={slotB} onRemove={() => removeCoupleSlot('B')} />
            </div>

            <p className="mt-3 text-center text-[11.5px] text-nebula-200/50">
              在星图中点选星星，从右侧信息卡「加入双星纪念」依次填入两个槽位。
            </p>

            <motion.button
              whileTap={{ scale: 0.96 }}
              transition={springs.chip}
              onClick={openCoupleForm}
              disabled={!bothFilled}
              className="tap-96 mt-4 w-full rounded-2xl bg-gradient-to-r from-nebula-500 to-nebula-700 py-3 text-[15px] font-medium text-white shadow-[0_8px_30px_rgba(107,115,255,0.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {bothFilled ? '填写双纪念名 →' : '请先选满两颗星'}
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** 单个槽位卡片：展示已选星或空态占位。 */
function Slot({
  role,
  uid,
  onRemove,
}: {
  role: 'A' | 'B';
  uid: string | null;
  onRemove: () => void;
}) {
  const star = uid ? getCelestialByUid(uid) : undefined;
  const label = role === 'A' ? '第一颗星' : '第二颗星';

  return (
    <div
      className={`relative rounded-2xl border p-3 ${
        star
          ? 'border-nebula-400/40 bg-nebula-500/10'
          : 'border-dashed border-white/15 bg-white/[0.02]'
      }`}
    >
      <div className="text-[10.5px] uppercase tracking-[0.2em] text-gold/70">{label}</div>
      {star ? (
        <>
          <div className="mt-1.5 truncate text-[15px] font-medium text-white">{star.nameZh}</div>
          <div className="truncate text-[12px] text-nebula-200/60">
            {star.nameEn} · {star.constellationZh}
          </div>
          <button
            onClick={onRemove}
            className="absolute right-2 top-2 rounded-full border border-white/10 px-1.5 text-[11px] text-nebula-200/60 transition hover:bg-white/10 hover:text-white"
            aria-label="移除"
          >
            ✕
          </button>
        </>
      ) : (
        <div className="mt-1.5 text-[13px] text-nebula-200/45">待选择…</div>
      )}
    </div>
  );
}
