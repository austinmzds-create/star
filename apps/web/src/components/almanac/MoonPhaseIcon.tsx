/**
 * SVG 月相图标：按相位角画明暗界线（暗底圆 + 亮面路径两笔完成）。
 * phaseDeg: 0 新月 → 90 上弦 → 180 满月 → 270 下弦
 * （getMoonPhase().phaseAngleDeg / quarter*90 直接传入）。
 * 约定北半球视角：盈月亮面在右、亏月亮面在左。
 */
export function MoonPhaseIcon({ phaseDeg, size = 22 }: { phaseDeg: number; size?: number }) {
  const r = size / 2 - 1;
  const c = size / 2;
  const rad = (phaseDeg * Math.PI) / 180;
  const k = (1 - Math.cos(rad)) / 2; // 照亮比例
  const waxing = ((phaseDeg % 360) + 360) % 360 < 180;
  const rx = r * Math.abs(Math.cos(rad)); // 明暗界线椭圆半短轴

  let bright: string | null;
  if (k < 0.02) {
    bright = null; // 新月：只画暗盘
  } else if (k > 0.98) {
    // 满月：全亮圆
    bright = `M ${c} ${c} m ${-r} 0 a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`;
  } else {
    const limbSweep = waxing ? 1 : 0; // 亮缘半圆：盈在右、亏在左
    const termSweep = k > 0.5 ? (waxing ? 1 : 0) : waxing ? 0 : 1; // 凸月界线鼓向暗侧，蛾眉凹向亮侧
    bright = `M ${c} ${c - r} A ${r} ${r} 0 0 ${limbSweep} ${c} ${c + r} A ${rx} ${r} 0 0 ${termSweep} ${c} ${c - r}`;
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={c} cy={c} r={r} fill="#232a3d" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
      {bright && <path d={bright} fill="#f2ecd8" />}
    </svg>
  );
}
