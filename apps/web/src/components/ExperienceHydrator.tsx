'use client';

import { useEffect } from 'react';
import { startAmbient } from '@/lib/audioEngine';
import { readPref } from '@/lib/prefs';
import {
  useUniverse,
  type LightPollution,
  type SkyRealism,
  type ViewMode,
} from '@/lib/store';

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
    // 观察模式（Phase 9B 地平锁定）：白名单校验，脏值一律回退 'free'；
    // 水合到 'earth' 时同步打开观测辅助（与 setViewMode 的语义保持一致）。
    const viewMode: ViewMode =
      readPref<string>('viewMode.v1', 'free') === 'earth' ? 'earth' : 'free';
    // 真实天空档（Phase 10）：白名单校验，脏值回退默认。持久化为 earth 但从未
    // 存过 realism 时保持 'all'（首帧不强灌；交互再进 earth 才走建议流程）。
    const skyRealism: SkyRealism =
      readPref<string>('skyRealism.v1', 'all') === 'naked' ? 'naked' : 'all';
    const rawLp = readPref<string>('lightPollution.v1', 'suburb');
    const lightPollution: LightPollution =
      rawLp === 'city' || rawLp === 'wild' ? rawLp : 'suburb';
    const planetsEnlarged = readPref<boolean>('planetsEnlarged.v1', true);
    // 星链子档（Phase 10「星链」域）：持久化布尔水合；开启时带开主卫星层
    // （与 toggleStarlink 语义一致，避免水合出「星链开但主层关」的错态）。
    const showStarlink = readPref<boolean>('showStarlink.v1', false) === true;
    useUniverse.setState({
      redLightOn,
      ambientOn,
      ambientVolume,
      viewMode,
      skyRealism,
      lightPollution,
      planetsEnlarged,
      showStarlink,
      ...(showStarlink ? { showSatellites: true } : {}),
      ...(viewMode === 'earth' ? { showHorizon: true } : {}),
    });

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
