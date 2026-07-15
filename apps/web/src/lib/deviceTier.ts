/**
 * 设备性能分档 v2（Phase 9A：high/mid/low 三档，r-perf §2.7 / r-fx §3.c）。
 *
 * 判定流程：
 *  1. 启动同步启发式（一次缓存）：
 *     - WEBGL_debug_renderer_info 探测软渲染（SwiftShader/llvmpipe）→ 强制 low
 *       （headless 截图/E2E 环境，全屏后处理在软渲染上每帧 +30–80ms）；
 *     - 明确弱机（核 ≤2 / 内存 ≤2GB / 小屏触屏且核 ≤4 或内存 ≤4GB）→ low；
 *     - 现代手机（小屏触屏）→ mid；触屏大屏 ≥820（平板，填充率受限的移动
 *       GPU，v1 误判 high 的洞）→ mid；4 核老桌面 / ≤4GB → mid（v1 误判 low）；
 *     - 其余 → high。
 *  2. drei DetectGPU（detect-gpu 基准库，benchmarks 自托管在 /gpu-benchmarks，
 *     无 CDN 外链）异步到达后升/降档一次（applyGpuTier），此后不再变。
 *     运行期的动态降载走 lib/perfBus.ts（PerformanceMonitor 熔断），不在本层。
 *
 * 各档降级项由消费组件执行（现有 `tier === 'low'` 判断全部兼容：mid 走
 * 原 high 路径，仅在显式区分处收紧）：
 *   low：dpr≤1.5 / 关 antialias / 无扩展星场 / 环境星场减半 / 无 composer；
 *   mid：dpr≤1.5 / 银河 2k / composer 走 SMAA + 半强度 Bloom、无 GodRays；
 *   high：全量（4k 银河 / MSAA composer / GodRays）。
 */

export type DeviceTier = 'high' | 'mid' | 'low';

let cached: DeviceTier | null = null;
let gpuApplied = false;
const listeners = new Set<() => void>();

/**
 * 一次性 WebGL 探针：读 UNMASKED_RENDERER_WEBGL 识别软渲染。
 * 临时上下文用完即 loseContext 释放，避免占用浏览器上下文配额。
 */
function probeRendererString(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ||
      (canvas.getContext('webgl') as WebGLRenderingContext | null);
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext
      ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '')
      : String(gl.getParameter(gl.RENDERER) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return renderer;
  } catch {
    return '';
  }
}

function computeTier(): DeviceTier {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return 'high';

  // 软渲染（Playwright/SwiftShader/llvmpipe）：能跑 WebGL2 但全屏 pass 极慢，
  // 强制 low 保持「无 composer 直出」现管线（r-fx §2.1.8）。
  if (/swiftshader|llvmpipe|software/i.test(probeRendererString())) return 'low';

  const cores = navigator.hardwareConcurrency ?? 8;
  // deviceMemory 是非标准字段（Chrome 系），类型上不存在，运行时探测。
  const deviceMemory = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 1;
  const smallTouch = touch && window.innerWidth < 820;

  // 明确弱机 → low
  if (cores <= 2 || (deviceMemory !== undefined && deviceMemory <= 2)) return 'low';
  if (smallTouch && (cores <= 4 || (deviceMemory !== undefined && deviceMemory <= 4))) {
    return 'low';
  }
  // 现代手机 / 平板（触屏大屏 ≥820 封顶 mid，堵 v1 的 iPad 满档洞）→ mid
  if (touch) return 'mid';
  // 4 核老桌面 / 低内存桌面：v1 误判 low，实际带独显也够 mid
  if (cores <= 4 || (deviceMemory !== undefined && deviceMemory <= 4)) return 'mid';
  return 'high';
}

export function getDeviceTier(): DeviceTier {
  if (cached === null) cached = computeTier();
  return cached;
}

/** 订阅档位变化（只会因 applyGpuTier 触发至多一次）；useSyncExternalStore 形状。 */
export function subscribeDeviceTier(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** detect-gpu 结果的结构子集（不直接依赖 detect-gpu 类型，避免引入传递依赖）。 */
export interface GpuTierResult {
  tier: number;
  type?: string;
  isMobile?: boolean;
}

/**
 * DetectGPU 异步结果到达后升/降档一次（仅第一次调用生效）：
 *  - BLOCKLISTED / 基准 tier 0（<15fps 档）→ low；
 *  - 基准 tier 1 → high 降 mid（中端核显误判 high 的洞）；
 *  - 基准 tier 2 → 维持启发式（GPU 尚可，CPU/内存启发式更保守时听它的）；
 *  - 基准 tier 3 → 非触屏升 high（4 核老桌面 + 独显被启发式压 mid 的反向洞）；
 *    触屏设备不升——平板填充率天花板仍在，封顶 mid；
 *  - FALLBACK / SSR 等非基准结果一律不采信（benchmarks 拉取失败时 detect-gpu
 *    会退化为 FALLBACK tier 1，不能据此把高端机降档）。
 */
export function applyGpuTier(result: GpuTierResult): void {
  if (gpuApplied) return;
  gpuApplied = true;
  const cur = getDeviceTier();
  let next = cur;
  const type = result.type ?? '';
  if (type === 'BLOCKLISTED' || (type === 'BENCHMARK' && result.tier <= 0)) {
    next = 'low';
  } else if (type !== 'BENCHMARK') {
    return;
  } else if (result.tier === 1) {
    next = cur === 'high' ? 'mid' : cur;
  } else if (result.tier >= 3 && !result.isMobile && cur === 'mid') {
    next = 'high';
  }
  if (next === cur) return;
  cached = next;
  for (const l of listeners) l();
}
