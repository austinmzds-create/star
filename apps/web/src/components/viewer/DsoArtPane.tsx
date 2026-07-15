'use client';

import type { CelestialObject } from '@star/astro-data';
import { useMemo } from 'react';
import { getDsoArtURL } from '@/lib/dsoArt';

/**
 * 程序化 DSO 艺术图视觉面（~558 个无照片深空天体的查看器大图）。
 * 纯 img（dataURL，模块级缓存），零 GL、零网络；同 uid 永远同图。
 * 本组件只在查看器 modal chunk 内出现（dynamic ssr:false），可安全触 DOM。
 */
export function DsoArtPane({ obj }: { obj: CelestialObject }) {
  const url = useMemo(() => getDsoArtURL(obj.objectUid, 720), [obj.objectUid]);
  return (
    <div className="relative flex h-full w-full items-center justify-center p-4 md:p-10">
      <img
        src={url}
        alt={obj.nameZh}
        draggable={false}
        className="max-h-full max-w-full rounded-xl object-contain"
      />
      <div className="pointer-events-none absolute bottom-4 left-5 text-[11px] tracking-wide text-nebula-200/40">
        程序化艺术演绎，非真实影像
      </div>
    </div>
  );
}
