'use client';

import { useEffect, useRef, useState } from 'react';
import { type HoverInfo, subscribeHover } from '@/lib/hoverBus';
import { kindLabelZh } from '@/lib/objectPresenter';
import { getObjectByUid } from '@/lib/solarSystem';

/**
 * 悬停识别名牌（宇宙 V3-D）：跟随光标的小玻璃标签（中文名 + 类型 + 星等）。
 *
 * 性能纪律：坐标（≈14Hz）经 hoverBus 订阅回调【直改 DOM transform】，
 * 零 React 重渲染；只有 uid 变化（低频）才 setState 换名牌内容
 * （同值 setState React 免费跳过）。触屏设备 CameraRig 不写 hoverBus，
 * 本组件自然静默。点击行为不受影响——名牌 pointer-events: none。
 */
export function HoverTooltip() {
  const [uid, setUid] = useState<string | null>(null);
  // 说明气泡（Phase 10「悬停万物」）：线/区域命中走这条，与天体名牌互斥。
  const [info, setInfo] = useState<HoverInfo | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      subscribeHover((s) => {
        const el = rootRef.current;
        if (!el) return;
        if (s.uid || s.info) {
          // 贴近屏幕右/下边缘时翻转到光标另一侧，避免被裁切
          const flipX = s.x > window.innerWidth - 190;
          const flipY = s.y > window.innerHeight - 80;
          el.style.transform =
            `translate3d(${s.x + (flipX ? -14 : 14)}px, ${s.y + (flipY ? -12 : 18)}px, 0) ` +
            `translate(${flipX ? '-100%' : '0'}, ${flipY ? '-100%' : '0'})`;
          el.style.opacity = '1';
        } else {
          el.style.opacity = '0';
        }
        setUid(s.uid);
        setInfo(s.info);
      }),
    [],
  );

  const obj = uid ? getObjectByUid(uid) : undefined;

  return (
    <div
      ref={rootRef}
      className="pointer-events-none fixed left-0 top-0 z-40 opacity-0 transition-opacity duration-100"
    >
      {obj && (
        <div className="glass flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-1.5 text-[12px]">
          <span className="font-medium text-white">{obj.nameZh}</span>
          <span className="rounded-full border border-nebula-400/25 px-1.5 text-[10px] text-nebula-200/80">
            {kindLabelZh(obj)}
          </span>
          <span className="text-nebula-200/60">{obj.magnitude.toFixed(1)} 等</span>
        </div>
      )}
      {/* 线/区域说明气泡（黄道/天赤道/网格圈/地平线/银河/星座连线） */}
      {!obj && info && (
        <div className="glass flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-1.5 text-[12px]">
          <span aria-hidden className="text-[13px]">
            {info.icon}
          </span>
          <span className="font-medium text-white">{info.title}</span>
          {info.sub && <span className="text-nebula-200/60">{info.sub}</span>}
        </div>
      )}
    </div>
  );
}
