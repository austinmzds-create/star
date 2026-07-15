'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import {
  setAmbientVolume as setAmbientVolumeEngine,
  startAmbient,
  stopAmbient,
} from '@/lib/audioEngine';
import { CITIES } from '@/lib/cities';
import { exits, springs } from '@/lib/motionTokens';
import { promptInstall, subscribeInstallable } from '@/lib/pwaInstall';
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

  // 真实天空 + 行星放大（Phase 10）
  const skyRealism = useUniverse((s) => s.skyRealism);
  const lightPollution = useUniverse((s) => s.lightPollution);
  const setSkyRealism = useUniverse((s) => s.setSkyRealism);
  const setLightPollution = useUniverse((s) => s.setLightPollution);
  const planetsEnlarged = useUniverse((s) => s.planetsEnlarged);
  const togglePlanetsEnlarged = useUniverse((s) => s.togglePlanetsEnlarged);

  const showMilkyWay = useUniverse((s) => s.showMilkyWay);
  const showLabels = useUniverse((s) => s.showLabels);
  const showConstellations = useUniverse((s) => s.showConstellations);
  const autoRotate = useUniverse((s) => s.autoRotate);
  const showEcliptic = useUniverse((s) => s.showEcliptic);
  const showEquatorGrid = useUniverse((s) => s.showEquatorGrid);
  const showHorizon = useUniverse((s) => s.showHorizon);
  const showPlanetTrails = useUniverse((s) => s.showPlanetTrails);
  const showSatellites = useUniverse((s) => s.showSatellites);
  const showStarlink = useUniverse((s) => s.showStarlink);
  const showMinorBodies = useUniverse((s) => s.showMinorBodies);
  // 注：planetsEnlarged/togglePlanetsEnlarged 选择器在上方「真实天空」区已声明
  // （跨域契约 §1，字段归「真实天空」域）；本处「行星放大」开关 UI 归「视觉炫酷」域。
  const city = useUniverse((s) => s.city);

  const toggleMilkyWay = useUniverse((s) => s.toggleMilkyWay);
  const toggleLabels = useUniverse((s) => s.toggleLabels);
  const toggleConstellations = useUniverse((s) => s.toggleConstellations);
  const toggleAutoRotate = useUniverse((s) => s.toggleAutoRotate);
  const toggleEcliptic = useUniverse((s) => s.toggleEcliptic);
  const toggleEquatorGrid = useUniverse((s) => s.toggleEquatorGrid);
  const toggleHorizon = useUniverse((s) => s.toggleHorizon);
  const togglePlanetTrails = useUniverse((s) => s.togglePlanetTrails);
  const toggleSatellites = useUniverse((s) => s.toggleSatellites);
  const toggleStarlink = useUniverse((s) => s.toggleStarlink);
  const toggleMinorBodies = useUniverse((s) => s.toggleMinorBodies);
  const setCity = useUniverse((s) => s.setCity);

  // ── 体验层（Phase 6B：红光/环境音/PWA 安装） ──
  const redLightOn = useUniverse((s) => s.redLightOn);
  const ambientOn = useUniverse((s) => s.ambientOn);
  const ambientVolume = useUniverse((s) => s.ambientVolume);
  const toggleRedLight = useUniverse((s) => s.toggleRedLight);
  const setAmbientOn = useUniverse((s) => s.setAmbientOn);
  const setAmbientVolume = useUniverse((s) => s.setAmbientVolume);

  /** 点击开关本身就是用户手势，AudioContext 在此合法启动。 */
  const handleAmbientToggle = () => {
    const next = !ambientOn;
    setAmbientOn(next);
    if (next) startAmbient(ambientVolume);
    else stopAmbient();
  };

  // PWA 可安装状态（beforeinstallprompt 截留后为 true；iOS 无此事件自然隐藏）
  const [installable, setInstallable] = useState(false);
  useEffect(() => subscribeInstallable(setInstallable), []);

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
            exit={{ opacity: 0, y: 12, transition: exits.fast }}
            transition={springs.panel}
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

              <Section title="真实天空">
                {/* 四段档：全部星 = skyRealism 'all'；城市/郊区/荒野 = 'naked' + 光污染档
                  （契约两字段冻结，UI 合并为一个直觉分段控件） */}
                <RealSkySegments
                  current={skyRealism === 'all' ? 'all' : lightPollution}
                  onSelect={(key) => {
                    if (key === 'all') setSkyRealism('all');
                    else {
                      setSkyRealism('naked');
                      setLightPollution(key);
                    }
                  }}
                />
              </Section>

              <Section title="氛围">
                <SwitchRow label="银河" checked={showMilkyWay} onToggle={toggleMilkyWay} />
                <SwitchRow label="名称标签" checked={showLabels} onToggle={toggleLabels} />
                <SwitchRow
                  label="星座"
                  checked={showConstellations}
                  onToggle={toggleConstellations}
                />
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
                <SwitchRow
                  label="行星轨迹"
                  hint="选中行星时 · 过去与未来的天空路径"
                  checked={showPlanetTrails}
                  onToggle={togglePlanetTrails}
                />
              </Section>

              <Section title="动态天体">
                <SwitchRow
                  label="著名卫星"
                  hint="ISS/天宫/哈勃 · 演示精度"
                  checked={showSatellites}
                  onToggle={toggleSatellites}
                />
                <SwitchRow
                  label="星链 Starlink"
                  hint="站在地球上看 · 过境光点"
                  checked={showStarlink}
                  onToggle={toggleStarlink}
                />
                <SwitchRow
                  label="小行星与彗星"
                  hint="谷神星等 · 演示级 ±0.5°"
                  checked={showMinorBodies}
                  onToggle={toggleMinorBodies}
                />
                <SwitchRow
                  label="行星放大"
                  hint="暗行星也一眼可见"
                  checked={planetsEnlarged}
                  onToggle={togglePlanetsEnlarged}
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

              <Section title="体验">
                <SwitchRow
                  label="红光护眼"
                  hint="保护夜间暗适应"
                  checked={redLightOn}
                  onToggle={toggleRedLight}
                />
                <SwitchRow
                  label="环境音"
                  hint="程序生成 · 极低音量"
                  checked={ambientOn}
                  onToggle={handleAmbientToggle}
                />
                {ambientOn && (
                  <div className="flex items-center gap-3 py-1.5">
                    <span className="text-[11px] text-nebula-200/50">音量</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={ambientVolume}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setAmbientVolume(v);
                        setAmbientVolumeEngine(v);
                      }}
                      className="h-1 flex-1 accent-nebula-400"
                      aria-label="环境音音量"
                    />
                  </div>
                )}
              </Section>

              <div className="mt-2 flex items-center justify-between">
                <button
                  onClick={() => {
                    closeSettings();
                    openCredits();
                  }}
                  className="text-[11px] text-nebula-200/45 underline-offset-2 transition hover:text-nebula-200/80 hover:underline"
                >
                  影像与数据来源
                </button>
                {installable && (
                  <button
                    onClick={() => void promptInstall()}
                    className="rounded-lg border border-nebula-400/25 bg-white/[0.04] px-2.5 py-1 text-[11px] text-nebula-100/85 transition hover:bg-white/[0.08]"
                  >
                    ⤓ 安装到桌面
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** 真实天空四段档 key（'all' + 三个光污染档）。 */
type RealSkyKey = 'all' | 'city' | 'suburb' | 'wild';

const REAL_SKY_OPTIONS: Array<{ key: RealSkyKey; label: string; hint: string }> = [
  { key: 'all', label: '全部星', hint: '满天繁星 · 纪念的浪漫底色' },
  { key: 'city', label: '城市', hint: '≈4.0 等 · 城区灯下能见的亮星' },
  { key: 'suburb', label: '郊区', hint: '≈6.0 等 · 郊野裸眼极限' },
  { key: 'wild', label: '荒野', hint: '≈6.5 等 · 无光害的星空' },
];

/** 真实天空分段控件：四枚 pill 横排，选中态 bg-nebula-500/70，带当前档副文案。 */
function RealSkySegments({
  current,
  onSelect,
}: {
  current: RealSkyKey;
  onSelect: (key: RealSkyKey) => void;
}) {
  const active = REAL_SKY_OPTIONS.find((o) => o.key === current) ?? REAL_SKY_OPTIONS[0]!;
  return (
    <div className="py-1.5">
      <div className="flex gap-1">
        {REAL_SKY_OPTIONS.map((o) => (
          <button
            key={o.key}
            onClick={() => onSelect(o.key)}
            aria-pressed={o.key === current}
            className={`flex-1 rounded-lg px-1 py-1.5 text-[12px] transition ${
              o.key === current
                ? 'bg-nebula-500/70 text-white'
                : 'bg-white/5 text-nebula-200/60 hover:bg-white/10'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="mt-1.5 text-[10.5px] text-nebula-200/45">{active.hint}</div>
    </div>
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
        {/* 拨钮走 chip token（r-fx §3.d）：x 位移 spring，替代 CSS left 过渡 */}
        <motion.span
          animate={{ x: checked ? 14 : 0 }}
          transition={springs.chip}
          className="absolute left-[2px] top-[2px] h-[14px] w-[14px] rounded-full bg-white"
        />
      </span>
    </button>
  );
}
