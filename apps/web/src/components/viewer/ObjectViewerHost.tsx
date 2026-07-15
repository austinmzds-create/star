'use client';

import { AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';
import { useUniverse } from '@/lib/store';

/**
 * 全天体查看器的轻量挂载壳（照 PlanetViewerHost 模式）：本身零 three
 * 依赖可进主 bundle；仅当 objectViewerUid 非空时才动态拉取重模块
 * （R3F 恒星面 / 程序化艺术图 / 长文随 chunk 懒加载，ssr:false）。
 */
const ObjectViewerModal = dynamic(
  () => import('./ObjectViewerModal').then((m) => m.ObjectViewerModal),
  { ssr: false },
);

export function ObjectViewerHost() {
  const uid = useUniverse((s) => s.objectViewerUid);
  const show = !!uid;

  return <AnimatePresence>{show && <ObjectViewerModal key="object-viewer" />}</AnimatePresence>;
}
