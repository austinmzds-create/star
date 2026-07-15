import Link from 'next/link';
import creditsJson from '../../../public/credits.json';
import { DATA_SOURCES, DISCLAIMER_ZH, MAG_COMPLETENESS_LINES } from './sources';

/**
 * /credits「数据来源与版本」页（Phase 9C 公信力体系 §3.2-2）。
 *
 * 定位：全站署名义务与数据诚实声明的正式落点——每个数据源一节
 * （名称/机构/版本/许可/逐字标准致谢句/抓取时间），加「星等完备极限」
 * 声明与全部第三方影像的逐文件署名（public/credits.json，由
 * fetch-assets.mjs 生成）。左下角 CreditsPanel 面板是快捷摘要，本页是完整版。
 *
 * 约束：
 *  - 纯 Server Component（零 'use client'/framer-motion/three）——App Router
 *    按路由分包，本页不给主页 First Load 增加任何字节；
 *  - 数据源登记表在 ./sources.ts（与 services/api 的 data-source 主数据同口径），
 *    致谢句逐字口径，绝不编造；
 *  - 合规红线：全页无「买星星/产权/官方命名认证」表述；免责句 DISCLAIMER_ZH
 *    与页脚/命名弹窗逐字同源。
 */

export const metadata = {
  title: '数据来源与版本 · 星辰纪念',
  description:
    '星辰纪念全部星表、深空目录、轨道与影像数据的来源、版本、许可证与标准致谢，附星等完备极限声明。',
};

/** credits.json 单条影像资产（构建期静态导入，类型由 JSON 推断收窄）。 */
type Asset = (typeof creditsJson.assets)[number];

/** 按 group 字段分组（保持 JSON 原始顺序：银河底图 → 深空影像 → 行星贴图）。 */
function groupAssets(assets: readonly Asset[]): { name: string; items: Asset[] }[] {
  const groups: { name: string; items: Asset[] }[] = [];
  const byName = new Map<string, Asset[]>();
  for (const a of assets) {
    let items = byName.get(a.group);
    if (!items) {
      items = [];
      byName.set(a.group, items);
      groups.push({ name: a.group, items });
    }
    items.push(a);
  }
  return groups;
}

export default function CreditsPage() {
  const assetGroups = groupAssets(creditsJson.assets);

  return (
    // body 为 overflow:hidden（主星图约束），本路由自管滚动（照 /almanac 模式）
    <div className="h-full overflow-y-auto bg-void">
      <header className="glass sticky top-0 z-20 px-4 py-3">
        <div className="mx-auto flex max-w-[760px] items-center justify-between gap-3">
          <Link
            href="/"
            prefetch={false}
            className="shrink-0 text-[13px] text-nebula-200/70 transition hover:text-white"
          >
            ← 返回星空
          </Link>
          <h1 className="text-[16px] font-medium tracking-[0.2em] text-white">数据来源与版本</h1>
          <span className="w-[68px]" aria-hidden />
        </div>
      </header>

      <main className="mx-auto max-w-[760px] px-4 pb-16 pt-6">
        <p className="text-[13px] leading-relaxed text-nebula-200/70">
          星辰纪念的每一条数据都可署名、可溯源、可更新。本页登记站内使用的全部星表、
          深空目录、星名名录、轨道数据、星历算法与第三方影像素材：机构、版本、许可证、
          标准致谢句原文与数据获取时间。
        </p>
        <p className="mt-3 text-[12px] leading-relaxed text-nebula-200/50">{DISCLAIMER_ZH}</p>

        {/* —— 星等完备极限声明（学术级诚实口径，r-data.md §4-5）—— */}
        <section className="glass mt-8 rounded-2xl p-5">
          <h2 className="text-[13px] uppercase tracking-[0.22em] text-nebula-200/60">
            星等完备极限
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-4">
            {MAG_COMPLETENESS_LINES.map((line) => (
              <li key={line} className="text-[13px] leading-relaxed text-nebula-100/85">
                {line}
              </li>
            ))}
          </ul>
        </section>

        {/* —— 数据源逐节登记 —— */}
        <h2 className="mt-10 text-[13px] uppercase tracking-[0.22em] text-nebula-200/60">
          星表与数据
        </h2>
        <div className="mt-4 space-y-4">
          {DATA_SOURCES.map((s) => (
            <section key={s.key} className="glass rounded-2xl p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="text-[15px] font-medium text-white">{s.name}</h3>
                <span className="rounded-full border border-nebula-400/25 bg-white/5 px-2.5 py-0.5 text-[11px] text-nebula-100/85">
                  {s.license}
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-2">
                <MetaRow label="机构 / 发布者" value={s.publisher} />
                <MetaRow label="版本" value={s.version} />
                <MetaRow
                  label="数据获取时间"
                  value={
                    s.retrievedAt
                      ? `${s.retrievedAt.slice(0, 10)}（UTC 批次）`
                      : '运行时实时计算/刷新，无静态抓取批次'
                  }
                />
                <MetaRow label="主页" value={s.homepageUrl} href={s.homepageUrl} />
                {s.licenseUrl && <MetaRow label="许可证原文" value={s.licenseUrl} href={s.licenseUrl} />}
              </dl>

              {/* 标准致谢句原文（逐字口径，证书/关于页共用） */}
              <blockquote className="mt-3 rounded-xl border-l-2 border-nebula-400/40 bg-white/[0.03] px-3 py-2 text-[12.5px] leading-relaxed text-nebula-100/85">
                {s.citationZh}
                {s.citationEn && (
                  <span className="mt-1 block text-[11.5px] text-nebula-200/55">{s.citationEn}</span>
                )}
              </blockquote>

              {s.notes && (
                <p className="mt-2 text-[11.5px] leading-relaxed text-nebula-200/55">{s.notes}</p>
              )}
            </section>
          ))}
        </div>

        {/* —— 影像素材逐文件署名（public/credits.json，fetch-assets.mjs 生成）—— */}
        <h2 className="mt-10 text-[13px] uppercase tracking-[0.22em] text-nebula-200/60">
          影像素材（逐文件署名）
        </h2>
        <p className="mt-2 text-[12px] leading-relaxed text-nebula-200/50">
          {creditsJson.note} 影像清单生成于 {creditsJson.generatedAt.slice(0, 10)}。
        </p>
        {assetGroups.map((g) => (
          <section key={g.name} className="mt-5">
            <h3 className="text-[13.5px] font-medium text-nebula-100">{g.name}</h3>
            <ul className="mt-2 space-y-2.5">
              {g.items.map((a) => (
                <li key={a.file} className="rounded-xl bg-white/[0.03] px-3 py-2 text-[12px]">
                  <div className="text-nebula-100">{a.title}</div>
                  <div className="mt-0.5 leading-relaxed text-nebula-200/55">
                    {a.author} · {a.license} ·{' '}
                    <a
                      href={a.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline underline-offset-2 transition hover:text-nebula-100"
                    >
                      来源
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {/* 合规脚注 */}
        <footer className="mt-12 border-t border-white/[0.06] pt-5 text-center text-[11px] leading-relaxed text-nebula-200/40">
          衍生数据（generated/*.json）随仓库以与上游一致的 CC BY-SA 许可共享并署名。
          本平台与上述任何机构无隶属或背书关系。{DISCLAIMER_ZH}
        </footer>
      </main>
    </div>
  );
}

/** 元信息行：label + 值（可选外链）。 */
function MetaRow({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="shrink-0 text-nebula-200/50">{label}</dt>
      <dd className="min-w-0 truncate text-nebula-100/85">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2 transition hover:text-white"
          >
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
