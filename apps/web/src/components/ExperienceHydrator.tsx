'use client';

import { useEffect } from 'react';
import { startAmbient } from '@/lib/audioEngine';
import { readPref } from '@/lib/prefs';
import { useUniverse } from '@/lib/store';

/**
 * 体验层水合器（Phase 6B，layout 级 null 渲染客户端组件）。职责三件：
 *  1. 客户端挂载后读 localStorage 偏好一次性写回 store
 *     （SSR 首帧用默认值，避免 zustand create 阶段读 localStorage 水合不一致）；
 *  2. 环境音恢复兜底：持久化 ambientOn=true 时刷新后不能自动出声
 *     （autoplay 政策），注册一次性 pointerdown——用户第一次触碰页面任意处，
 *     环境音无感恢复；红光是纯 CSS 无此问题；
 *  3. 生产环境注册 PWA service worker（延迟 3s，不抢首屏带宽；dev 不注册
 *     防缓存干扰开发）。
 */
export function ExperienceHydrator() {
  useEffect(() => {
    const redLightOn = readPref('redLight', false);
    const ambientOn = readPref('ambientOn', false);
    const rawVolume = readPref('ambientVolume', 0.5);
    const ambientVolume =
      typeof rawVolume === 'number' && Number.isFinite(rawVolume)
        ? Math.min(1, Math.max(0, rawVolume))
        : 0.5;
    useUniverse.setState({ redLightOn, ambientOn, ambientVolume });

    if (!ambientOn) return;
    const resume = () => startAmbient(useUniverse.getState().ambientVolume);
    window.addEventListener('pointerdown', resume, { once: true, capture: true });
    return () => window.removeEventListener('pointerdown', resume, { capture: true });
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    const timer = window.setTimeout(() => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* 注册失败不影响主功能 */
      });
    }, 3000);
    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
