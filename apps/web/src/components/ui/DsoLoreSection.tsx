'use client';

/**
 * StarInfoCard「了解更多」展开区（仅 16 个带照片+长文的著名 Messier 天体）：
 * 折叠态一枚次级按钮；展开态 = 照片缩略图（点击开 lightbox）+ 科普长文 + 署名。
 * 本地 useState，不进 store。不 import lib/dso-photos.ts（它 import three），
 * 照片 URL 走 dso-lore.ts 的 dsoLightboxUrl（同一 /dso-photos/{key}.jpg 资产）。
 *
 * 本组件由 StarInfoCard 以 next/dynamic 引入：16 篇长文（~12KB 文本）
 * 与 lightbox 只在选中带照片的 DSO 时才拉取，不进主页首包。
 * DSO_LORE 查表因此收在组件内（无长文时渲染 null）。
 */
import { useState } from 'react';
import { DSO_LORE, dsoLightboxUrl } from '@/lib/dso-lore';
import { PhotoLightbox } from './PhotoLightbox';

export function DsoLoreSection({
  uid,
  nameZh,
  imageKey,
  imageCredit,
}: {
  uid: string;
  nameZh: string;
  imageKey: string;
  imageCredit?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const loreZh = DSO_LORE[uid];
  const imageUrl = dsoLightboxUrl(imageKey);
  if (!loreZh) return null;

  return (
    <div className="mt-4">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2 text-[13px] text-nebula-100/85 transition hover:bg-white/[0.08] hover:text-white"
      >
        {expanded ? '收起 ▴' : '了解更多 ▾'}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          {!imageFailed && (
            <img
              src={imageUrl}
              alt={nameZh}
              onClick={() => setLightboxOpen(true)}
              onError={() => setImageFailed(true)}
              className="aspect-video w-full cursor-zoom-in rounded-xl object-cover"
            />
          )}
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-nebula-100/85">
            {loreZh}
          </p>
          {imageCredit && (
            <p className="text-[10.5px] text-nebula-200/40">影像：{imageCredit}</p>
          )}
        </div>
      )}

      <PhotoLightbox
        open={lightboxOpen}
        imageUrl={imageUrl}
        titleZh={nameZh}
        credit={imageCredit}
        onClose={() => setLightboxOpen(false)}
      />
    </div>
  );
}
