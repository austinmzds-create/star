'use client';

/**
 * 恒星增强字段（star-extras.json 异步 chunk）web 侧接入（Phase 9C，跨域契约 2）。
 *
 * - useStarExtra(uid)：公信力 UI（StarInfoCard 等）消费——懒加载完成前返回 null，
 *   完成后返回该星的 StarExtra（pm/ci/变星/聚星/IAU 官方名）或 null（无记录）。
 * - ensureStarExtrasReady()：加载 + 一次性接线（目录 pm 回填 + 星座连线 pm 刷新），
 *   TwinkleStars（attribute 回填）与 DeepTimeBar（深时入口 await）共用同一单例——
 *   谁先到谁触发，绝不重复加载。
 */

import {
  applyStarExtrasToCatalog,
  loadStarExtras,
  type StarExtra,
} from '@star/astro-data';
import { useEffect, useState } from 'react';
import { refreshConstellationPmFromCatalog } from './constellation-render';

let readyPromise: Promise<ReadonlyMap<string, StarExtra>> | null = null;
/** 已完成加载的 extras（同步可读，供 hook 首帧命中已加载态，避免闪 null）。 */
let loadedExtras: ReadonlyMap<string, StarExtra> | null = null;

/**
 * 加载 extras 并完成 web 侧数据接线（单例，幂等）：
 * 1. applyStarExtrasToCatalog——目录对象补 pmRaMasYr/pmDecMasYr（9C lean 主表后
 *    深时 CPU 几何唯一的 pm 来源）；
 * 2. refreshConstellationPmFromCatalog——星座连线/成员光环的 pmVec 已在构建期
 *    按（当时为零的）目录 pm 算好，回填后原地刷新，深时形变恢复 9B 行为。
 */
export function ensureStarExtrasReady(): Promise<ReadonlyMap<string, StarExtra>> {
  if (!readyPromise) {
    readyPromise = loadStarExtras().then((extras) => {
      // 空表 = 异步 chunk 拉取失败（离线等）——不接线、不置 loaded、不钉住单例，
      // 下次调用重试（loadStarExtras 同样不缓存空结果）；消费方按降级态处理
      if (extras.size === 0) {
        readyPromise = null;
        return extras;
      }
      applyStarExtrasToCatalog(extras);
      refreshConstellationPmFromCatalog();
      loadedExtras = extras;
      return extras;
    });
  }
  return readyPromise;
}

/** 同步读当前已加载的 extras 表（未加载完成为 null）。非 React 场景用。 */
export function getLoadedStarExtras(): ReadonlyMap<string, StarExtra> | null {
  return loadedExtras;
}

/**
 * 读某颗星的增强字段（跨域契约 2 冻结签名）。
 * 懒加载完成前返回 null；uid 为 null 或无记录也返回 null——调用方按「字段缺席」
 * 优雅降级（徽章不显示），绝不 loading 态阻塞卡片。
 */
export function useStarExtra(uid: string | null): StarExtra | null {
  const [extras, setExtras] = useState<ReadonlyMap<string, StarExtra> | null>(loadedExtras);

  useEffect(() => {
    if (extras) return; // 已就绪（模块级缓存命中）
    let alive = true;
    void ensureStarExtrasReady().then((map) => {
      if (alive) setExtras(map);
    });
    return () => {
      alive = false;
    };
  }, [extras]);

  if (!uid || !extras) return null;
  return extras.get(uid) ?? null;
}
