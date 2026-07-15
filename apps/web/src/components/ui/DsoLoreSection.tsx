'use client';

/**
 * StarInfoCard「了解更多」长文补充区（携带 imageKey 的著名 Messier 天体）：
 * 折叠态一枚次级按钮；展开态 = 科普长文 + 影像署名。
 *
 * Phase 10 修复：本组件不再承担「放大照片」职责——放大统一交给上方 ViewerPreviewBlock
 * 缩略块（点击一步进 ObjectViewerModal → PhotoPane 大图），避免同卡两张图与「两步展开」
 * 的交互割裂。故此处删除内嵌缩略图 <img> 与 PhotoLightbox，仅保留文字长文与署名。
 * 无长文（DSO_LORE 无该 uid）时渲染 null——无害：放大入口由缩略块保证。
 * 签名冻结：props（uid/nameZh/imageKey/imageCredit）不变，仅内部渲染精简。
 *
 * 本组件由 StarInfoCard 以 next/dynamic 引入：长文（~KB 级文本）只在选中带
 * imageKey 的 DSO 时才拉取，不进主页首包。DSO_LORE 查表收在组件内。
 */
import { useState } from 'react';
import { DSO_LORE } from '@/lib/dso-lore';

export function DsoLoreSection({
  uid,
  imageCredit,
}: {
  uid: string;
  nameZh: string;
  imageKey: string;
  imageCredit?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const loreZh = DSO_LORE[uid];
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
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-nebula-100/85">
            {loreZh}
          </p>
          {imageCredit && (
            <p className="text-[10.5px] text-nebula-200/40">影像：{imageCredit}</p>
          )}
        </div>
      )}
    </div>
  );
}
