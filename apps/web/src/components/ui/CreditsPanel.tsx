'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useUniverse } from '@/lib/store';

/**
 * 「影像与数据来源」致谢面板（宇宙 V3 许可合规要求）。
 *
 * 入口：左下角小链接 + DisplaySettings 面板底部链接（开合状态在 store，
 * creditsOpen/openCredits/closeCredits）；面板内容来自 public/credits.json（由
 * scripts/fetch-assets.mjs 随资产下载生成，登记每个文件的来源 URL、
 * 许可与作者）。credits.json 缺失/解析失败时回退为静态署名文案 ——
 * CC-BY 素材（Gaia/ESO/Solar System Scope）的署名义务不能因网络失败而丢。
 */

/** credits.json 单条资产（字段名做宽容归一，兼容脚本演进）。 */
interface CreditEntry {
  title: string;
  author?: string;
  license?: string;
  sourceUrl?: string;
}

/** 宽容解析：接受数组或 { assets|entries|credits: [...] }，字段名多备选。 */
function normalizeCredits(data: unknown): CreditEntry[] {
  const container = data as Record<string, unknown> | unknown[] | null;
  const rawList: unknown[] = Array.isArray(container)
    ? container
    : container && typeof container === 'object'
      ? ((container as Record<string, unknown>).assets as unknown[] | undefined) ??
        ((container as Record<string, unknown>).entries as unknown[] | undefined) ??
        ((container as Record<string, unknown>).credits as unknown[] | undefined) ??
        []
      : [];
  const entries: CreditEntry[] = [];
  for (const raw of rawList) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const pick = (...keys: string[]): string | undefined => {
      for (const k of keys) {
        const v = r[k];
        if (typeof v === 'string' && v.trim() !== '') return v;
      }
      return undefined;
    };
    const title = pick('title', 'titleZh', 'name', 'file', 'path', 'id');
    if (!title) continue;
    entries.push({
      title,
      author: pick('author', 'credit', 'attribution', 'byline'),
      license: pick('license', 'licence'),
      sourceUrl: pick('sourceUrl', 'source_url', 'url', 'source'),
    });
  }
  return entries;
}

/** credits.json 不可用时的静态兜底署名（覆盖本轮全部许可义务）。 */
const FALLBACK_LINES: string[] = [
  '银河全景：NASA/Goddard Space Flight Center Scientific Visualization Studio（Ernie Wright）；星表数据 ESA/Gaia/DPAC（Gaia DR2）',
  '深空天体照片：NASA / ESA / Hubble（公有领域）、ESO（CC-BY 4.0）、Wikimedia Commons（PD / CC-BY）',
  '行星与月面贴图：Solar System Scope（CC-BY 4.0）、NASA / USGS（公有领域）',
  '星表与深空目录：HYG Database、OpenNGC；星历计算：astronomy-engine',
];

/**
 * 数据来源（非图像资产，常显）：credits.json 由 fetch-assets.mjs 生成、只管
 * 图像资产，轨道/星历数据来源在此静态列出（Phase 9C：口径与 /credits 页
 * 的 sources.ts 登记表一致——本面板是快捷摘要，完整逐字致谢句见 /credits）。
 */
const DATA_SOURCE_LINES: string[] = [
  'IAU 官方星名：IAU Catalog of Star Names（IAU-CSN，WGSN；CC BY 4.0，署名 IAU）',
  'TLE 轨道数据：CelesTrak（站内服务端每 6 小时代理刷新；SGP4 推算，演示精度）',
  '小天体轨道根数：NASA/JPL Small-Body Database（公有领域，服务端每日刷新）；参考校验：JPL Horizons（二体模型，演示级 ±0.5°）',
];

export function CreditsPanel() {
  const open = useUniverse((s) => s.creditsOpen);
  const openCredits = useUniverse((s) => s.openCredits);
  const closeCredits = useUniverse((s) => s.closeCredits);
  const [entries, setEntries] = useState<CreditEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  // 打开时才拉 credits.json（一次成功后缓存在 state）
  useEffect(() => {
    if (!open || entries !== null || failed) return;
    let cancelled = false;
    fetch('/credits.json')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: unknown) => {
        if (cancelled) return;
        const list = normalizeCredits(data);
        if (list.length > 0) setEntries(list);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, entries, failed]);

  return (
    <>
      <button
        onClick={openCredits}
        className="pointer-events-auto absolute bottom-5 left-6 z-10 text-[10.5px] text-nebula-200/40 underline-offset-2 transition hover:text-nebula-200/80 hover:underline"
      >
        影像与数据来源
      </button>

      {open && (
        <div
          className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={closeCredits}
        >
          <div
            className="glass max-h-[min(70vh,560px)] w-[min(92vw,520px)] overflow-y-auto rounded-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-start justify-between">
              <h2 className="text-[15px] font-medium text-white">影像与数据来源</h2>
              <button
                onClick={closeCredits}
                className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-nebula-200/60 transition hover:bg-white/10 hover:text-white"
              >
                关闭
              </button>
            </div>
            <p className="mb-4 text-[11px] leading-relaxed text-nebula-200/50">
              本站的银河全景、深空天体照片与行星贴图均来自公有领域（NASA/USGS 等）
              或 CC-BY 授权（ESO、Solar System Scope 等）素材，在此致谢。
              本平台与上述机构无隶属或背书关系。
            </p>

            {entries ? (
              <ul className="space-y-3">
                {entries.map((e, i) => (
                  <li key={i} className="text-[12px] leading-relaxed">
                    <div className="text-nebula-100">{e.title}</div>
                    <div className="text-nebula-200/50">
                      {e.author && <span>{e.author}</span>}
                      {e.author && e.license && <span> · </span>}
                      {e.license && <span>{e.license}</span>}
                      {e.sourceUrl && (
                        <>
                          {(e.author || e.license) && <span> · </span>}
                          <a
                            href={e.sourceUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="underline underline-offset-2 hover:text-nebula-100"
                          >
                            来源
                          </a>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : failed ? (
              <ul className="list-disc space-y-2 pl-4">
                {FALLBACK_LINES.map((line, i) => (
                  <li key={i} className="text-[12px] leading-relaxed text-nebula-200/60">
                    {line}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-[12px] text-nebula-200/50">加载中…</div>
            )}

            <div className="mt-5 border-t border-white/10 pt-3">
              <div className="mb-1.5 text-[11px] uppercase tracking-[0.22em] text-nebula-200/50">
                数据来源
              </div>
              <ul className="list-disc space-y-1.5 pl-4">
                {DATA_SOURCE_LINES.map((line, i) => (
                  <li key={i} className="text-[12px] leading-relaxed text-nebula-200/60">
                    {line}
                  </li>
                ))}
              </ul>
              {/* 完整版入口（Phase 9C）：/credits 独立路由——机构/版本/许可/
                逐字致谢句/抓取时间/星等完备极限全量登记 */}
              <Link
                href="/credits"
                prefetch={false}
                onClick={closeCredits}
                className="mt-3 inline-block text-[12.5px] text-nebula-100/85 underline underline-offset-4 transition hover:text-white"
              >
                查看完整「数据来源与版本」页 →
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
