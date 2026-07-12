'use client';

import { derivePhysical, type CelestialObject, type PhysicalProfile } from '@star/astro-data';
import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { DSO_LORE } from '@/lib/dso-lore';
import { primaryBadgeZh } from '@/lib/objectPresenter';
import { getObjectByUid } from '@/lib/solarSystem';
import { useUniverse } from '@/lib/store';
import { DsoArtPane } from './DsoArtPane';
import { PhotoPane } from './PhotoPane';
import { StarPane3D } from './StarPane3D';

/**
 * 全天体查看器模态（恒星 / 深空天体；星历天体在 openObjectViewer 已转发到
 * PlanetViewerModal，不会到此）。布局照 PlanetViewerModal：桌面左视觉区
 * flex-1 + 右 320px 玻璃侧栏；移动端视觉区 60vh + 下滑动区。
 *
 * 视觉区分派（getObjectByUid(objectViewerUid)）：
 *   imageKey → PhotoPane（真实照片）；type==='star' → StarPane3D（独立 R3F）；
 *   其余 DSO → DsoArtPane（程序化艺术图）。
 *
 * z 序：z-50 < 红光 z-[90]，body 级 multiply 护眼滤镜天然生效。
 * 关闭：✕ / Esc / 点遮罩；打开期锁 body overflow（照 PhotoLightbox）。
 * 主场景不暂停（与 PlanetViewerModal 现状一致）。
 */

// —— 恒星档案文案映射（与 StarArchiveSection 同表；那边未导出，此处保持一致） ——

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

/** Gyr → 中文可读量级（与 StarArchiveSection.formatGyrZh 一致）。 */
function formatGyrZh(gyr: number): string {
  const yi = gyr * 10;
  if (yi >= 10) return `${Math.round(yi)} 亿`;
  if (yi >= 0.1) return `${yi.toFixed(1)} 亿`;
  return `${Math.max(1, Math.round(gyr * 1e5))} 万`;
}

/** 倍太阳量（质量/半径/光度）→ 可读文本：大数取整，小数留 1–2 位。 */
function formatSolarTimes(v: number): string {
  if (v >= 100) return Math.round(v).toLocaleString('zh-CN');
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function FactCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.03] px-3 py-2">
      <div className="text-[11px] text-nebula-200/50">{label}</div>
      <div className="mt-0.5 text-[14px] text-white">{value}</div>
    </div>
  );
}

/** 恒星侧栏档案：物理量 FactCell 网格 + colorDesc + funFacts + 估算脚注。 */
function StarProfileSection({ profile }: { profile: PhysicalProfile }) {
  const facts: Array<{ label: string; value: string }> = [];
  if (profile.tempK != null)
    facts.push({ label: '表面温度', value: `${Math.round(profile.tempK).toLocaleString('zh-CN')} K` });
  if (profile.radiusSolar != null)
    facts.push({ label: '半径', value: `${formatSolarTimes(profile.radiusSolar)} 倍太阳` });
  if (profile.massSolar != null)
    facts.push({ label: '质量', value: `${formatSolarTimes(profile.massSolar)} 倍太阳` });
  if (profile.luminositySolar != null)
    facts.push({ label: '光度', value: `${formatSolarTimes(profile.luminositySolar)} 倍太阳` });
  if (profile.ageGyr != null)
    facts.push({ label: '年龄', value: `约 ${formatGyrZh(profile.ageGyr)}年` });
  if (profile.lifespanGyr != null)
    facts.push({ label: '预期寿命', value: `约 ${formatGyrZh(profile.lifespanGyr)}年` });

  return (
    <>
      {facts.length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-3">
          {facts.map((f) => (
            <FactCell key={f.label} label={f.label} value={f.value} />
          ))}
        </div>
      )}

      {profile.colorDesc && (
        <p className="mt-4 text-[13px] leading-relaxed text-nebula-100/80">
          色彩印象：{profile.colorDesc}
        </p>
      )}

      {profile.funFacts.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-[12.5px] leading-relaxed text-nebula-100/80">
          {profile.funFacts.slice(0, 3).map((fact) => (
            <li key={fact} className="flex gap-2">
              <span className="shrink-0 text-nebula-400/70">·</span>
              <span>{fact}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[10.5px] text-nebula-200/40">基于光谱型估算，非精确测量</p>
    </>
  );
}

/** DSO 侧栏档案：命运一句话 + 趣闻（照片天体另有长文，走 LoreSection）。 */
function DsoProfileSection({ profile }: { profile: PhysicalProfile }) {
  return (
    <>
      {profile.fateDesc && (
        <p className="mt-4 text-[12.5px] leading-relaxed text-nebula-200/70">{profile.fateDesc}</p>
      )}
      {profile.funFacts.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-[12.5px] leading-relaxed text-nebula-100/80">
          {profile.funFacts.slice(0, 4).map((fact) => (
            <li key={fact} className="flex gap-2">
              <span className="shrink-0 text-nebula-400/70">·</span>
              <span>{fact}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function ObjectViewerModal() {
  const uid = useUniverse((s) => s.objectViewerUid);
  const close = useUniverse((s) => s.closeObjectViewer);
  const [hintVisible, setHintVisible] = useState(true);

  const obj: CelestialObject | undefined = uid ? getObjectByUid(uid) : undefined;
  const profile = useMemo(() => (obj ? derivePhysical(obj) : null), [obj]);

  // Esc 关闭 + 打开期锁 body 滚动（照 PhotoLightbox）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [close]);

  // 恒星 3D 操作提示 3s 后淡出
  useEffect(() => {
    const id = window.setTimeout(() => setHintVisible(false), 3000);
    return () => window.clearTimeout(id);
  }, []);

  if (!uid || !obj) return null;

  const isStar = obj.type === 'star';
  const loreZh = obj.imageKey ? DSO_LORE[uid] : undefined;
  const badge = primaryBadgeZh(obj);
  const stageZh = profile ? STAGE_ZH[profile.stage] : undefined;
  const fateZh = profile ? FATE_ZH[profile.fate] : undefined;

  return (
    <motion.div
      className="fixed inset-0 z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* 遮罩：点空白关闭 */}
      <div className="absolute inset-0 bg-void/80 backdrop-blur-md" onClick={close} />

      <motion.div
        className="relative z-10 flex h-full w-full flex-col md:flex-row"
        initial={{ scale: 0.96 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.96 }}
        transition={{ duration: 0.25 }}
      >
        {/* 视觉区：照片 / 恒星 3D / 程序化艺术图 */}
        <div className="relative h-[60vh] w-full md:h-full md:min-w-0 md:flex-1">
          {obj.imageKey ? (
            <PhotoPane obj={obj} />
          ) : isStar ? (
            <StarPane3D obj={obj} />
          ) : (
            <DsoArtPane obj={obj} />
          )}

          {/* 恒星 3D 操作提示（3s 淡出） */}
          {isStar && !obj.imageKey && (
            <div
              className={`pointer-events-none absolute bottom-4 left-5 text-[12px] tracking-wide text-nebula-200/60 transition-opacity duration-700 ${
                hintVisible ? 'opacity-100' : 'opacity-0'
              }`}
            >
              拖拽旋转 · 滚轮缩放
            </div>
          )}
        </div>

        {/* 参数侧栏 */}
        <aside className="glass-strong relative min-h-0 flex-1 overflow-y-auto p-6 md:h-full md:w-[320px] md:flex-none md:rounded-none">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-white">{obj.nameZh}</h2>
              <div className="mt-1 text-[13px] tracking-wide text-nebula-200/70">{obj.nameEn}</div>
            </div>
            <button
              onClick={close}
              className="rounded-full border border-white/10 px-2 py-0.5 text-nebula-200/60 transition hover:bg-white/10 hover:text-white"
              aria-label="关闭查看器"
            >
              ✕
            </button>
          </div>

          {/* 徽章行：类型（恒星显星座）+ 演化阶段 + 归宿 */}
          <div className="mt-3 flex flex-wrap gap-2">
            {(badge ?? obj.constellationZh) && (
              <span className="rounded-full border border-nebula-400/25 bg-white/5 px-2.5 py-0.5 text-[12px] text-nebula-100">
                {badge ?? `${obj.constellationZh} · 恒星`}
              </span>
            )}
            {stageZh && (
              <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[12px] text-nebula-100/85">
                {stageZh}
              </span>
            )}
            {fateZh && (
              <span className="rounded-full border border-gold/40 bg-white/5 px-2.5 py-0.5 text-[12px] text-gold">
                归宿 · {fateZh}
              </span>
            )}
          </div>

          {obj.descriptionZh && (
            <p className="mt-4 text-[13.5px] leading-relaxed text-nebula-100/85">
              {obj.descriptionZh}
            </p>
          )}

          {/* 类型分区：恒星档案 / DSO 长文 / DSO 档案 */}
          {isStar && profile ? (
            <StarProfileSection profile={profile} />
          ) : loreZh ? (
            <div className="mt-4">
              <p className="max-h-[38vh] overflow-y-auto whitespace-pre-line text-[13px] leading-relaxed text-nebula-100/85 md:max-h-none">
                {loreZh}
              </p>
              {obj.imageCredit && (
                <p className="mt-3 text-[10.5px] text-nebula-200/40">影像：{obj.imageCredit}</p>
              )}
            </div>
          ) : profile ? (
            <DsoProfileSection profile={profile} />
          ) : null}

          {/* 带照片但长文缺失时的署名兜底 */}
          {!loreZh && obj.imageKey && obj.imageCredit && (
            <p className="mt-3 text-[10.5px] text-nebula-200/40">影像：{obj.imageCredit}</p>
          )}

          <p className="mt-6 text-[11px] leading-relaxed text-nebula-200/45">
            私人纪念命名登记，不代表 IAU 或任何官方天文机构命名。
          </p>
        </aside>
      </motion.div>
    </motion.div>
  );
}
