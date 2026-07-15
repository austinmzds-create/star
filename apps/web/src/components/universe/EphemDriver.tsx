'use client';

import { useEffect } from 'react';
import { recomputeEphemeris } from '@/lib/ephemRegistry';
import { recomputeMinorBodies } from '@/lib/minorRegistry';
import { useUniverse } from '@/lib/store';

/**
 * 无渲染组件：订阅 store.observeTime（低频 UI 状态），变化时整批重算
 * 行星/日月星历（<10ms）写入 ephemRegistry 并自增 version。
 * PlanetsLayer / TargetHighlight / CameraRig 只读注册表，帧内零 React 更新。
 *
 * 另带一路「实时模式心跳」：跟随现在时（timeFollowsNow 且未播放）每 30s
 * 按 Date.now() 直驱两个注册表——只写注册表不写 store，行星/月亮/小天体
 * 无需任何 UI 交互即持续微动。
 */
export function EphemDriver() {
  const observeTime = useUniverse((s) => s.observeTime);
  const timeFollowsNow = useUniverse((s) => s.timeFollowsNow);
  const timePlaying = useUniverse((s) => s.timePlaying);

  useEffect(() => {
    // observeTime 尚未初始化时，模块加载已按 Date.now() 算过一遍，无需重复。
    if (observeTime == null) return;
    recomputeEphemeris(observeTime);
  }, [observeTime]);

  // 实时模式 30s 心跳：只写注册表不写 store，与 TimeMachineBar 的
  // 60s observeTime 心跳（驱动 LST/晨昏/信息卡）并存不打架——
  // 两者都单调对齐 Date.now()，注册表重算幂等。
  // 互斥保证：播放/手动时 timeFollowsNow=false 或 timePlaying=true →
  // 提前 return，仅上面的 observeTime effect 驱动；resetToNow 写回两标志
  // 并 set observeTime=now，两路各自补算一次，幂等无争。
  useEffect(() => {
    if (!timeFollowsNow || timePlaying) return;
    const tick = () => {
      const now = Date.now();
      recomputeEphemeris(now);
      // showMinorBodies 用 getState() 读：不订阅不重渲，层关着就省这 <1ms
      if (useUniverse.getState().showMinorBodies) recomputeMinorBodies(now);
    };
    tick(); // 回到实时瞬间立即对齐
    const id = setInterval(tick, 30_000);
    // 后台 tab 定时器被节流：回前台立刻补算一次，避免长挂后坐标陈旧
    const onVis = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [timeFollowsNow, timePlaying]);

  return null;
}
