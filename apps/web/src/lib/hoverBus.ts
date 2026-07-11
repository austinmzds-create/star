/**
 * 悬停识别总线（模块级单例，非 React 状态）。
 *
 * 宇宙 V3-D：CameraRig 的 pointermove 节流拾取（≈14Hz）命中后写入这里；
 * HoverTooltip 订阅回调直改 DOM transform——x/y 高频更新零 React 重渲染，
 * 仅 uid 变化（低频）才触发一次 setState 换名牌内容。
 * 与 ephemRegistry/pickRegistry 同一套「模块单例 + 回调」纪律。
 */

export interface HoverState {
  /** 当前悬停命中的天体 uid；null 为无。 */
  uid: string | null;
  /** 光标视口坐标（clientX/clientY）。 */
  x: number;
  y: number;
}

const state: HoverState = { uid: null, x: 0, y: 0 };
const listeners = new Set<(s: HoverState) => void>();

/** 写入悬停状态（同值去重）；uid 传 null 表示清空。 */
export function setHover(uid: string | null, x = 0, y = 0): void {
  if (state.uid === uid && state.x === x && state.y === y) return;
  state.uid = uid;
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
