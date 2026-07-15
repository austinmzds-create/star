import type { Transition } from 'framer-motion';

/**
 * 全站 motion 动效 token（Phase 9A，r-fx §3.b）——UI 层唯一的节奏来源。
 *
 * 纪律：
 * - 进场用 spring（visualDuration + bounce 新 API：visualDuration 是「视觉上
 *   到位的秒数」，弹跳尾巴发生在其后，可与 duration 动画对齐编排）；
 *   退场用 duration tween（退场用弹簧会拖泥带水）。
 * - 全站禁止散写 stiffness/damping（review 时 grep 'stiffness' 应为 0 处）；
 *   同屏并发动效 ≤2 组；层级越大时长越长（chip < panel < modal < scene）。
 * - reduced-motion 由 app/layout 的 <MotionConfig reducedMotion="user"> 全局
 *   接管（transform/layout 动画自动禁用、opacity 保留），组件不再各自判断。
 */

export const springs = {
  /** 弹窗 / 信息卡入场（原 240/26、280/30、320/26 系漂移参数统一到此）。 */
  modal: { type: 'spring', visualDuration: 0.38, bounce: 0.22 },
  /** 侧板 / 托盘 / 时间机器 / 搜索下拉等面板开合（原 260/28）。 */
  panel: { type: 'spring', visualDuration: 0.3, bounce: 0.16 },
  /** 按钮 / 标签 / 拨钮 / 卡内分区子项等小件（原 420/32）。 */
  chip: { type: 'spring', visualDuration: 0.2, bounce: 0.12 },
} as const satisfies Record<string, Transition>;

export const exits = {
  /** 小件 / 面板退场。 */
  fast: { duration: 0.14, ease: 'easeIn' },
  /** 弹窗 / 信息卡退场。 */
  base: { duration: 0.18, ease: 'easeIn' },
} as const satisfies Record<string, Transition>;

/** stagger 间隔（秒）：item 用于卡内分区，section 用于首屏 UI 依次入场。 */
export const stagger = { item: 0.05, section: 0.08, max: 8 } as const;

/**
 * 时长层级参照（秒）：micro=悬停/按压反馈，component=组件出入，
 * scene=场景级（镜头飞行/序曲淡入落在 0.8–2.5s 区间）。
 * 供新增动效选节奏用，不直接当 transition 传。
 */
export const scenePace = { micro: 0.15, component: 0.32, scene: [0.8, 2.5] } as const;

/** stagger 延迟：超过 max 项不再累加（长列表尾部同时入场，不无限拖节奏）。 */
export function staggerDelay(index: number, step: number = stagger.item): number {
  return Math.min(index, stagger.max) * step;
}
