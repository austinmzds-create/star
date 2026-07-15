'use client';

import { useEffect, useRef, useState } from 'react';
import { isGyroCandidate, startGyro, stopGyro } from '@/lib/gyro';
import { useUniverse } from '@/lib/store';

/**
 * 「指向天空」悬浮钮（Phase 6B 目标 9，仅移动端）。
 *
 * 显隐：useEffect 内判定 isGyroCandidate()（粗指针 + DeviceOrientationEvent）
 * 后才 setState 显示——SSR 首帧不渲染，无水合警告；桌面自然隐藏。
 * 状态机：idle → starting（请求权限/挂监听）→ active（陀螺仪接管相机）；
 * 点按退出，或被拖拽/镜头飞行抢占相机后经 store.gyroActive 自动回 idle。
 * denied/unsupported → 按钮上方小气泡提示 4s，不引入全局 toast 系统。
 */
export function GyroModeButton() {
  const [candidate, setCandidate] = useState(false);
  const [starting, setStarting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const gyroActive = useUniverse((s) => s.gyroActive);
  const toastTimer = useRef<number | undefined>(undefined);
  const hintTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    setCandidate(isGyroCandidate());
    return () => {
      if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current);
      if (hintTimer.current !== undefined) window.clearTimeout(hintTimer.current);
      stopGyro(); // 组件卸载兜底退出
    };
  }, []);

  if (!candidate) return null;

  const flashToast = (text: string) => {
    setToast(text);
    if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  };

  const onClick = async () => {
    if (gyroActive) {
      stopGyro();
      return;
    }
    if (starting) return;
    setStarting(true);
    try {
      const result = await startGyro(() => flashToast('设备不支持方向传感器'));
      if (result === 'denied') {
        flashToast('未获得方向传感器权限，请在系统设置中允许后重试');
      } else if (result === 'unsupported') {
        flashToast('设备不支持方向传感器');
      } else {
        // 首次激活提示 3s
        setShowHint(true);
        if (hintTimer.current !== undefined) window.clearTimeout(hintTimer.current);
        hintTimer.current = window.setTimeout(() => setShowHint(false), 3000);
      }
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="pointer-events-none absolute bottom-24 right-5 z-30 flex flex-col items-end gap-2">
      {toast && (
        <div className="pointer-events-none max-w-[220px] rounded-xl border border-white/10 bg-void/85 px-3 py-2 text-[11.5px] leading-relaxed text-nebula-100/90 backdrop-blur">
          {toast}
        </div>
      )}
      {gyroActive && showHint && (
        <div className="pointer-events-none max-w-[220px] rounded-xl border border-nebula-400/30 bg-void/85 px-3 py-2 text-[11.5px] leading-relaxed text-nebula-100/90 backdrop-blur">
          移动手机对准天空 · 点按退出
        </div>
      )}
      <button
        onClick={() => void onClick()}
        aria-label={gyroActive ? '退出指向天空模式' : '指向天空'}
        aria-pressed={gyroActive}
        className={`pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border text-[20px] backdrop-blur transition ${
          gyroActive
            ? 'animate-pulse border-nebula-400/70 bg-nebula-500/30 text-white shadow-[0_0_18px_4px_rgba(107,115,255,0.4)]'
            : 'border-white/15 bg-void/70 text-nebula-100/90'
        }`}
      >
        {starting ? (
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-nebula-200/30 border-t-white" />
        ) : (
          '🧭'
        )}
      </button>
    </div>
  );
}
