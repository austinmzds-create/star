'use client';

import { DEEP_SKY_CATALOG, type CelestialObject } from '@star/astro-data';
import * as THREE from 'three';

/**
 * 著名深空天体（DSO）真实照片层的渲染元数据与纹理管线（宇宙 V3-B）。
 *
 * 数据侧（astro-data）：16 个最著名 Messier 携带 imageKey / imageCredit，
 * 全量 DSO 携带 angularSizeDeg（OpenNGC majAx 换算）——本模块从
 * DEEP_SKY_CATALOG 派生照片清单，不重复登记坐标/尺寸；纯渲染参数
 * （显示尺寸钳制、滚转角、加载策略）归本模块（数据与视觉解耦）。
 *
 * 照片素材：NASA/Hubble PD、ESO CC-BY、Wikimedia Commons PD/CC-BY，
 * 许可登记见 public/credits.json 与 docs/credits.md。资产路径约定
 * （fetch-assets 脚本落盘，不 import 二进制）：
 *   /dso-photos/{imageKey}.jpg   （长边 ≤800px，单张 ≈100–300KB）
 * 照片缺失/加载失败 → 该天体静默回退为程序化 sprite（DeepSkyLayer 只在
 * 「照片真正可展示」事件后才隐藏对应点位）。
 *
 * 角尺寸策略：大目标（M31≈3.0°、M45≈2.5°）用真实值；小目标（M57 真实
 * 仅 0.02°）低于「视觉下限」时钳到 MIN_RENDER_DEG，否则在 60° FOV 下
 * 不足数像素、比现有程序 sprite 还小，属于视觉降级（致谢面板 note 已注明
 * 「部分小角径深空天体的显示尺寸经放大以保证可见性」）。
 */

/** 渲染角尺寸下限（度）：真实角尺寸过小的目标钳到此值，保证可辨识。 */
const MIN_RENDER_DEG = 1.3;
/** 渲染角尺寸上限（度）：防个别超大目标喧宾夺主。 */
const MAX_RENDER_DEG = 3.2;

export interface DsoPhotoMeta {
  /** 天体 objectUid（与 DEEP_SKY_CATALOG / pickRegistry 一致，如 'M31'）。 */
  uid: string;
  /** 影像键（astro-data imageKey），对应 /dso-photos/{imageKey}.jpg。 */
  imageKey: string;
  /** J2000 赤经（度）。 */
  raDeg: number;
  /** J2000 赤纬（度）。 */
  decDeg: number;
  /** 渲染角尺寸（度，已按 MIN/MAX 钳制）。 */
  sizeDeg: number;
  /** 真实长轴角尺寸（度，来自 OpenNGC majAx），供 UI/调试参考。 */
  trueSizeDeg: number;
  /**
   * 照片相对「RA+ 向左、Dec+ 向上」观星方向的滚转角（度，逆时针为正）。
   * 资产就绪后按实拍方向标定；未标定为 0（照片方向与天球姿态可能有偏差，
   * 对氛围呈现可接受，标定属后续打磨项）。
   */
  rollDeg: number;
}

/**
 * 知名度排序（低端设备只加载前 LOW_TIER_PHOTO_COUNT 个）。
 * 目录里新增 imageKey 而未列入此表的天体会自动追加在末尾（不会丢）。
 */
const PHOTO_PRIORITY: string[] = [
  'M31', 'M42', 'M45', 'M8', 'M51', 'M13', 'M57', 'M27',
  'M16', 'M20', 'M17', 'M104', 'M81', 'M101', 'M33', 'M1',
];

function toMeta(obj: CelestialObject): DsoPhotoMeta {
  const trueSizeDeg = obj.angularSizeDeg ?? MIN_RENDER_DEG;
  return {
    uid: obj.objectUid,
    imageKey: obj.imageKey!,
    raDeg: obj.raDeg,
    decDeg: obj.decDeg,
    sizeDeg: THREE.MathUtils.clamp(trueSizeDeg, MIN_RENDER_DEG, MAX_RENDER_DEG),
    trueSizeDeg,
    rollDeg: 0,
  };
}

/** 真实照片 DSO 清单（由 DEEP_SKY_CATALOG 的 imageKey 派生，按知名度排序）。 */
export const DSO_PHOTOS: DsoPhotoMeta[] = (() => {
  const byUid = new Map(
    DEEP_SKY_CATALOG.filter((o) => o.imageKey).map((o) => [o.objectUid, o]),
  );
  const metas: DsoPhotoMeta[] = [];
  for (const uid of PHOTO_PRIORITY) {
    const obj = byUid.get(uid);
    if (obj) {
      metas.push(toMeta(obj));
      byUid.delete(uid);
    }
  }
  for (const obj of byUid.values()) metas.push(toMeta(obj)); // 排序表未收录的兜底追加
  return metas;
})();

/** 低端设备照片数量上限（前 8 个最著名，省内存与请求）。 */
export const LOW_TIER_PHOTO_COUNT = 8;

/** 照片资产 URL（public/ 下运行时懒加载，不进 JS bundle）。 */
export function dsoPhotoUrl(imageKey: string): string {
  return `/dso-photos/${imageKey}.jpg`;
}

// ── 纹理加载（canvas 预处理 + 模块级缓存） ──

/** 处理后纹理画布边长：≤800px 源图降采样到 512（POT，mipmaps 友好）。 */
const PHOTO_CANVAS_SIZE = 512;

/**
 * 照片 → 512² CanvasTexture：
 *  1. 水平预翻转 —— 切平面 lookAt 球心后正面朝外，球心内相机看到背面
 *     （左右镜像）；预翻一次让照片以真实方向呈现（星系旋向不反）。
 *  2. cover 裁切到正方形（照片长宽比不一，取中心区域）。
 *  3. 径向渐变蒙版（外缘 28% 淡出到全透明）——JPG 无 alpha，硬边矩形
 *     在星空上会露出「贴纸边」；加色混合下暗背景本近似不可见，蒙版兜底。
 */
function processPhoto(img: HTMLImageElement): THREE.CanvasTexture {
  const size = PHOTO_CANVAS_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // 1. 水平预翻转 + 2. cover 裁切
  ctx.translate(size, 0);
  ctx.scale(-1, 1);
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  ctx.drawImage(
    img,
    (img.naturalWidth - s) / 2,
    (img.naturalHeight - s) / 2,
    s,
    s,
    0,
    0,
    size,
    size,
  );

  // 3. 径向淡出蒙版（destination-out：渐变不透明处被抠掉）
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-out';
  const half = size / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.72, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 模块级纹理缓存（≤16 张 512²，常驻；键为 imageKey）。 */
const photoTextureCache = new Map<string, Promise<THREE.CanvasTexture>>();

/** 加载并预处理一张 DSO 照片纹理（幂等；失败从缓存移除以允许重试）。 */
export function loadDsoPhotoTexture(imageKey: string): Promise<THREE.CanvasTexture> {
  const hit = photoTextureCache.get(imageKey);
  if (hit) return hit;

  const promise = new Promise<THREE.CanvasTexture>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(processPhoto(img));
    img.onerror = () => reject(new Error(`dso photo load failed: ${imageKey}`));
    img.src = dsoPhotoUrl(imageKey);
  });
  photoTextureCache.set(imageKey, promise);
  promise.catch(() => photoTextureCache.delete(imageKey));
  return promise;
}

// ── 「照片已可展示」事件（DeepSkyLayer 据此淡出对应程序 sprite） ──

type PhotoShownListener = (uid: string) => void;
const photoShownListeners = new Set<PhotoShownListener>();

/** 已进入可展示状态（纹理就绪且切平面已挂载）的 DSO uid 集合。 */
export const shownDsoPhotos = new Set<string>();

/**
 * 标记某 DSO 的照片已可展示。由 DsoPhotoLayer 在纹理挂上材质后调用；
 * DeepSkyLayer 收到后把该天体的程序 sprite 淡出（aPhotoHide → 1）。
 */
export function markDsoPhotoShown(uid: string): void {
  if (shownDsoPhotos.has(uid)) return;
  shownDsoPhotos.add(uid);
  for (const cb of photoShownListeners) cb(uid);
}

/** 订阅「照片已可展示」事件；返回退订函数。已发生的事件读 shownDsoPhotos。 */
export function subscribeDsoPhotoShown(cb: PhotoShownListener): () => void {
  photoShownListeners.add(cb);
  return () => {
    photoShownListeners.delete(cb);
  };
}
