import type { Metadata } from 'next';
import { AlbumSection } from '@/components/public/AlbumSection';
import { CertificateSection } from '@/components/public/CertificateSection';
import { ComplianceFootnote, KV, StaticStarfield } from '@/components/public/PublicChrome';
import { PurchaseEntry } from '@/components/public/PurchaseEntry';
import { getPublicCouple, type PublicCoupleStar, type PublicCoupleView } from '@/lib/api';
import { formatDateZh, formatDec, formatDistance, formatRA } from '@/lib/format';

// 公开情侣双星纪念页：纯服务端组件，复用 /m/[slug] 的静态星空与视觉，
// 呈现一对纪念星、各自的祝福与证书，以及合并祝福语。

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const view = await getPublicCouple(slug);
  const names = view?.stars.map((s) => s.memorialName).join(' ✦ ');
  return {
    title: view ? `${names} · 星辰纪念 · 情侣双星` : '星辰纪念 · 情侣双星',
    description: view
      ? `${view.relationLabel ?? '两颗星'}的私人纪念 · 基于真实星体坐标`
      : '基于真实星体坐标的私人情侣双星纪念',
    robots: { index: false },
  };
}

export default async function CouplePage({ params }: PageProps) {
  const { slug } = await params;
  const view = await getPublicCouple(slug);
  if (!view) return <CoupleUnavailable />;
  return <CoupleView view={view} />;
}

// ─────────────────────────── 页面主体 ───────────────────────────

function CoupleView({ view }: { view: PublicCoupleView }) {
  return (
    <div className="fixed inset-0 overflow-y-auto bg-void">
      <StaticStarfield />

      <main className="relative mx-auto max-w-[620px] px-5 py-14 sm:py-20">
        <div className="text-center text-[11px] uppercase tracking-[0.3em] text-gold/80">
          星辰纪念 STELLAR MEMORIAL
        </div>

        {/* 头部：关系标签 + 合并祝福 */}
        <section className="glass-strong animate-fade-in mt-8 rounded-3xl p-8 text-center">
          <div className="text-[11px] uppercase tracking-[0.3em] text-gold/80">
            Couple Stars · 情侣双星纪念
          </div>

          <h1 className="mt-4 text-[26px] font-semibold leading-snug text-white">
            {view.stars.map((s) => s.memorialName).join(' ✦ ')}
          </h1>
          <p className="mt-1 text-[13px] text-nebula-200/70">
            {view.relationLabel ?? view.occasion}
            {view.memorialDate ? ` · ${formatDateZh(view.memorialDate)}` : ''}
          </p>

          {view.coupleBlessing && (
            <>
              <div className="mx-auto my-6 h-px w-24 bg-gradient-to-r from-transparent via-nebula-300/50 to-transparent" />
              <p className="text-[15px] italic leading-relaxed text-nebula-100/90">
                “{view.coupleBlessing}”
              </p>
            </>
          )}

          <div className="mt-6 text-center text-[11px] text-nebula-200/40">
            登记于 {formatDateZh(view.createdAt)}
          </div>
        </section>

        {/* 两颗星并排（窄屏纵向堆叠） */}
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {view.stars.map((s) => (
            <CoupleStarCard key={s.registrationNo} unit={s} />
          ))}
        </div>

        {/* 各自的证书 / 星图（就绪才渲染） */}
        {view.stars.map((s) =>
          s.certificate ? (
            <CertificateSection
              key={`cert-${s.registrationNo}`}
              certUrl={s.certificate.certUrl}
              starMapUrl={s.certificate.starMapUrl}
              memorialName={s.memorialName}
              title={`${s.memorialName} · 纪念证书 · 星图`}
            />
          ) : null,
        )}

        {/* 各自的纪念册入口 */}
        {view.stars.map((s) => (
          <AlbumSection
            key={`album-${s.registrationNo}`}
            registrationNo={s.registrationNo}
            memorialName={s.memorialName}
          />
        ))}

        {/* 情侣礼盒升级入口（本期 UI 占位） */}
        <PurchaseEntry variant="couple" />

        <div className="mt-8 text-center">
          <a
            href="/"
            className="text-[13px] text-nebula-200/70 underline underline-offset-4 transition hover:text-white"
          >
            ← 返回星图，登记你们的双星
          </a>
        </div>

        <ComplianceFootnote />
      </main>
    </div>
  );
}

/** 单颗星卡片。 */
function CoupleStarCard({ unit }: { unit: PublicCoupleStar }) {
  const { star } = unit;
  return (
    <section className="glass-strong animate-fade-in rounded-3xl p-6">
      <div className="text-center text-[10.5px] uppercase tracking-[0.28em] text-gold/70">
        {unit.role === 'A' ? '第一颗星' : '第二颗星'}
      </div>
      <h2 className="mt-2 text-center text-[20px] font-semibold leading-snug text-white">
        {unit.memorialName}
      </h2>

      <div className="mx-auto my-4 h-px w-16 bg-gradient-to-r from-transparent via-nebula-300/50 to-transparent" />

      <div className="grid grid-cols-2 gap-2.5 text-left text-[12.5px]">
        <KV k="本体星" v={`${star.nameZh} ${star.nameEn}`} />
        <KV k="星座" v={star.constellationZh} />
        <KV k="赤经 RA" v={formatRA(star.raDeg)} />
        <KV k="赤纬 Dec" v={formatDec(star.decDeg)} />
        <KV k="星等" v={star.magnitude != null ? star.magnitude.toFixed(2) : '—'} />
        <KV k="距离" v={formatDistance(star.distanceLy)} />
      </div>

      {unit.blessing && (
        <p className="mt-4 text-center text-[13.5px] italic leading-relaxed text-nebula-100/90">
          “{unit.blessing}”
        </p>
      )}

      <div className="mt-4 text-center text-[11px] tracking-wider text-nebula-200/55">
        纪念编号 {unit.registrationNo}
      </div>
    </section>
  );
}

// ─────────────────────────── 优雅降级兜底 ───────────────────────────

function CoupleUnavailable() {
  return (
    <div className="fixed inset-0 overflow-y-auto bg-void">
      <StaticStarfield />

      <main className="relative mx-auto flex min-h-full max-w-[560px] flex-col justify-center px-5 py-14">
        <div className="text-center text-[11px] uppercase tracking-[0.3em] text-gold/80">
          星辰纪念 STELLAR MEMORIAL
        </div>

        <section className="glass-strong animate-fade-in mt-8 rounded-3xl p-8 text-center">
          <h1 className="text-[22px] font-semibold text-white">这对纪念双星暂时无法加载</h1>
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
