'use client';

import { useEffect, useState } from 'react';
import { raDecToVector3 } from '@star/astro-core';
import type { DeviceTier } from '@/lib/deviceTier';
import { useUniverse } from '@/lib/store';
import {
  MAS_YR_TO_RAD_YR,
  magnitudeToSize,
  SPHERE_RADIUS,
  spectralColor,
  type StarAttributes,
} from '@/lib/universe';
import { TwinkleStars } from './TwinkleStars';

/**
 * 扩展星场（mag 6.5–7.5，≈1.7 万颗，HYG v41）——纯渲染锦上添花层。
 *
 * - 数据放 public/data/stars-extended.json（列式短键，随仓库提交），
 *   首帧后 requestIdleCallback 懒 fetch，不进主 bundle、不阻塞首屏；
 *   fetch/解析失败一律静默放弃（核心层已完整可用）。
 * - 【拾取取舍：完全不参与拾取。】这批星无名称、无 uid、不入命名池，
 *   点中了也没有信息卡可展示；1.7 万点进线性拾取会把点击延迟翻倍并
 *   大幅提高误触率——用户想点的永远是更亮的星（见 lib/pickRegistry.ts）。
 * - 移动/低端设备（tier='low'）不加载：省 ~200KB 流量与 1.7 万点填充率。
 */

/** 列式 JSON 契约（由 astro-data 的 build-catalog 脚本生成）。 */
interface ExtendedStarsJson {
  n: number;
  ra: number[];
  dec: number[];
  mag: number[];
  /** 长度 n 的字符串，每颗 1 字符光谱主类（OBAFGKM，未知 '?'）。 */
  spec: string;
  /**
   * 自行两列（9B 深时模式）：int16 语义整数，单位 0.5 mas/yr（解码 mas/yr =
   * 值 × 0.5；缺测为 0）。可选——旧缓存 JSON 无此列时扩展星在时光机里不动。
   */
  pmra?: number[];
  pmdec?: number[];
}

/** 列式数据 → TwinkleStars 属性（一次性，发生在 idle 回调内，非帧循环）。 */
function buildExtendedAttributes(data: ExtendedStarsJson): StarAttributes {
  const count = data.n;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const pms = new Float32Array(count * 2);
  const mags = new Float32Array(count); // Phase 10：真实星等（防未来放宽档位；全在 6.5–7.5）
  // 自行列解码（9B）：int16 语义 × 0.5 = mas/yr，再预转 rad/yr 供 aPm。
  // 长度不齐/缺列（旧缓存）→ 全 0，星不动（isValidPayload 只强校验必需列）。
  const hasPm = data.pmra?.length === count && data.pmdec?.length === count;

  for (let i = 0; i < count; i++) {
    const ra = data.ra[i] ?? 0;
    const dec = data.dec[i] ?? 0;
    const mag = data.mag[i] ?? 7.5;
    mags[i] = mag;
    const v = raDecToVector3({ raDeg: ra, decDeg: dec }, SPHERE_RADIUS * 0.995);
    positions[i * 3] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;

    if (hasPm) {
      pms[i * 2] = (data.pmra![i] ?? 0) * 0.5 * MAS_YR_TO_RAD_YR;
      pms[i * 2 + 1] = (data.pmdec![i] ?? 0) * 0.5 * MAS_YR_TO_RAD_YR;
    }

    const [r, g, b] = spectralColor(data.spec[i]);
    // 比核心层更暗淡：整体压 0.8，视觉上明确是「更深一层」的星
    colors[i * 3] = r * 0.8;
    colors[i * 3 + 1] = g * 0.8;
    colors[i * 3 + 2] = b * 0.8;

    // mag>6.5 的 magnitudeToSize 落在 clamp 下限附近，再封 3px 上限
    sizes[i] = Math.min(magnitudeToSize(mag), 3);
    phases[i] = (i * 2.399963) % (Math.PI * 2);
  }

  return { positions, colors, sizes, phases, count, pms, mags };
}

/** 结构校验：字段缺失/长度不齐时视为坏数据，静默放弃。 */
function isValidPayload(data: unknown): data is ExtendedStarsJson {
  const d = data as Partial<ExtendedStarsJson> | null;
  return (
    !!d &&
    typeof d.n === 'number' &&
    d.n > 0 &&
    Array.isArray(d.ra) &&
    Array.isArray(d.dec) &&
    Array.isArray(d.mag) &&
    typeof d.spec === 'string' &&
    d.ra.length === d.n &&
    d.dec.length === d.n &&
    d.mag.length === d.n &&
    d.spec.length === d.n
  );
}

export function ExtendedStars({ tier }: { tier: DeviceTier }) {
  const [attributes, setAttributes] = useState<StarAttributes | null>(null);
  // 真实模式（Phase 10）：扩展层 mag 全在 6.5–7.5，任何裸眼档（≤6.5）都会整层
  // 被 shader 隐掉——直接短路省掉 1.7 万点顶点+塌零的白跑。satisfies「真实模式
  // 关闭扩展层」，且切回 'all' 时组件重挂再懒加载。
  const realism = useUniverse((s) => s.skyRealism);

  useEffect(() => {
    if (tier === 'low') return; // 降级：低端设备不加载扩展层
    if (realism !== 'all') return;
    let cancelled = false;
    let idleId: number | null = null;
    let timerId: number | null = null;

    const load = () => {
      fetch('/data/stars-extended.json')
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((data: unknown) => {
          if (cancelled || !isValidPayload(data)) return;
          // ≈1.7 万循环 5–8ms：一次性、发生在 rAF 之外，不卡帧循环
          setAttributes(buildExtendedAttributes(data));
        })
        .catch(() => {
          /* 纯锦上添花层：静默降级 */
        });
    };

    // 首帧渲染后的空闲时机触发（fallback: 2.5s 定时器）
    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(load, { timeout: 4000 });
    } else {
      timerId = window.setTimeout(load, 2500);
    }
    return () => {
      cancelled = true;
      if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [tier, realism]);

  // 真实模式整层关闭（即便已加载过 attributes 也不渲染，省填充率）
  if (realism !== 'all' || !attributes) return null;
  // 复用核心层同一套点着色器：恒星 draw call 2 → 3（预算内）
  return <TwinkleStars attributes={attributes} twinkle={0.9} sizeScale={0.8} renderOrder={1} />;
}
