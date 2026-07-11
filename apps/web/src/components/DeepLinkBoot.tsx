'use client';

/**
 * 主页深链读取（天象日历「在星图中查看」协议）：
 *   /?t=<epochMs>&focus=<objectUid>   → travelTo 事件时刻 + 聚焦天体
 *   /?t=<epochMs>&con=<IAU缩写>       → travelTo + 点亮星座（流星雨辐射点）
 *
 * 只调用现有 store action（travelTo / focusStar / activateConstellation），
 * 不改 store；处理完 router.replace 清空 URL，避免刷新重放。
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { getObjectByUid } from '@/lib/solarSystem';
import { useUniverse } from '@/lib/store';

export function DeepLinkBoot() {
  const params = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const t = Number(params.get('t'));
    const focus = params.get('focus');
    const con = params.get('con');
    if (!focus && !con && !Number.isFinite(t)) return;

    const s = useUniverse.getState();
    if (Number.isFinite(t) && t > 0) s.travelTo(t); // 现成 action：写 observeTime + 退出实时
    if (focus && getObjectByUid(focus)) {
      s.focusStar(focus);
      // 3D 场景 dynamic 晚挂载兜底：2.5s 后若仍选中该天体则重触发 focusNonce
      setTimeout(() => {
        const cur = useUniverse.getState();
        if (cur.selectedUid === focus) cur.focusStar(focus);
      }, 2500);
    } else if (con) {
      s.activateConstellation(con, 'search');
    }
    router.replace('/', { scroll: false }); // 清 URL，避免刷新重放
    // 深链只在首次挂载消费一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
