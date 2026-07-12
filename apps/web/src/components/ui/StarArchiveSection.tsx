'use client';

import { derivePhysical, type CelestialObject } from '@star/astro-data';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { useMemo } from 'react';

/**
 * Gyr（十亿年）→ 中文可读量级。1 Gyr = 10 亿年；短寿命大质量星（O/B 型
 * 只有千万年量级）降到「万年」，避免出现「0.0 亿年」这类退化文案。
 */
function formatGyrZh(gyr: number): string {
  const yi = gyr * 10;
  if (yi >= 10) return `${Math.round(yi)} 亿`;
  if (yi >= 0.1) return `${yi.toFixed(1)} 亿`;
  return `${Math.max(1, Math.round(gyr * 1e5))} 万`;
}

/** 归宿徽章描边配色：质量档位决定（<8 白矮星金 / 8–20 中子星星云蓝 / >20 黑洞紫）。 */
function fateBadgeClass(massSolar: number | null): string {
  if (massSolar != null && massSolar > 20) return 'border-purple-400/45 text-purple-200';
  if (massSolar != null && massSolar >= 8) return 'border-nebula-400/50 text-nebula-200';
  return 'border-gold/45 text-gold';
}

// 冻结契约的 stage/fate 为机器枚举码（人类可读文案在 fateDesc）——徽章与描述行须经此表转中文
const STAGE_ZH: Record<string, string> = {
  main_sequence: '主序星',
  subgiant: '亚巨星',
  giant: '巨星',
  supergiant: '超巨星',
  white_dwarf: '白矮星',
};

const FATE_ZH: Record<string, string> = {
  white_dwarf: '白矮星',
  supernova_neutron_star: '超新星 · 中子星',
  supernova_black_hole: '超新星 · 黑洞',
};

/**
 * 天体档案分区（信息卡内嵌）：基于光谱型的科普估算——恒星生涯进度条、
 * 归宿徽章、光出发年份、可折叠的三条趣闻。
 *
 * 约束：
 *  - derivePhysical 为纯函数（@star/astro-data 冻结契约），仅在选中天体
 *    变化时计算，不进帧循环；
 *  - 无法推导（返回 null）时整个分区不渲染，卡片布局零占位；
 *  - 所有数字均为光谱型估算，分区脚注必须保留「非精确测量」声明。
 */
export function StarArchiveSection({
  obj,
  itemVariants,
}: {
  obj: CelestialObject;
  /** 由父卡片下发的 stagger 子项 variants，保证与其它分区同节奏入场。 */
  itemVariants: Variants;
}) {
  const reduce = useReducedMotion();
  const profile = useMemo(() => derivePhysical(obj), [obj]);
  if (!profile) return null;

  const { ageGyr, lifespanGyr, remainingGyr, massSolar, tempK } = profile;
  // 进度条比例：已存在 / 总寿命，钳制到 [0,1]（估算值可能越界）
  const ageFrac =
    ageGyr != null && lifespanGyr != null && lifespanGyr > 0
      ? Math.min(1, Math.max(0, ageGyr / lifespanGyr))
      : null;
  const restGyr =
    remainingGyr ?? (ageGyr != null && lifespanGyr != null ? lifespanGyr - ageGyr : null);

  return (
    <motion.div
      variants={itemVariants}
      className="mt-5 rounded-2xl border border-nebula-400/15 bg-white/[0.03] p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[12px] uppercase tracking-[0.22em] text-nebula-200/60">天体档案</span>
        {FATE_ZH[profile.fate] != null && (
          <span
            className={`rounded-full border px-2.5 py-0.5 text-[11px] ${fateBadgeClass(massSolar)}`}
          >
            归宿 · {FATE_ZH[profile.fate]}
          </span>
        )}
      </div>

      <p className="text-[13px] leading-relaxed text-nebula-100/85">
        {[
          STAGE_ZH[profile.stage],
          profile.colorDesc || null,
          tempK != null ? `表面约 ${Math.round(tempK).toLocaleString()} K` : null,
          massSolar != null ? `约 ${massSolar.toFixed(1)} 倍太阳质量` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      {profile.fateDesc && (
        <p className="mt-2 text-[12.5px] leading-relaxed text-nebula-200/70">{profile.fateDesc}</p>
      )}

      {ageFrac != null && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <motion.div
              className="h-full w-full rounded-full bg-gradient-to-r from-nebula-500 to-gold"
              style={{ originX: 0 }}
              initial={reduce ? false : { scaleX: 0 }}
              animate={{ scaleX: ageFrac }}
              transition={
                reduce ? { duration: 0 } : { duration: 0.9, delay: 0.35, ease: 'easeOut' }
              }
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-nebula-200/55">
            {ageGyr != null && <span>已燃烧约 {formatGyrZh(ageGyr)}年</span>}
            {restGyr != null && restGyr > 0 && (
              <span>还将燃烧约 {formatGyrZh(restGyr)}年（光谱型估算）</span>
            )}
          </div>
        </div>
      )}

      {profile.lightDepartYear != null && (
        <p className="mt-3 text-[13px] leading-relaxed text-gold/90">
          你现在看到的光，出发于
          {profile.lightDepartYear > 0
            ? `公元 ${profile.lightDepartYear} 年`
            : `公元前 ${Math.abs(profile.lightDepartYear)} 年`}
        </p>
      )}

      {profile.funFacts.length > 0 && (
        <details className="group mt-3">
          <summary className="cursor-pointer list-none text-[12.5px] text-nebula-200/70 transition hover:text-white">
            ✦ 三件小事
            <span className="ml-1 inline-block transition group-open:rotate-90">›</span>
          </summary>
          <ul className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-nebula-100/80">
            {profile.funFacts.slice(0, 3).map((fact: string) => (
              <li key={fact} className="flex gap-2">
                <span className="shrink-0 text-nebula-400/70">·</span>
                <span>{fact}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="mt-3 text-[10.5px] text-nebula-200/40">
        以上为基于光谱型的科普估算，非精确测量
      </p>
    </motion.div>
  );
}
