'use client';

import dynamic from 'next/dynamic';
import { BrandMark } from './ui/BrandMark';
import { ComplianceNote } from './ui/ComplianceNote';
import { ConstellationInfoCard } from './ui/ConstellationInfoCard';
import { ControlBar } from './ui/ControlBar';
import { CoupleModal } from './ui/CoupleModal';
import { CoupleTray } from './ui/CoupleTray';
import { HintOverlay } from './ui/HintOverlay';
import { MemorialModal } from './ui/MemorialModal';
import { SearchPanel } from './ui/SearchPanel';
import { StarInfoCard } from './ui/StarInfoCard';

// 3D 场景仅在客户端渲染，避免 SSR 触碰 WebGL。
const UniverseScene = dynamic(
  () => import('./universe/UniverseScene').then((m) => m.UniverseScene),
  {
    ssr: false,
    loading: () => <SceneLoading />,
  },
);

export function UniverseApp() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-void">
      <UniverseScene />
      <BrandMark />
      <SearchPanel />
      <StarInfoCard />
      <ConstellationInfoCard />
      <ControlBar />
      <CoupleTray />
      <HintOverlay />
      <ComplianceNote />
      <MemorialModal />
      <CoupleModal />
    </div>
  );
}

function SceneLoading() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-void">
      <div className="flex flex-col items-center gap-4">
        <div className="relative h-10 w-10">
          <div className="absolute inset-0 animate-ping rounded-full bg-nebula-400/40" />
          <div className="absolute inset-[10px] rounded-full bg-white shadow-[0_0_20px_6px_rgba(150,165,255,0.7)]" />
        </div>
        <div className="text-[13px] tracking-[0.3em] text-nebula-200/60">正在点亮星空…</div>
      </div>
    </div>
  );
}
