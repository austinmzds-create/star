'use client';

export function BrandMark() {
  return (
    <div className="pointer-events-none absolute left-6 top-6 z-20 select-none">
      <div className="flex items-center gap-3">
        <div className="relative h-9 w-9">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-nebula-400 to-nebula-700 opacity-70 blur-[6px]" />
          <div className="absolute inset-[6px] rounded-full bg-white shadow-[0_0_16px_4px_rgba(150,165,255,0.8)]" />
        </div>
        <div>
          <div className="text-[15px] font-semibold tracking-[0.2em] text-white">星辰纪念</div>
          <div className="text-[10px] tracking-[0.3em] text-nebula-200/70">STELLAR MEMORIAL</div>
        </div>
      </div>
    </div>
  );
}
