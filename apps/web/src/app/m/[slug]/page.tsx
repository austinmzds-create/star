import type { Metadata } from 'next';
import { AlbumSection } from '@/components/public/AlbumSection';
import { CertificateSection } from '@/components/public/CertificateSection';
import { ComplianceFootnote, KV, StaticStarfield } from '@/components/public/PublicChrome';
import { PurchaseEntry } from '@/components/public/PurchaseEntry';
import { getPublicMemorial, type PublicMemorialView } from '@/lib/api';
import { formatDateZh, formatDec, formatDistance, formatRA } from '@/lib/format';

// 公开纪念页：纯服务端组件，不引 R3F——要秒开、要能在微信内置浏览器流畅打开，
// 星空背景用纯 CSS（box-shadow 批量星点 + 径向渐变星云）而非 WebGL。
// 静态星空 / 合规脚注 / 键值卡片 / 证书区已抽到 components/public 共享，与情侣页复用同一套视觉。

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

        {/* 珍藏纪念册：客户端触发生成 + 轮询 + 下载；后端不可达优雅降级 */}
        <AlbumSection registrationNo={view.registrationNo} memorialName={view.memorialName} />

        {/* 实体礼品升级入口（本期 UI 占位） */}
        <PurchaseEntry variant="single" />

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
