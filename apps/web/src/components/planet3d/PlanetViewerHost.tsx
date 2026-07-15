'use client';

import { AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';
import { getObjectByUid } from '@/lib/solarSystem';
import { useUniverse } from '@/lib/store';

/**
 * 行星 3D 全屏模态的轻量挂载壳：本身零 three 依赖（可进主 bundle），
 * 仅当 planetViewerOpen 且选中天体为星历天体时才动态拉取重模块
 * （three/R3F/星历引擎随 chunk 懒加载）。
 */
const PlanetViewerModal = dynamic(
  () => import('./PlanetViewerModal').then((m) => m.PlanetViewerModal),
  { ssr: false },
);

export function PlanetViewerHost() {
  const open = useUniverse((s) => s.planetViewerOpen);
  const selectedUid = useUniverse((s) => s.selectedUid);
  const obj = selectedUid ? getObjectByUid(selectedUid) : undefined;
  const show = open && !!obj?.isEphemeris;

  return <AnimatePresence>{show && <PlanetViewerModal key="planet-viewer" />}</AnimatePresence>;
}
