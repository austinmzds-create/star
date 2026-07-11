'use client';

import { useEffect } from 'react';
import { recomputeEphemeris } from '@/lib/ephemRegistry';
import { useUniverse } from '@/lib/store';

/**
 * 无渲染组件：订阅 store.observeTime（低频 UI 状态），变化时整批重算
 * 行星/日月星历（<10ms）写入 ephemRegistry 并自增 version。
 * PlanetsLayer / TargetHighlight / CameraRig 只读注册表，帧内零 React 更新。
 */
export function EphemDriver() {
  const observeTime = useUniverse((s) => s.observeTime);

  useEffect(() => {
    // observeTime 尚未初始化时，模块加载已按 Date.now() 算过一遍，无需重复。
    if (observeTime == null) return;
    recomputeEphemeris(observeTime);
  }, [observeTime]);

  return null;
}
