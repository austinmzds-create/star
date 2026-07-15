'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { exits, springs } from '@/lib/motionTokens';
import {
  decideOvertureMode,
  markOvertureSeen,
  startOverture,
  type OvertureHandle,
  type OvertureMode,
  type OvertureStage,
} from '@/lib/overture';
import { setGlobalFade } from '@/lib/fxBus';
import { useUniverse } from '@/lib/store';

// SSR 阶段避开 useLayoutEffect 告警（服务端换 useEffect；每个运行环境内恒定，
// 不违反 hooks 调用一致性）。
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * 开场序曲 DOM 覆盖层（Phase 9A，r-fx §3.a）：黑幕渐隐 → 标题「星辰纪念」
 * letter-spacing 收拢浮现 → 副标题 → 让位退场。时间轴与相机/亮度/音频由
 * lib/overture 状态机驱动，本组件只消费其 stage 回调编排 DOM 动画。
 *
 * 挂载纪律：layout 级常驻（body 下），仅 pathname === '/' 时行动——
 * 其余路由渲染 null 且不写 overturePhase（'idle' 对 UI 即「可见」）。
 * z-[80]：压过一切面板（z-50）但在红光护眼层（z-[90]）之下。
 * 跳过：'playing' 期整层捕获 pointerdown → handle.skip()；'yield' 起
 * pointer-events 关闭，UI 立刻可交互。
 * 退化（reduced：prefers-reduced-motion / 低档）：0.6s 交叉淡入，无相机
 * 编排；标记已看过后直接 'done'。
 */
export function OvertureOverlay() {
  const pathname = usePathname();
  const onHome = pathname === '/';
  const [mode, setMode] = useState<OvertureMode | null>(null);
  const [stage, setStage] = useState<OvertureStage>('black');
  const [visible, setVisible] = useState(true);
  const handleRef = useRef<OvertureHandle | null>(null);

  // 决策必须在首帧绘制前落定：full/reduced 时先把 overturePhase 置 'playing'
  // 压住首屏 UI，否则 UI 会闪现一帧再隐藏。
  useIsoLayoutEffect(() => {
    if (!onHome) return;
    const m = decideOvertureMode();
    setMode(m);
    if (m === 'skip') {
      useUniverse.getState().setOverturePhase('done');
      return;
    }
    useUniverse.getState().setOverturePhase('playing');
  }, [onHome]);

  // full：等 WebGL canvas 挂载（懒加载）再启动导演——保证相机/fov 通道就绪。
  // 3.5s 内等不到（慢网/低端机首包）→ 就地退化为 reduced，不让用户干等黑幕。
  useEffect(() => {
    if (!onHome || mode !== 'full') return;
    let raf = 0;
    let cancelled = false;
    const waitStart = performance.now();
    // canvas 入 DOM 后再等 2 帧：R3F 场景子树（含 CameraRig 的 wheel 监听）
    // 在 canvas 元素出现后的下一提交才挂载，抢跑会让 fov 通道首推丢失。
    let settleFrames = 2;
    const boot = () => {
      if (cancelled) return;
      const canvas = document.querySelector<HTMLCanvasElement>('main canvas');
      if (canvas && settleFrames-- <= 0) {
        handleRef.current = startOverture(
          canvas,
          (s) => setStage(s),
          () => setVisible(false),
        );
        return;
      }
      if (!canvas && performance.now() - waitStart > 3500) {
        setMode('reduced');
        return;
      }
      raf = requestAnimationFrame(boot);
    };
    raf = requestAnimationFrame(boot);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [onHome, mode]);

  // reduced：0.6s 交叉淡入——亮度直接给满（GL 侧无需渐变，黑幕淡出即交叉），
  // 标记已看过并立刻放行 UI（MotionConfig reducedMotion 会把 UI 入场削成纯透明度）。
  useEffect(() => {
    if (!onHome || mode !== 'reduced') return;
    markOvertureSeen();
    setGlobalFade(1);
    useUniverse.getState().setOverturePhase('done');
    const t = window.setTimeout(() => setVisible(false), 650);
    return () => window.clearTimeout(t);
  }, [onHome, mode]);

  if (!onHome || mode === null || mode === 'skip') return null;

  const interactive = mode === 'full' && stage !== 'yield';

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="overture"
          aria-hidden
          onPointerDown={interactive ? () => handleRef.current?.skip() : undefined}
          initial={false}
          exit={{ opacity: 0, transition: exits.base }}
          className={`fixed inset-0 z-[80] select-none ${
            interactive ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'
          }`}
        >
          {/* 黑幕：0.8s 后开始掀开（1.6s 长淡出与星场亮度抬升交叉）；
              reduced 模式 0.6s 快淡 */}
          <motion.div
            className="absolute inset-0 bg-[#010207]"
            initial={{ opacity: 1 }}
            animate={{ opacity: mode === 'reduced' || stage !== 'black' ? 0 : 1 }}
            transition={{ duration: mode === 'reduced' ? 0.6 : 1.6, ease: 'easeOut' }}
          />

          {/* 标题组：3.8s 浮现，5.2s 上浮让位（reduced 模式不演标题） */}
          {mode === 'full' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <motion.h1
                className="text-[clamp(28px,6vw,44px)] font-semibold text-white [text-shadow:0_0_30px_rgba(150,165,255,0.45)]"
                initial={{ opacity: 0, letterSpacing: '0.6em' }}
                animate={
                  stage === 'title'
                    ? { opacity: 1, letterSpacing: '0.3em', y: 0 }
                    : stage === 'yield'
                      ? { opacity: 0, letterSpacing: '0.3em', y: -28 }
                      : { opacity: 0, letterSpacing: '0.6em' }
                }
                transition={
                  stage === 'yield'
                    ? { duration: 0.9, ease: 'easeIn' }
                    : { duration: 1.2, ease: [0.22, 1, 0.36, 1] }
                }
              >
                星辰纪念
              </motion.h1>
              <motion.p
                className="mt-4 text-[13px] tracking-[0.42em] text-nebula-200/70"
                initial={{ opacity: 0, y: 10 }}
                animate={
                  stage === 'title'
                    ? { opacity: 1, y: 0 }
                    : stage === 'yield'
                      ? { opacity: 0, y: -20 }
                      : { opacity: 0, y: 10 }
                }
                transition={
                  stage === 'yield'
                    ? { duration: 0.7, ease: 'easeIn' }
                    : { ...springs.modal, delay: 0.4 }
                }
              >
                在真实星空 · 安放一份纪念
              </motion.p>
              {/* 跳过提示：掀幕即出现（让用户尽早知道可跳过），让位期随层收场 */}
              <motion.span
                className="absolute bottom-10 text-[11px] tracking-[0.3em] text-nebula-200/35"
                initial={{ opacity: 0 }}
                animate={{ opacity: stage === 'reveal' || stage === 'title' ? 1 : 0 }}
                transition={{ duration: 0.8 }}
              >
                轻触任意处跳过
              </motion.span>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
