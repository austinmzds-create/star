/**
 * 悬停识别总线（模块级单例，非 React 状态）。
 *
 * 宇宙 V3-D：CameraRig 的 pointermove 节流拾取（≈14Hz）命中后写入这里；
 * HoverTooltip 订阅回调直改 DOM transform——x/y 高频更新零 React 重渲染，
 * 仅 uid 变化（低频）才触发一次 setState 换名牌内容。
 * 与 ephemRegistry/pickRegistry 同一套「模块单例 + 回调」纪律。
 */

/**
 * 说明气泡载荷（Phase 10「悬停万物」）：线/区域命中（黄道/天赤道/网格圈/
 * 地平线/银河/星座连线）走这条，与天体名牌互斥。
 */
export interface HoverInfo {
  icon: string;
  title: string;
  sub?: string;
}

export interface HoverState {
  /** 当前悬停命中的天体 uid；null 为无（与 info 互斥）。 */
  uid: string | null;
  /** 当前悬停命中的线/区域说明；null 为无（与 uid 互斥）。 */
  info: HoverInfo | null;
  /** 光标视口坐标（clientX/clientY）。 */
  x: number;
  y: number;
}

const state: HoverState = { uid: null, info: null, x: 0, y: 0 };
const listeners = new Set<(s: HoverState) => void>();

/** 天体命中：写 uid，清 info（互斥）；uid 传 null 表示清空名牌。 */
export function setHover(uid: string | null, x = 0, y = 0): void {
  if (state.uid === uid && state.info === null && state.x === x && state.y === y) return;
  state.uid = uid;
  state.info = null;
  state.x = x;
  state.y = y;
  for (const l of listeners) l(state);
}

/** 线/区域命中：写 info，清 uid（互斥）；info 传 null 即清空气泡。 */
export function setHoverInfo(info: HoverInfo | null, x = 0, y = 0): void {
  // 同标题去重（title 是稳定身份，避免每 40ms 相同气泡重触发 setState）
  if (state.info?.title === (info?.title ?? null) && state.uid === null && state.x === x && state.y === y) {
    return;
  }
  state.uid = null;
  state.info = info;
  state.x = x;
  state.y = y;
  for (const l of listeners) l(state);
}

/** 读当前悬停状态（CameraRig 节流间隙「只挪坐标」用）。 */
export function getHover(): Readonly<HoverState> {
  return state;
}

/** 订阅悬停变化；返回退订函数。 */
export function subscribeHover(listener: (s: HoverState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
