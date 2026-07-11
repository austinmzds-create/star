// 证书 / 星图展示区（服务端安全）。仅当后端返回已就绪资产时渲染。
// 资产 URL 为后端存储层给出的浏览器可直接加载绝对地址（本地 /api/assets 或 OSS 签名直链），
// 用 <img> 直接展示（SVG/PNG 皆可），并提供下载入口；加载失败由浏览器自然降级为空白，不影响页面主体。

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

/** 证书 + 星图区块。title 可覆盖标题（情侣页按人区分）。 */
export function CertificateSection({
  certUrl,
  starMapUrl,
  memorialName,
  title = '纪念证书 · 星图',
}: {
  certUrl: string;
  starMapUrl: string;
  memorialName: string;
  title?: string;
}) {
  return (
    <section className="glass-strong animate-fade-in mt-8 rounded-3xl p-6 sm:p-8">
      <div className="text-center text-[11px] uppercase tracking-[0.3em] text-gold/80">
        {title}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <CertificateCard href={certUrl} alt={`${memorialName} 纪念证书`} label="纪念证书" />
        <CertificateCard href={starMapUrl} alt={`${memorialName} 星图`} label="星图" />
      </div>

      <p className="mt-5 text-center text-[11px] leading-relaxed text-nebula-200/40">
        点击图片或「下载」保存高清原图。证书为私人纪念留存，不代表任何官方命名。
      </p>
    </section>
  );
}
