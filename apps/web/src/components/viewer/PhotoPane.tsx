'use client';

import type { CelestialObject } from '@star/astro-data';
import { useEffect, useState } from 'react';
import { dsoLightboxUrl } from '@/lib/dso-lore';
import { DsoArtPane } from './DsoArtPane';

/**
 * 真实照片视觉面（16 个带 imageKey 的著名 Messier）：object-contain 大图
 * 占满视觉区（查看器本身已是大窗，不再嵌 lightbox）。加载失败 →
 * 降级渲染程序化艺术图（DsoArtPane），不留黑洞。
 */
export function PhotoPane({ obj }: { obj: CelestialObject }) {
  const [failed, setFailed] = useState(false);
  // 换天体重置失败标记（避免上一张失败连带屏蔽下一张）
  useEffect(() => setFailed(false), [obj.objectUid]);
  if (!obj.imageKey || failed) return <DsoArtPane obj={obj} />;

  return (
    <div className="flex h-full w-full items-center justify-center p-4 md:p-8">
      <img
        src={dsoLightboxUrl(obj.imageKey)}
        alt={obj.nameZh}
        onError={() => setFailed(true)}
        draggable={false}
        className="max-h-full max-w-full rounded-xl object-contain"
      />
    </div>
  );
}
