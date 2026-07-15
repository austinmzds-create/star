'use client';

import dynamic from 'next/dynamic';
import { BrandMark } from './ui/BrandMark';
import { ComplianceNote } from './ui/ComplianceNote';
import { ConstellationInfoCard } from './ui/ConstellationInfoCard';
import { ControlBar } from './ui/ControlBar';
import { CoupleModal } from './ui/CoupleModal';
import { CreditsPanel } from './ui/CreditsPanel';
import { CoupleTray } from './ui/CoupleTray';
import { DisplaySettings } from './ui/DisplaySettings';
import { GyroModeButton } from './ui/GyroModeButton';
import { HintOverlay } from './ui/HintOverlay';
import { HoverTooltip } from './ui/HoverTooltip';
import { MemorialModal } from './ui/MemorialModal';
import { RealSkyHint } from './ui/RealSkyHint';
import { PlanetViewerHost } from './planet3d/PlanetViewerHost';
import { SearchPanel } from './ui/SearchPanel';
import { StarInfoCard } from './ui/StarInfoCard';
import { TimeMachineBar } from './ui/TimeMachineBar';

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
      {/* 时间机器：常驻挂载（播放循环/实时心跳不随面板开合中断），面板出现在 ControlBar 上方 */}
      <TimeMachineBar />
      {/* 显示设置面板：收纳低频开关（银河/标签/星座/旋转/坐标线/地平线/城市） */}
      <DisplaySettings />
      {/* 悬停识别名牌：hoverBus 驱动，跟随光标（触屏自然静默） */}
      <HoverTooltip />
      <CoupleTray />
      {/* 指向天空（陀螺仪指星）：仅触屏 + 方向传感器设备显示 */}
      <GyroModeButton />
      <HintOverlay />
      {/* 进 earth 建议切真实天空的一次性软提示（Phase 10，契约 §1「不强制」） */}
      <RealSkyHint />
      <ComplianceNote />
      <CreditsPanel />
      <MemorialModal />
      <CoupleModal />
      <PlanetViewerHost />
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
