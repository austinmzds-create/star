'use client';

import {
  CONSTELLATION_ABBR,
  DEEP_SKY_CATALOG,
  FULL_CATALOG,
  getCelestialByUid,
  type CelestialObject,
} from '@star/astro-data';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { useMemo } from 'react';
import { constellationArtUrl, hasConstellationArt } from '@/lib/constellation-art';
import { exits, springs, stagger } from '@/lib/motionTokens';
import { getConstellationArea } from '@/lib/constellation-area';
import { CONSTELLATION_LORE } from '@/lib/constellation-lore';
import { getDailyFortune, type DailyFortune } from '@/lib/fortune';
import { kindLabelZh } from '@/lib/objectPresenter';
import { useUniverse } from '@/lib/store';
import { ZODIAC_INFO, type ZodiacInfo } from '@/lib/zodiac';

/**
 * 星座信息（Phase 7 升级为双形态，同一文件两个渲染分支）：
 *  - 右侧富面板：点击天区就近命中（focusedConstellation）后滑出——神话、
 *    艺术图、最亮星/深空天体（可点飞往）、最佳观测季节、面积排名；
 *    黄道 12 座追加占星分区（今日运势，确定性生成，显著标注仅供娱乐）。
 *  - 左下小卡：注视/搜索点亮（activeConstellation）时的轻提示，富面板
 *    打开时让位（!focusedConstellation）。
 *
 * 互斥纪律：selectedUid 非空 → StarInfoCard 优先，富面板隐藏但
 * focusedConstellation 保留（关掉天体卡即回到面板，见 store 注释）。
 * 合规红线：星座不可命名；全卡无购买入口、无官方命名/产权措辞；
 * 占星内容必须标注「仅供娱乐，非科学结论」。
 * 遮罩纪律：玻璃背景只出现在卡片圆角矩形内，禁止任何 inset-0 暗化层。
 */
export function ConstellationInfoCard() {
  return (
    <>
      <ConstellationRichPanel />
      <GazeHintCard />
    </>
  );
}

// ── 分区入场动画（与 StarInfoCard 同一套 tokens 节奏；reduced-motion 由
// 全局 MotionConfig 接管：x/y 位移自动禁用、opacity 保留，不再本地分支） ──

const panelVariants: Variants = {
  hidden: { x: '110%', opacity: 0 },
  show: {
    x: 0,
    opacity: 1,
    transition: {
      ...springs.modal,
      when: 'beforeChildren',
      staggerChildren: stagger.item,
      delayChildren: 0.04,
    },
  },
  exit: { x: '110%', opacity: 0, transition: exits.base },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: springs.chip },
};

/** 质心 RA（圆均值）→ 晚 9 点前后中天的月份（1–12）。 */
function bestViewingMonth(stars: CelestialObject[]): number {
  let sx = 0;
  let sy = 0;
  // 单位向量求和取圆均值，规避 RA 跨 0°/360°（如双鱼、仙女）直接平均的错误。
  for (const s of stars) {
    const r = (s.raDeg * Math.PI) / 180;
    sx += Math.cos(r);
    sy += Math.sin(r);
  }
  const raDeg = stars.length > 0 ? ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360 : 0;
  return ((Math.round(raDeg / 30) + 9) % 12) + 1;
}

/** 月份 → 中文季节。 */
function seasonOf(month: number): string {
  if (month === 12 || month <= 2) return '冬季';
  if (month <= 5) return '春季';
  if (month <= 8) return '夏季';
  return '秋季';
}

// ── 右侧富面板 ──

function ConstellationRichPanel() {
  const show = useUniverse((s) => s.showConstellations);
  const abbr = useUniverse((s) => s.focusedConstellation);
  const selectedUid = useUniverse((s) => s.selectedUid);
  const focusStar = useUniverse((s) => s.focusStar);
  const closePanel = useUniverse((s) => s.closeConstellationPanel);

  const meta = abbr ? CONSTELLATION_ABBR[abbr] : undefined;
  const lore = abbr ? CONSTELLATION_LORE[abbr] : undefined;
  const zodiac = abbr ? ZODIAC_INFO[abbr] : undefined;

  // 座内检索/排序仅在切换星座时执行一次（全表 ~9500 行线性扫 <1ms）。
  const derived = useMemo(() => {
    if (!abbr || !meta) return null;
    const stars = FULL_CATALOG.filter((o) => o.type === 'star' && o.constellation === meta.en);
    const brightest = [...stars].sort((a, b) => a.magnitude - b.magnitude).slice(0, 5);
    const dsos = DEEP_SKY_CATALOG.filter((o) => o.constellation === meta.en)
      .sort((a, b) => Number(b.isFeatured) - Number(a.isFeatured) || a.magnitude - b.magnitude)
      .slice(0, 4);
    return {
      brightest,
      dsos,
      bestMonth: bestViewingMonth(stars),
      area: getConstellationArea(abbr),
    };
  }, [abbr, meta]);

  // 互斥：天体卡优先（focusedConstellation 保留，关卡即回）。
  const open = show && !!abbr && !selectedUid && !!meta && !!derived;

  // 定位两层化（Phase 8，与 StarInfoCard 同款修复）：panel variants 动画 x，
  // framer-motion 会整体接管 motion 元素的 style.transform，若定位层自己带
  // -translate-y-1/2 会被覆盖导致面板下坠半屏——定位（外层纯 CSS flex 居中、
  // 常驻挂载）与动画（内层 motion.aside）必须分层。外层 pointer-events-none
  // 保证空载时对 canvas 零干扰；max-h 用 dvh 修移动端地址栏抖动。
  return (
    <div className="pointer-events-none absolute inset-y-0 right-5 z-30 flex w-[min(92vw,400px)] items-center">
      <AnimatePresence>
        {open && (
          <motion.aside
            key={abbr}
            variants={panelVariants}
            initial="hidden"
            animate="show"
            exit="exit"
            className="pointer-events-auto w-full"
          >
            <div className="glass-strong card-scroll max-h-[min(82dvh,calc(100dvh-7rem))] overflow-y-auto overscroll-contain rounded-3xl p-6">
              {/* 头部 */}
              <motion.div variants={itemVariants} className="flex items-start justify-between">
                <div>
                  <h2 className="text-2xl font-semibold text-white">{meta.zh}</h2>
                  <div className="mt-1 text-[13px] tracking-wide text-nebula-200/70">
                    {meta.en} · {abbr}
                  </div>
                </div>
                <button
                  onClick={closePanel}
                  className="rounded-full border border-white/10 px-2 py-0.5 text-nebula-200/60 transition hover:bg-white/10 hover:text-white"
                  aria-label="关闭星座面板"
                >
                  ✕
                </button>
              </motion.div>

              {/* 艺术图卡（20 幅自绘 SVG 之一才有） */}
              {abbr && hasConstellationArt(abbr) && (
                <motion.div
                  variants={itemVariants}
                  className="mt-4 overflow-hidden rounded-2xl bg-white/[0.03]"
                >
                  <img
                    src={constellationArtUrl(abbr)}
                    alt={`${meta.zh}艺术形象（本项目原创绘制）`}
                    loading="lazy"
                    className="aspect-square w-full object-contain"
                  />
                </motion.div>
              )}

              {/* 神话看点 */}
              {lore && (
                <motion.p
                  variants={itemVariants}
                  className="mt-4 text-[13.5px] leading-relaxed text-nebula-100/85"
                >
                  {lore.loreZh}
                </motion.p>
              )}

              {/* 最亮星（点击飞往；selectedUid 置位后天体卡自动接管） */}
              {derived.brightest.length > 0 && (
                <motion.div variants={itemVariants} className="mt-5">
                  <SectionTitle>最亮的星 · 点击飞往</SectionTitle>
                  <div className="mt-2 space-y-1">
                    {derived.brightest.map((s) => (
                      <ObjectRow
                        key={s.objectUid}
                        onClick={() => focusStar(s.objectUid)}
                        name={s.nameZh}
                        sub={s.bayer ?? s.nameEn}
                        right={`${s.magnitude.toFixed(1)} 等`}
                      />
                    ))}
                  </div>
                </motion.div>
              )}

              {/* 座内深空天体（著名优先） */}
              {derived.dsos.length > 0 && (
                <motion.div variants={itemVariants} className="mt-5">
                  <SectionTitle>深空天体</SectionTitle>
                  <div className="mt-2 space-y-1">
                    {derived.dsos.map((d) => (
                      <ObjectRow
                        key={d.objectUid}
                        onClick={() => focusStar(d.objectUid)}
                        name={d.commonNameZh ?? d.nameZh}
                        sub={`${kindLabelZh(d)} · ${d.nameZh}`}
                        right={`${d.magnitude.toFixed(1)} 等`}
                      />
                    ))}
                  </div>
                </motion.div>
              )}

              {/* 最佳观测 + 面积排名 */}
              <motion.div variants={itemVariants} className="mt-5 grid grid-cols-1 gap-2">
                <div className="rounded-xl bg-white/[0.03] px-3 py-2.5">
                  <div className="text-[11px] text-nebula-200/50">最佳观测</div>
                  <div className="mt-0.5 text-[13.5px] text-white">
                    每年 {derived.bestMonth} 月前后的晚上看它最合适 · {seasonOf(derived.bestMonth)}
                    星座
                  </div>
                </div>
                {derived.area && (
                  <div className="rounded-xl bg-white/[0.03] px-3 py-2.5">
                    <div className="text-[11px] text-nebula-200/50">天区面积</div>
                    <div className="mt-0.5 text-[13.5px] text-white">
                      全天第 {derived.area.rank} 大 · 约 {Math.round(derived.area.areaSqDeg)} 平方度
                    </div>
                  </div>
                )}
              </motion.div>

              {/* 黄道 12 座专属：占星分区（非黄道座无此分区） */}
              {abbr && zodiac && (
                <motion.div variants={itemVariants}>
                  <ZodiacFortuneSection abbr={abbr} zodiac={zodiac} />
                </motion.div>
              )}

              <motion.p
                variants={itemVariants}
                className="mt-4 text-[10.5px] leading-relaxed text-nebula-200/40"
              >
                星座为国际通用天区划分，不涉及任何命名或产权含义
              </motion.p>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[12px] uppercase tracking-[0.22em] text-nebula-200/60">{children}</div>
  );
}

/** 面板内可点天体行：名称 + 次级说明 + 右侧星等。 */
function ObjectRow({
  name,
  sub,
  right,
  onClick,
}: {
  name: string;
  sub: string;
  right: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.96 }}
      transition={springs.chip}
      onClick={onClick}
      className="tap-96 flex w-full items-baseline justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2 text-left transition hover:bg-white/[0.08]"
    >
      <span className="min-w-0">
        <span className="text-[13.5px] text-white">{name}</span>
        <span className="ml-2 text-[11.5px] text-nebula-200/55">{sub}</span>
      </span>
      <span className="shrink-0 text-[11.5px] text-nebula-200/60">{right}</span>
    </motion.button>
  );
}

// ── 占星分区（仅黄道 12 座；合规：显著标注仅供娱乐） ──

const FORTUNE_LABELS: { key: keyof DailyFortune; label: string }[] = [
  { key: 'overall', label: '整体' },
  { key: 'love', label: '爱情' },
  { key: 'career', label: '事业' },
  { key: 'health', label: '健康' },
];

/** 星级 → ★★★☆☆（stars 由生成器保证 1–5）。 */
function starsText(n: number): string {
  const c = Math.min(5, Math.max(1, Math.round(n)));
  return '★'.repeat(c) + '☆'.repeat(5 - c);
}

function ZodiacFortuneSection({ abbr, zodiac }: { abbr: string; zodiac: ZodiacInfo }) {
  // 确定性运势：同日同座恒等（种子 YYYYMMDD+缩写）。面板常在午夜前后
  // 不会长开，按挂载时刻取「今天」即可，不做跨午夜心跳。
  const fortune = useMemo(() => getDailyFortune(abbr), [abbr]);

  return (
    <div className="mt-5 rounded-2xl border border-nebula-400/15 bg-white/[0.03] p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] uppercase tracking-[0.22em] text-nebula-200/60">今日星运</span>
        <span className="text-[11px] text-gold/80">✦ 仅供娱乐</span>
      </div>

      {/* 生日段 / 守护星 / 元素 / 幸运色 / 幸运数 */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-[12.5px]">
        <ZodiacFact label="生日段" value={zodiac.dates} />
        <ZodiacFact label="守护星" value={zodiac.ruler} />
        <ZodiacFact label="元素" value={`${zodiac.element}象`} />
        <ZodiacFact label="幸运数字" value={String(zodiac.luckyNumber)} />
        <div className="col-span-2 flex items-center justify-between rounded-lg bg-white/[0.03] px-2.5 py-1.5">
          <span className="text-nebula-200/50">幸运色</span>
          <span className="flex items-center gap-2 text-white">
            <span
              className="inline-block h-3 w-3 rounded-full border border-white/20"
              style={{ backgroundColor: zodiac.colorHex }}
              aria-hidden
            />
            {zodiac.colorName}
          </span>
        </div>
      </div>

      {/* 性格关键词 */}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {zodiac.keywords.map((k) => (
          <span
            key={k}
            className="rounded-full border border-nebula-400/25 bg-white/5 px-2 py-0.5 text-[11.5px] text-nebula-100"
          >
            {k}
          </span>
        ))}
      </div>

      {/* 四行运势：标签 + 星级 + 文案 */}
      <div className="mt-3 space-y-2.5">
        {FORTUNE_LABELS.map(({ key, label }) => {
          const line = fortune[key];
          return (
            <div key={key}>
              <div className="flex items-baseline justify-between">
                <span className="text-[12px] text-nebula-200/70">{label}</span>
                <span className="text-[12px] tracking-[0.15em] text-gold/90">
                  {starsText(line.stars)}
                </span>
              </div>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-nebula-100/85">{line.text}</p>
            </div>
          );
        })}
      </div>

      <p className="mt-3 border-t border-white/10 pt-2.5 text-center text-[11px] text-gold/70">
        占星内容仅供娱乐，非科学结论
      </p>
    </div>
  );
}

function ZodiacFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between rounded-lg bg-white/[0.03] px-2.5 py-1.5">
      <span className="text-nebula-200/50">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  );
}

// ── 左下注视小卡（原信息卡降级形态：富面板打开时让位） ──

function GazeHintCard() {
  const show = useUniverse((s) => s.showConstellations);
  const abbr = useUniverse((s) => s.activeConstellation);
  const focused = useUniverse((s) => s.focusedConstellation);
  const focusStar = useUniverse((s) => s.focusStar);
  const selectConstellation = useUniverse((s) => s.selectConstellation);

  const meta = abbr ? CONSTELLATION_ABBR[abbr] : undefined;
  const lore = abbr ? CONSTELLATION_LORE[abbr] : undefined;
  const art = abbr ? hasConstellationArt(abbr) : false;
  // uid 在目录中可查才渲染为可点击（防御 lore 数据漂移）。
  const brightestUid =
    lore?.brightestUid && getCelestialByUid(lore.brightestUid) ? lore.brightestUid : undefined;

  return (
    <AnimatePresence>
      {show && abbr && meta && !focused && (
        <motion.aside
          key={abbr}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 14, transition: exits.base }}
          transition={springs.chip}
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
                <p className="mt-2 text-[13px] leading-relaxed text-nebula-100/80">{lore.loreZh}</p>
              </>
            )}

            {/* 富面板入口：连线附近常被暗星抢占点击，卡上必须有确定入口 */}
            <motion.button
              whileTap={{ scale: 0.96 }}
              transition={springs.chip}
              onClick={() => selectConstellation(abbr)}
              className="tap-96 mt-2.5 w-full rounded-lg bg-white/[0.06] px-3 py-1.5 text-[12px] text-nebula-100 transition hover:bg-white/[0.12] hover:text-white"
            >
              查看完整档案 →
            </motion.button>

            <p className="mt-3 text-[10.5px] leading-relaxed text-nebula-200/40">
              星座为国际通用天区划分，不涉及任何命名或产权含义
            </p>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
