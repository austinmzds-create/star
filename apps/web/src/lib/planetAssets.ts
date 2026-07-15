'use client';

import { useEffect, useState } from 'react';
import * as THREE from 'three';

/**
 * 行星 3D 查看器资产表 + 纹理 LRU 缓存（宇宙 V3-C）。
 *
 * 贴图文件由资产脚本落盘至 public/textures/planets/（Solar System Scope,
 * CC-BY-4.0，署名登记见 public/credits.json），本模块只按路径懒加载，
 * 绝不 import 二进制、不进 JS bundle。
 *
 * 加载失败 → 调用方降级为 fallbackColor 纯色球（与 PlanetsLayer 主色一致），
 * 不抛错、不阻塞。
 */

/** 单个星历天体的 3D 查看器资产与展示参数。 */
export interface PlanetAsset {
  /** 星历 uid，如 'EPH-SATURN'。 */
  uid: string;
  /** 球面贴图路径（public 相对路径）。 */
  textureUrl: string;
  /** 环贴图路径（仅土星，带 alpha 的径向条带图）。 */
  ringTextureUrl?: string;
  /** 贴图缺失时的降级纯色（与 astro-ephem bodies 主色一致）。 */
  fallbackColor: string;
  /** 自转轴倾角（度），绕屏幕面内轴倾斜，让土星环/天王星侧躺一眼可辨。 */
  axialTiltDeg: number;
  /** 自转方向：金星/天王星逆向 → -1（视觉彩蛋，速度恒定不追真实周期）。 */
  spinPeriodSign: 1 | -1;
  /** 侧栏中文参数（静态科普数据，硬编码）。 */
  facts: {
    /** 赤道直径（km）。 */
    diameterKm: number;
    /** 自转周期中文描述。 */
    rotationZh: string;
    /** 公转周期中文描述。 */
    orbitZh: string;
  };
}

/** 9 个星历天体的查看器资产表（key = objectUid）。 */
export const PLANET_ASSETS: Record<string, PlanetAsset> = {
  'EPH-SUN': {
    uid: 'EPH-SUN',
    textureUrl: '/textures/planets/sun.jpg',
    fallbackColor: '#FFF2CE',
    axialTiltDeg: 7.25,
    spinPeriodSign: 1,
    facts: {
      diameterKm: 1392700,
      rotationZh: '约 25–35 天（差速自转）',
      orbitZh: '绕银河系中心约 2.3 亿年',
    },
  },
  'EPH-MOON': {
    uid: 'EPH-MOON',
    textureUrl: '/textures/planets/moon.jpg',
    fallbackColor: '#E8E9F0',
    axialTiltDeg: 6.7,
    spinPeriodSign: 1,
    facts: {
      diameterKm: 3474,
      rotationZh: '27.3 天（同步自转）',
      orbitZh: '绕地球 27.3 天 · 朔望月 29.5 天',
    },
  },
  'EPH-MERCURY': {
    uid: 'EPH-MERCURY',
    textureUrl: '/textures/planets/mercury.jpg',
    fallbackColor: '#B8A89A',
    axialTiltDeg: 0.03,
    spinPeriodSign: 1,
    facts: { diameterKm: 4879, rotationZh: '58.6 天', orbitZh: '88 天' },
  },
  'EPH-VENUS': {
    uid: 'EPH-VENUS',
    textureUrl: '/textures/planets/venus.jpg',
    fallbackColor: '#F5E7C8',
    axialTiltDeg: 177.4,
    spinPeriodSign: -1,
    facts: { diameterKm: 12104, rotationZh: '243 天（逆向自转）', orbitZh: '225 天' },
  },
  'EPH-MARS': {
    uid: 'EPH-MARS',
    textureUrl: '/textures/planets/mars.jpg',
    fallbackColor: '#E07850',
    axialTiltDeg: 25.2,
    spinPeriodSign: 1,
    facts: { diameterKm: 6779, rotationZh: '24.6 小时', orbitZh: '687 天' },
  },
  'EPH-JUPITER': {
    uid: 'EPH-JUPITER',
    textureUrl: '/textures/planets/jupiter.jpg',
    fallbackColor: '#E8C8A0',
    axialTiltDeg: 3.1,
    spinPeriodSign: 1,
    facts: { diameterKm: 139820, rotationZh: '9.9 小时', orbitZh: '11.9 年' },
  },
  'EPH-SATURN': {
    uid: 'EPH-SATURN',
    textureUrl: '/textures/planets/saturn.jpg',
    ringTextureUrl: '/textures/planets/saturn_ring.png',
    fallbackColor: '#E5D5A8',
    axialTiltDeg: 26.7,
    spinPeriodSign: 1,
    facts: { diameterKm: 116460, rotationZh: '10.7 小时', orbitZh: '29.5 年' },
  },
  'EPH-URANUS': {
    uid: 'EPH-URANUS',
    textureUrl: '/textures/planets/uranus.jpg',
    fallbackColor: '#A8D8E0',
    axialTiltDeg: 97.8,
    spinPeriodSign: -1,
    facts: { diameterKm: 50724, rotationZh: '17.2 小时（逆向自转）', orbitZh: '84 年' },
  },
  'EPH-NEPTUNE': {
    uid: 'EPH-NEPTUNE',
    textureUrl: '/textures/planets/neptune.jpg',
    fallbackColor: '#7098E8',
    axialTiltDeg: 28.3,
    spinPeriodSign: 1,
    facts: { diameterKm: 49244, rotationZh: '16.1 小时', orbitZh: '165 年' },
  },
};

// ────────────────────────────────────────────────────────────
// 纹理 LRU 缓存（模块级，inline 预览 / modal 全屏共享同一 Texture 实例）
// ────────────────────────────────────────────────────────────

interface CacheEntry {
  /** 加载完成后填充；加载中为 null。 */
  tex: THREE.Texture | null;
  promise: Promise<THREE.Texture>;
  lastUsed: number;
}

/** 容量 4：2048×1024 RGB ≈ 8MB 显存/张，上限 ~32MB，可接受。 */
const CACHE_CAPACITY = 4;
const textureCache = new Map<string, CacheEntry>();

/** 淘汰最久未用的条目并 dispose（three 会在纹理再次被用到时自动重新上传）。 */
function evictOverCapacity(): void {
  while (textureCache.size > CACHE_CAPACITY) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of textureCache) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = key;
      }
    }
    if (!oldestKey) break;
    const entry = textureCache.get(oldestKey);
    textureCache.delete(oldestKey);
    entry?.tex?.dispose();
  }
}

/**
 * 获取（或复用）一张行星贴图。命中缓存直接返回并刷新 lastUsed；
 * 未命中走 TextureLoader（SRGB 色彩空间 + 各向异性 4）。
 * 组件卸载不 dispose（缓存持有），超容量按 LRU 淘汰。
 */
export function acquireTexture(url: string): Promise<THREE.Texture> {
  const hit = textureCache.get(url);
  if (hit) {
    hit.lastUsed = Date.now();
    return hit.promise;
  }
  const promise = new Promise<THREE.Texture>((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        const entry = textureCache.get(url);
        if (entry) entry.tex = tex;
        resolve(tex);
      },
      undefined,
      () => {
        // 失败条目移出缓存（下次可重试），调用方降级纯色球
        textureCache.delete(url);
        reject(new Error(`纹理加载失败: ${url}`));
      },
    );
  });
  textureCache.set(url, { tex: null, promise, lastUsed: Date.now() });
  evictOverCapacity();
  return promise;
}

/** 纹理加载状态。 */
export type PlanetTextureStatus = 'loading' | 'ready' | 'error';

/**
 * Hook 包装：加载一张行星贴图。
 * url 为 undefined（如非土星查环）→ 直接 'error'（调用方按无贴图处理）。
 */
export function usePlanetTexture(url?: string): {
  tex: THREE.Texture | null;
  status: PlanetTextureStatus;
} {
  const [state, setState] = useState<{ tex: THREE.Texture | null; status: PlanetTextureStatus }>({
    tex: null,
    status: 'loading',
  });

  useEffect(() => {
    if (!url) {
      setState({ tex: null, status: 'error' });
      return;
    }
    let alive = true;
    setState({ tex: null, status: 'loading' });
    acquireTexture(url).then(
      (tex) => {
        if (alive) setState({ tex, status: 'ready' });
      },
      () => {
        if (alive) setState({ tex: null, status: 'error' });
      },
    );
    return () => {
      alive = false;
    };
  }, [url]);

  return state;
}
