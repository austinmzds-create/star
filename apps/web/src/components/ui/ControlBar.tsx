'use client';

import { useUniverse } from '@/lib/store';

export function ControlBar() {
  const autoRotate = useUniverse((s) => s.autoRotate);
  const showLabels = useUniverse((s) => s.showLabels);
  const coupleMode = useUniverse((s) => s.coupleMode);
  const toggleAutoRotate = useUniverse((s) => s.toggleAutoRotate);
  const toggleLabels = useUniverse((s) => s.toggleLabels);
  const resetView = useUniverse((s) => s.resetView);
  const enterCoupleMode = useUniverse((s) => s.enterCoupleMode);
  const exitCoupleMode = useUniverse((s) => s.exitCoupleMode);

  return (
    <div className="pointer-events-auto absolute bottom-6 left-1/2 z-20 -translate-x-1/2">
      <div className="glass flex items-center gap-1 rounded-full px-2 py-1.5">
        <Toggle active={autoRotate} onClick={toggleAutoRotate}>
          自动旋转
        </Toggle>
        <Toggle active={showLabels} onClick={toggleLabels}>
          名称标签
        </Toggle>
        <div className="mx-1 h-5 w-px bg-white/10" />
        <Toggle
          active={coupleMode}
          onClick={coupleMode ? exitCoupleMode : enterCoupleMode}
        >
          ✦ 情侣双星
        </Toggle>
        <div className="mx-1 h-5 w-px bg-white/10" />
        <button
          onClick={resetView}
          className="rounded-full px-4 py-1.5 text-[13px] text-nebula-100 transition hover:bg-white/10"
        >
          回到全景
        </button>
      </div>
    </div>
  );
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-[13px] transition ${
        active
          ? 'bg-nebula-500/30 text-white shadow-[inset_0_0_0_1px_rgba(140,155,255,0.4)]'
          : 'text-nebula-200/60 hover:bg-white/5'
      }`}
    >
      {children}
    </button>
  );
}
