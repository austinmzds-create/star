'use client';

export function ComplianceNote() {
  return (
    <div className="pointer-events-none absolute bottom-5 right-6 z-10 max-w-[280px] text-right">
      <p className="text-[10.5px] leading-relaxed text-nebula-200/35">
        本平台提供基于真实星体坐标的私人纪念命名登记，
        <br className="hidden sm:block" />
        不代表国际天文学联合会（IAU）或任何官方天文机构的命名。
      </p>
    </div>
  );
}
