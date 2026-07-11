'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { CITIES } from '@/lib/cities';
import { useUniverse } from '@/lib/store';

/**
 * 「显示 ⚙」设置面板（宇宙 V3-§6）：收纳低频开关，给 ControlBar 减负。
 *
 * 分区：氛围（银河/名称标签/星座/自动旋转）· 参考线（黄道/赤道网格）·
 * 观测（地平线与晨昏 + 城市）。底部小字链接打开「影像与数据来源」致谢面板。
 * 点击面板外或 ✕ 关闭；移动端收窄为 w-[min(92vw,340px)]。
 */
export function DisplaySettings() {
  const settingsOpen = useUniverse((s) => s.settingsOpen);
  const closeSettings = useUniverse((s) => s.closeSettings);
  const openCredits = useUniverse((s) => s.openCredits);

  const showMilkyWay = useUniverse((s) => s.showMilkyWay);
  const showLabels = useUniverse((s) => s.showLabels);
  const showConstellations = useUniverse((s) => s.showConstellations);
  const autoRotate = useUniverse((s) => s.autoRotate);
  const showEcliptic = useUniverse((s) => s.showEcliptic);
  const showEquatorGrid = useUniverse((s) => s.showEquatorGrid);
  const showHorizon = useUniverse((s) => s.showHorizon);
  const city = useUniverse((s) => s.city);

  const toggleMilkyWay = useUniverse((s) => s.toggleMilkyWay);
  const toggleLabels = useUniverse((s) => s.toggleLabels);
  const toggleConstellations = useUniverse((s) => s.toggleConstellations);
  const toggleAutoRotate = useUniverse((s) => s.toggleAutoRotate);
  const toggleEcliptic = useUniverse((s) => s.toggleEcliptic);
  const toggleEquatorGrid = useUniverse((s) => s.toggleEquatorGrid);
  const toggleHorizon = useUniverse((s) => s.toggleHorizon);
  const setCity = useUniverse((s) => s.setCity);

  return (
    <AnimatePresence>
      {settingsOpen && (
        <>
          {/* 透明幕布：点击面板外关闭 */}
          <div
            className="pointer-events-auto absolute inset-0 z-20"
            onClick={closeSettings}
            aria-hidden
          />
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.16 }}
            className="pointer-events-auto absolute bottom-20 left-1/2 z-30 w-[min(92vw,340px)] -translate-x-1/2 sm:left-auto sm:right-[max(1.5rem,calc(50%-280px))] sm:w-[300px] sm:translate-x-0"
          >
            <div className="glass-strong max-h-[min(70vh,520px)] overflow-y-auto rounded-2xl p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[13px] font-medium tracking-wide text-white">显示设置</h3>
                <button
                  onClick={closeSettings}
                  aria-label="关闭显示设置"
                  className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-nebula-200/60 transition hover:bg-white/10 hover:text-white"
                >
                  ✕
                </button>
              </div>

              <Section title="氛围">
                <SwitchRow label="银河" checked={showMilkyWay} onToggle={toggleMilkyWay} />
                <SwitchRow label="名称标签" checked={showLabels} onToggle={toggleLabels} />
                <SwitchRow label="星座" checked={showConstellations} onToggle={toggleConstellations} />
                <SwitchRow label="自动旋转" checked={autoRotate} onToggle={toggleAutoRotate} />
              </Section>

              <Section title="参考线">
                <SwitchRow
                  label="黄道与黄道宫"
                  hint="金色 · 太阳的路"
                  checked={showEcliptic}
                  onToggle={toggleEcliptic}
                />
                <SwitchRow
                  label="赤道与坐标网格"
                  hint="青色赤道 · 灰蓝网格"
                  checked={showEquatorGrid}
                  onToggle={toggleEquatorGrid}
                />
              </Section>

              <Section title="观测">
                <SwitchRow
                  label="地平线与晨昏"
                  hint="地平线大圆 · 方位标 · 昼夜光影"
                  checked={showHorizon}
                  onToggle={toggleHorizon}
                />
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-[12.5px] text-nebula-100/85">观测城市</span>
                  <select
                    value={city.id}
                    onChange={(e) => {
                      const c = CITIES.find((x) => x.id === e.target.value);
                      if (c) setCity(c);
                    }}
                    className="rounded-lg border border-white/10 bg-void/60 px-2 py-1 text-[12px] text-white focus:outline-none"
                  >
                    {CITIES.map((c) => (
                      <option key={c.id} value={c.id} className="bg-void text-white">
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </Section>

              <button
                onClick={() => {
                  closeSettings();
                  openCredits();
                }}
                className="mt-2 text-[11px] text-nebula-200/45 underline-offset-2 transition hover:text-nebula-200/80 hover:underline"
              >
                影像与数据来源
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 border-t border-white/5 pt-2 first:border-t-0 first:pt-0">
      <div className="mb-1 text-[10.5px] uppercase tracking-[0.22em] text-nebula-200/45">
        {title}
      </div>
      {children}
    </div>
  );
}

function SwitchRow({
  label,
  hint,
  checked,
  onToggle,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      role="switch"
      aria-checked={checked}
      className="flex w-full items-center justify-between py-1.5 text-left"
    >
      <span>
        <span className="text-[12.5px] text-nebula-100/85">{label}</span>
        {hint && <span className="ml-2 text-[10.5px] text-nebula-200/40">{hint}</span>}
      </span>
      <span
        className={`relative inline-block h-[18px] w-8 shrink-0 rounded-full transition ${
          checked ? 'bg-nebula-500/70' : 'bg-white/10'
        }`}
      >
        <span
          className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all ${
            checked ? 'left-[16px]' : 'left-[2px]'
          }`}
        />
      </span>
    </button>
  );
}
