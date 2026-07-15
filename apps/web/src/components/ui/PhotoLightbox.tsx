'use client';

/**
 * 照片放大 lightbox（带署名）：全屏幕布 + object-contain 大图。
 * 关闭：点幕布 / 右上 ✕ / Esc。打开期间锁定 body 滚动。
 * 纯展示组件（<2KB），无需 next/dynamic。CC-BY 署名就地展示即合规闭环
 * （与 credits.json 双保险）。
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { exits, springs } from '@/lib/motionTokens';

export function PhotoLightbox({
  open,
  imageUrl,
  titleZh,
  credit,
  onClose,
}: {
  open: boolean;
  imageUrl: string;
  titleZh: string;
  credit?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: exits.base }}
          transition={springs.chip}
          onClick={onClose}
          className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-black/85 p-6 backdrop-blur"
        >
          <button
            onClick={onClose}
            aria-label="关闭大图"
            className="absolute right-5 top-5 rounded-full border border-white/15 px-3 py-1 text-nebula-200/70 transition hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
          <img
            src={imageUrl}
            alt={titleZh}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[82vh] max-w-[92vw] rounded-lg object-contain"
          />
          <div className="mt-4 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="text-[15px] text-white">{titleZh}</div>
            {credit && (
              <div className="mt-1 text-[11px] text-nebula-200/50">影像：{credit} · 仅供欣赏</div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
