import type { Metadata } from 'next';
import { getPublicMemorial, type PublicMemorialView } from '@/lib/api';
import { formatDateZh, formatDec, formatDistance, formatRA } from '@/lib/format';

// 公开纪念页：纯服务端组件，不引 R3F——要秒开、要能在微信内置浏览器流畅打开，
// 星空背景用纯 CSS（box-shadow 批量星点 + 径向渐变星云）而非 WebGL。

/** Next 15 App Router：动态路由的 params 是 Promise。 */
interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const view = await getPublicMemorial(slug);
  return {
    title: view ? `${view.memorialName} · 星辰纪念` : '星辰纪念',
    description: view
      ? `${view.star.nameZh}（${view.star.constellationZh}）· 私人纪念星登记`
      : '基于真实星体坐标的私人纪念命名',
    // 私人纪念页默认不进搜索引擎
    robots: { index: false },
  };
}

export default async function MemorialPage({ params }: PageProps) {
  const { slug } = await params;
  const view = await getPublicMemorial(slug);
  // API 不可用与 slug 不存在统一兜底（对访客无区分意义，且避免信息泄露）
  if (!view) return <MemorialUnavailable />;
  return <MemorialView view={view} />;
}

// ─────────────────────────── 页面主体 ───────────────────────────

function MemorialView({ view }: { view: PublicMemorialView }) {
  const { star } = view;
  return (
    // globals.css 对 body 设了 overflow:hidden（为首页全屏 3D 服务），
    // 本页在 body 之内自建滚动容器，不动全局样式
    <div className="fixed inset-0 overflow-y-auto bg-void">
      <StaticStarfield />

      <main className="relative mx-auto max-w-[560px] px-5 py-14 sm:py-20">
        <div className="text-center text-[11px] uppercase tracking-[0.3em] text-gold/80">
          星辰纪念 STELLAR MEMORIAL
        </div>

        <section className="glass-strong animate-fade-in mt-8 rounded-3xl p-8">
          <div className="text-center text-[11px] uppercase tracking-[0.3em] text-gold/80">
            Stellar Memorial · 私人纪念星登记
          </div>

          <h1 className="mt-4 text-center text-[28px] font-semibold leading-snug text-white">
            {view.memorialName}
          </h1>
          <p className="mt-1 text-center text-[13px] text-nebula-200/70">
            {view.occasion}
            {view.memorialDate ? ` · ${formatDateZh(view.memorialDate)}` : ''}
          </p>

          <div className="mx-auto my-6 h-px w-24 bg-gradient-to-r from-transparent via-nebula-300/50 to-transparent" />

          <div className="grid grid-cols-2 gap-3 text-left text-[13px]">
            <KV k="本体星" v={`${star.nameZh} ${star.nameEn}`} />
            <KV k="星座" v={star.constellationZh} />
            <KV k="赤经 RA" v={formatRA(star.raDeg)} />
            <KV k="赤纬 Dec" v={formatDec(star.decDeg)} />
            <KV k="星等" v={star.magnitude != null ? star.magnitude.toFixed(2) : '—'} />
            <KV k="距离" v={formatDistance(star.distanceLy)} />
          </div>

          {view.blessing && (
            <p className="mt-6 text-center text-[15px] italic leading-relaxed text-nebula-100/90">
              “{view.blessing}”
            </p>
          )}

          <div className="mt-6 text-center text-[12px] tracking-wider text-nebula-200/60">
            纪念编号 {view.registrationNo}
          </div>
          <div className="mt-1 text-center text-[11px] text-nebula-200/40">
            登记于 {formatDateZh(view.createdAt)}
          </div>
        </section>

        {view.certificate && (
          <CertificateSection
            certUrl={view.certificate.certUrl}
            starMapUrl={view.certificate.starMapUrl}
            memorialName={view.memorialName}
          />
        )}

        <div className="mt-8 text-center">
          <a
            href="/"
            className="text-[13px] text-nebula-200/70 underline underline-offset-4 transition hover:text-white"
          >
            ← 返回星图，登记你的纪念星
          </a>
        </div>

        <ComplianceFootnote />
      </main>
    </div>
  );
}

// ─────────────────────────── 优雅降级兜底 ───────────────────────────

function MemorialUnavailable() {
  return (
    <div className="fixed inset-0 overflow-y-auto bg-void">
      <StaticStarfield />

      <main className="relative mx-auto flex min-h-full max-w-[560px] flex-col justify-center px-5 py-14">
        <div className="text-center text-[11px] uppercase tracking-[0.3em] text-gold/80">
          星辰纪念 STELLAR MEMORIAL
        </div>

        <section className="glass-strong animate-fade-in mt-8 rounded-3xl p-8 text-center">
          <h1 className="text-[22px] font-semibold text-white">这颗纪念星暂时无法加载</h1>
          <p className="mt-3 text-[14px] leading-relaxed text-nebula-200/70">
            链接可能已失效，或星光正在穿越漫长的距离。请稍后再试。
          </p>
          <div className="mt-7">
            <a
              href="/"
              className="inline-block rounded-2xl bg-gradient-to-r from-nebula-500 to-nebula-700 px-6 py-3 text-[14px] font-medium text-white transition hover:brightness-110"
            >
              返回星图首页
            </a>
          </div>
        </section>

        <ComplianceFootnote />
      </main>
    </div>
  );
}

// ─────────────────────────── 小组件 ───────────────────────────

/**
 * 证书 / 星图展示区。仅当后端返回已就绪资产时渲染。
 * 资产 URL 为后端存储层给出的浏览器可直接加载绝对地址（本地 /api/assets 或 OSS 签名直链），
 * 用 <img> 直接展示（SVG/PNG 皆可），并提供下载入口；加载失败由浏览器自然降级为空白，不影响页面主体。
 */
function CertificateSection({
  certUrl,
  starMapUrl,
  memorialName,
}: {
  certUrl: string;
  starMapUrl: string;
  memorialName: string;
}) {
  return (
    <section className="glass-strong animate-fade-in mt-8 rounded-3xl p-6 sm:p-8">
      <div className="text-center text-[11px] uppercase tracking-[0.3em] text-gold/80">
        纪念证书 · 星图
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <CertificateCard
          href={certUrl}
          alt={`${memorialName} 纪念证书`}
          label="纪念证书"
        />
        <CertificateCard href={starMapUrl} alt={`${memorialName} 星图`} label="星图" />
      </div>

      <p className="mt-5 text-center text-[11px] leading-relaxed text-nebula-200/40">
        点击图片或「下载」保存高清原图。证书为私人纪念留存，不代表任何官方命名。
      </p>
    </section>
  );
}

/** 单张证书/星图卡片：图片 + 下载链接。 */
function CertificateCard({ href, alt, label }: { href: string; alt: string; label: string }) {
  return (
    <div className="flex flex-col">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="group block overflow-hidden rounded-2xl border border-white/10 bg-void/40 transition hover:border-nebula-400/40"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- 证书为动态 OSS/本地资产，非构建期静态图，用原生 img 避免 next/image 域名白名单与优化开销 */}
        <img
          src={href}
          alt={alt}
          loading="lazy"
          className="h-auto w-full object-contain transition group-hover:brightness-105"
        />
      </a>
      <div className="mt-2 flex items-center justify-between px-1">
        <span className="text-[12px] text-nebula-200/70">{label}</span>
        <a
          href={href}
          download
          target="_blank"
          rel="noreferrer"
          className="text-[12px] text-nebula-200/80 underline underline-offset-4 transition hover:text-white"
        >
          下载 ↓
        </a>
      </div>
    </div>
  );
}

/** 键值卡片：与 MemorialModal 成功卡片的 KV 视觉一致。 */
function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-white/[0.04] px-3 py-2">
      <div className="text-[11px] text-nebula-200/50">{k}</div>
      <div className="mt-0.5 text-white">{v}</div>
    </div>
  );
}

/** 合规脚注：文案与 ComplianceNote 组件保持完全一致（该组件为 absolute 定位的客户端组件，不直接复用）。 */
function ComplianceFootnote() {
  return (
    <footer className="mt-10 pb-6 text-center">
      <p className="text-[10.5px] leading-relaxed text-nebula-200/35">
        本平台提供基于真实星体坐标的私人纪念命名登记，
        <br />
        不代表国际天文学联合会（IAU）或任何官方天文机构的命名。
      </p>
    </footer>
  );
}

/** 确定性伪随机（LCG）：星点位置固定，避免每次 ISR 重渲染时星空跳动。 */
function makeRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** 生成一层 box-shadow 批量星点，如 "12vw 34vh 0 0 rgba(...)" 串联。 */
function starShadows(count: number, seed: number, alpha: number): string {
  const rng = makeRng(seed);
  const shadows: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = (rng() * 100).toFixed(2);
    const y = (rng() * 100).toFixed(2);
    shadows.push(`${x}vw ${y}vh 0 0 rgba(238,241,255,${alpha})`);
  }
  return shadows.join(', ');
}

/** 纯 CSS 静态星空：三层不同亮度/大小的星点 + 两团呼吸星云光晕。 */
function StaticStarfield() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      {/* 远景暗星 */}
      <div
        className="absolute h-px w-px rounded-full"
        style={{ boxShadow: starShadows(90, 7, 0.35) }}
      />
      {/* 中景星 */}
      <div
        className="absolute h-[1.5px] w-[1.5px] rounded-full"
        style={{ boxShadow: starShadows(45, 42, 0.6) }}
      />
      {/* 近景亮星 */}
      <div
        className="absolute h-[2px] w-[2px] rounded-full"
        style={{ boxShadow: starShadows(18, 2026, 0.9) }}
      />
      {/* 星云光晕：紫蓝 + 暖金，低透明度呼吸 */}
      <div
        className="animate-breathe absolute -left-32 top-[12%] h-[420px] w-[420px] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(107,115,255,0.16) 0%, rgba(107,115,255,0) 70%)',
        }}
      />
      <div
        className="animate-breathe absolute -right-24 bottom-[8%] h-[360px] w-[360px] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(242,213,155,0.10) 0%, rgba(242,213,155,0) 70%)',
          animationDelay: '1.6s',
        }}
      />
    </div>
  );
}
