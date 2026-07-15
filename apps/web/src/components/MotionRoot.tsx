'use client';

import { MotionConfig } from 'framer-motion';
import { useEffect } from 'react';
import { getPerfTier, subscribePerfTier, type PerfTier } from '@/lib/perfBus';

/**
 * UI 层全局运行时旋钮（Phase 9A，layout 级挂载一次）：
 *
 * 1. <MotionConfig reducedMotion="user">：系统「减弱动态效果」时全站
 *    transform/layout 动画自动禁用、opacity 保留——取代原先散落在
 *    StarInfoCard/ConstellationInfoCard/StarArchiveSection 的逐组件
 *    useReducedMotion 判断（r-fx §2.4）。GL 侧降级不归这里，仍走
 *    deviceTier/perfBus。
 *
 * 2. perfTier → <html data-perf="...">：把运行时质量档（perfBus，
 *    PostFX 熔断可变）桥接给 CSS——低档时 globals.css 把 .glass-strong
 *    的 backdrop blur 28px 降到 12px（大面积 backdrop-filter 是移动端
 *    合成大户，r-fx §3.d 降载项）。
 *
 * layout 是 Server Component，framer-motion 主入口无 'use client' 标记，
 * 必须经本客户端组件转一层；children 走 RSC 透传，不拖累服务端渲染。
 */
export function MotionRoot({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const apply = (t: PerfTier) => {
      document.documentElement.dataset.perf = t;
    };
    apply(getPerfTier());
    return subscribePerfTier(apply);
  }, []);

  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
