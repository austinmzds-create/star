'use client';

import { CONSTELLATION_ABBR, getCelestialByUid } from '@star/astro-data';
import { AnimatePresence, motion } from 'framer-motion';
import { hasConstellationArt } from '@/lib/constellation-art';
import { CONSTELLATION_LORE } from '@/lib/constellation-lore';
import { useUniverse } from '@/lib/store';

/**
 * 星座信息卡（左下角小卡）：中文名 + 拉丁名 / IAU 缩写 + 最亮星 + 神话看点。
 * 注视 / 点选 / 搜索激活某座时淡入。星座不可命名，卡内不含任何购买入口，
 * 仅保留「国际通用天区划分」的极小字说明避免产权歧义。
 */
export function ConstellationInfoCard() {
  const show = useUniverse((s) => s.showConstellations);
  const abbr = useUniverse((s) => s.activeConstellation);
  const focusStar = useUniverse((s) => s.focusStar);

  const meta = abbr ? CONSTELLATION_ABBR[abbr] : undefined;
  const lore = abbr ? CONSTELLATION_LORE[abbr] : undefined;
  const art = abbr ? hasConstellationArt(abbr) : false;
  // uid 在目录中可查才渲染为可点击（防御 lore 数据漂移）。
  const brightestUid =
    lore?.brightestUid && getCelestialByUid(lore.brightestUid) ? lore.brightestUid : undefined;

  return (
    <AnimatePresence>
      {show && abbr && meta && (
        <motion.aside
          key={abbr}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 14 }}
          transition={{ duration: 0.25 }}
          className="pointer-events-auto absolute bottom-24 left-4 z-20 w-[min(88vw,340px)] md:left-6"
        >
          <div className="glass rounded-2xl p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-xl font-semibold text-white">
                {meta.zh}
                {art && (
                  <span className="ml-2 align-middle text-[12px] text-gold" title="精绘星座形象">
                    ✦
                  </span>
                )}
              </h3>
              <span className="shrink-0 text-[12px] tracking-wide text-nebula-200/60">
                {meta.en} · {abbr}
              </span>
            </div>

            {lore && (
              <>
                <div className="mt-2 flex items-baseline gap-2 text-[13px]">
                  <span className="shrink-0 text-nebula-200/55">最亮星</span>
                  {brightestUid ? (
                    <button
                      onClick={() => focusStar(brightestUid)}
                      className="text-left text-nebula-100 underline decoration-nebula-400/40 underline-offset-4 transition hover:text-white"
                    >
                      {lore.brightest}
                    </button>
                  ) : (
                    <span className="text-nebula-100">{lore.brightest}</span>
                  )}
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-nebula-100/80">
                  {lore.loreZh}
                </p>
              </>
            )}

            <p className="mt-3 text-[10.5px] leading-relaxed text-nebula-200/40">
              星座为国际通用天区划分，不涉及任何命名或产权含义
            </p>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
