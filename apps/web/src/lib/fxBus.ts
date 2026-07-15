import type { Mesh } from 'three';

/**
 * 后处理运行时总线（模块级单例，非 React 状态）——「后处理」域创建并独家拥有。
 * 与 hoverBus/ephemRegistry 同一套「模块单例 + 帧循环直读」纪律。
 *
 * 【跨域契约（Phase 9A 冻结）】setGlobalFade / getGlobalFade：
 *   全局亮度系数 0–1（默认 1）。「动效序曲」域只 import 写入；
 *   TwinkleStars / MilkyWayLayer 在各自 useFrame 里把它乘进最终亮度
 *   （uniform 直写，零 React）。序曲被打断即写回 1，渲染层无需感知序曲存在。
 *
 * 其余导出为后处理域内部共享状态（PostFX 低频写、各渲染层帧循环读），
 * 不属于跨域契约，其它域不得依赖。
 */

let globalFade = 1;

/** 写全局亮度 0–1（越界自动夹取）。「动效序曲」域唯一允许调用的写入口。 */
export function setGlobalFade(v: number): void {
  globalFade = v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 读全局亮度（TwinkleStars/MilkyWayLayer 每帧读，乘进最终亮度）。 */
export function getGlobalFade(): number {
  return globalFade;
}

// ---------------------------------------------------------------------------
// 以下为后处理域内部状态（PostFX 写 / 渲染层读），零订阅、帧循环直读。
// ---------------------------------------------------------------------------

/**
 * 帧循环直读字段（写方仅 PostFX，均为低频写）：
 * - bloomBoost：亮星 HDR 超白强度 0–1。只有 Bloom 激活（composer 且 level≥2）
 *   才 >0——超白输出在无 tonemapping 的直出管线下会硬剪切成白块，必须联动。
 * - spike：亮星衍射芒开关 0/1（低档关，r-fx §3.c）。
 * - grade：ACES 校色补偿系数（composer 激活 ≈0.92，关闭 1）。ACES 对银河
 *   所在的线性中暗区净提亮（推导见 PostFX.GRADE_ACES），MilkyWayLayer 把它
 *   乘进 uExposure 拉回，保证开关 composer 前后银河观感一致。
 * - sunLight：GodRays 光源盘可见性 0/1。PostFX 挂载 GodRays 时置 1，
 *   PlanetsLayer 据此显隐太阳 CircleMesh（无 GodRays 时硬边圆盘反而难看）。
 * - linearPipe：合成管线域标志 0/1。composer 激活时链尾 EffectPass 会做
 *   linear→sRGB 编码（three 内建材质靠它才正确），而 TwinkleStars/薄雾带
 *   这类「显示参考」手写 shader 必须先把输出反解回线性域，否则被二次编码
 *   洗白（实测踩坑；三方消费见 TwinkleStars.tsx / MilkyWayLayer.tsx）。
 */
export const fx = {
  bloomBoost: 0,
  spike: 0,
  grade: 1,
  sunLight: 0,
  linearPipe: 0,
};

// composer 激活状态（低频布尔）：UniverseScene 订阅它决定 CSS vignette 兜底
// 是否显示——composer 内的 Vignette 效果与 CSS 径向渐变二选一，不叠加。
let composerActive = false;
const composerListeners = new Set<() => void>();

/** 仅 PostFX 调用：composer 挂载/卸载（含运行时熔断整关）时同步。 */
export function setComposerActive(v: boolean): void {
  if (composerActive === v) return;
  composerActive = v;
  for (const l of composerListeners) l();
}

export function getComposerActive(): boolean {
  return composerActive;
}

/** 订阅 composer 激活变化（useSyncExternalStore 形状）；返回退订函数。 */
export function subscribeComposerActive(listener: () => void): () => void {
  composerListeners.add(listener);
  return () => {
    composerListeners.delete(listener);
  };
}

// GodRays 光源注册表：PlanetsLayer（高档）把太阳位的 CircleMesh 注册进来，
// PostFX 订阅后作为 <GodRays sun={mesh}> 的光源。跨组件传 three 对象走模块
// 注册表而非 React context——两个组件分属 Canvas 树的不同分支。
let sunLightMesh: Mesh | null = null;
const sunListeners = new Set<() => void>();

/** 仅 PlanetsLayer 调用：挂载注册 / 卸载注销（传 null）。 */
export function setSunLightMesh(mesh: Mesh | null): void {
  if (sunLightMesh === mesh) return;
  sunLightMesh = mesh;
  for (const l of sunListeners) l();
}

export function getSunLightMesh(): Mesh | null {
  return sunLightMesh;
}

/** 订阅太阳光源 mesh 变化（useSyncExternalStore 形状）；返回退订函数。 */
export function subscribeSunLightMesh(listener: () => void): () => void {
  sunListeners.add(listener);
  return () => {
    sunListeners.delete(listener);
  };
}
