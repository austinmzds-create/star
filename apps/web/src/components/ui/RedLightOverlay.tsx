'use client';

import { useUniverse } from '@/lib/store';

/**
 * 红光护眼覆盖层（Phase 6B 目标 4）：全屏 multiply 乘法调色，把绿/蓝通道
 * 压到极低（result = backdrop × overlay/255），保护夜间暗适应。
 *
 * 方案取舍：不用 html 层 filter（sepia/hue-rotate 链只能得到橙红、G/B 泄漏，
 * 且根元素 filter 会创建 containing block，令全站 fixed 浮层错位）；覆盖层
 * 在根合成层与其下所有兄弟内容（含 WebGL canvas / 弹窗 / 照片）一次 multiply
 * 混合，GPU 合成器直通 60fps。
 *
 * 覆盖色 #ff2d20：G≈18%、B≈13% 残留，暗部细节仍分得清、红光本质不变；
 * 若验收觉得不够“红”，退纯 #ff1a0d 只改此一处。
 * z-[90] 压过现有最高 z-50 弹窗；pointer-events-none 不挡任何交互；
 * 不做过渡动画（瞬时切换才是暗适应保护的本意，淡入反而闪白）。
 */
export function RedLightOverlay() {
  const on = useUniverse((s) => s.redLightOn);
  if (!on) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[90]"
      style={{ backgroundColor: '#ff2d20', mixBlendMode: 'multiply' }}
    />
  );
}
