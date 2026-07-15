'use client';

import { PerformanceMonitor } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import {
  Bloom,
  EffectComposer,
  GodRays,
  Noise,
  SMAA,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing';
import {
  BlendFunction,
  ToneMappingMode,
  type BloomEffect,
  type GodRaysEffect,
} from 'postprocessing';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import type { DeviceTier } from '@/lib/deviceTier';
import {
  fx,
  getSunLightMesh,
  setComposerActive,
  subscribeSunLightMesh,
} from '@/lib/fxBus';
import { setPerfTier, type PerfTier } from '@/lib/perfBus';

/**
 * 后处理管线 + 运行时熔断（Phase 9A，r-fx §2.1/§2.2/§3.c）。
 *
 * 效果链（postprocessing 把全部 Effect 自动合并为一个全屏 pass，场景的
 * 单 draw call 结构不动；帧成本预估见 r-fx §2.1 末表）：
 *   GodRays（高档 + 太阳屏内才挂，samples 32）
 *   → Bloom（mipmapBlur，luminanceThreshold 1.0——只有 HDR 超白像素发光，
 *     选择性泛光不走 Selection/layer 二次渲染；亮星超白见 TwinkleStars，
 *     行星见 PlanetsLayer）
 *   → ToneMapping（ACES_FILMIC；校色补偿走 fxBus.fx.grade，银河层消费）
 *   → Vignette（替换 UniverseScene 的 CSS 径向渐变，同层只留一份）
 *   → Noise 0.015（SCREEN 混合，压暗部渐变 banding 的抖动颗粒）
 *   → 抗锯齿：高档 composer MSAA×4，中档 SMAA（composer 激活后 canvas 的
 *     antialias 失效，必须二选一）；低档整组件不渲染 composer，保持现直出管线。
 *
 * 熔断阶梯（drei PerformanceMonitor，r-perf §2.7）：
 *   level 3 全量 → 2 关 GodRays → 1 关 Bloom → 0 composer 整关；
 *   onIncline 逐级恢复（封顶设备档），flipflops=3 触发 onFallback 永久锁 0。
 *   level 变化同步写 perfBus（其它域按档降载）与 fxBus（渲染层 uniform 联动）。
 *
 * 逃生门（截图/E2E 用）：?fx=0 查询参数或 NEXT_PUBLIC_FX=0 环境变量强制
 * 不挂 composer（deviceTier 的 SwiftShader 探测是兜底，这是显式开关）。
 *
 * 帧循环纪律：呼吸/太阳屏内判定在 useFrame 内直写 effect 属性与模块标志，
 * 仅屏内布尔翻转（滞回去抖后极低频）touch React 状态。
 */

/** 各设备档的熔断起始档位（同时是 onIncline 恢复上限）。 */
const LEVEL_CAP: Record<DeviceTier, number> = { high: 3, mid: 2, low: 0 };

/** level → 对外广播的运行时质量档（1=Bloom 已熔断，其它域也该进保守档）。 */
const PERF_BY_LEVEL: PerfTier[] = ['low', 'low', 'mid', 'high'];

/**
 * ACES 校色补偿系数（乘进 MilkyWayLayer uExposure）：postprocessing 的
 * ACES_FILMIC 移植自 three（含 1/0.6 曝光归一），对线性域 0.05–0.3 的
 * 中暗部有 15–30% 提亮、对 >0.8 高光压缩——银河纹理大面积落在中暗区，
 * 净效果偏亮；乘 0.92 拉回整体明度，让高光滚降作为「胶片感」保留。
 * 星点核区的压缩由 HDR 超白 + Bloom 补偿，不单独校。
 */
const GRADE_ACES = 0.92;

/** 亮星 HDR 超白强度：高档全量，中档随 Bloom intensity 减半同步收敛。 */
const BOOST_BY_TIER: Record<DeviceTier, number> = { high: 1, mid: 0.7, low: 0 };

/** Bloom 基准强度（r-fx §2.1.3 高档 0.6；§3.c 中档减半）。 */
const BLOOM_BASE: Record<DeviceTier, number> = { high: 0.6, mid: 0.3, low: 0 };

/** 太阳屏内判定滞回（NDC 半宽）：进 1.05 / 出 1.25，防边缘往返抖动重挂 effect。 */
const SUN_ENTER_NDC = 1.05;
const SUN_EXIT_NDC = 1.25;

const scratchSun = new THREE.Vector3();

/**
 * 显式逃生门：?fx=0 / NEXT_PUBLIC_FX=0（构建期内联）。挂载时判定一次。
 * 查询串先看当前 URL（客户端路由跳转进来的 /?fx=0，navigation entry 只有
 * 首个文档 URL，查不到），再从 navigation entry 的「原始文档 URL」兜底——
 * DeepLinkBoot 首帧会 router.replace 清空查询串，而本组件在 dynamic 场景
 * chunk 里晚于它挂载，届时 location.search 已被清掉（实测踩坑）。
 */
function fxForcedOff(): boolean {
  if (process.env.NEXT_PUBLIC_FX === '0') return true;
  if (typeof window === 'undefined') return false;
  if (/[?&]fx=0(&|$)/.test(window.location.search)) return true;
  try {
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    const url = new URL(nav?.name || window.location.href, window.location.origin);
    return url.searchParams.get('fx') === '0';
  } catch {
    return false;
  }
}

export function PostFX({ tier }: { tier: DeviceTier }) {
  const camera = useThree((s) => s.camera);
  const [forcedOff] = useState(fxForcedOff);
  const cap = forcedOff ? 0 : LEVEL_CAP[tier];
  const [level, setLevel] = useState(cap);
  const [locked, setLocked] = useState(false);
  const [sunOnScreen, setSunOnScreen] = useState(false);
  const sunMesh = useSyncExternalStore(subscribeSunLightMesh, getSunLightMesh, () => null);
  const bloomRef = useRef<BloomEffect | null>(null);
  const godRaysRef = useRef<GodRaysEffect | null>(null);

  // Bloom 实例只能用「回调 ref」接：@react-three/postprocessing 的 wrapEffect
  // 以 JSON.stringify(props) 做 memo 依赖，而 React 19 把 ref 当普通 prop——
  // ref 对象一旦被填入 BloomEffect（内含场景图）就成循环结构直接抛错（实测
  // 踩坑）；函数会被 JSON.stringify 静默丢弃，回调 ref 因此安全。
  const attachBloom = useCallback((e: BloomEffect | null) => {
    bloomRef.current = e;
  }, []);
  // GodRays 包装器在 props 变化时会 new 新 effect 且从不 dispose 旧的
  // （渲染目标 ×3 直接泄漏显存）——在 ref 交接处手动补 dispose：
  // 交接发生在 React commit 的 mutation 阶段，composer 的 layoutEffect 重建
  // pass 在其后同步执行，中间不会有帧渲染引用到已释放的旧实例。
  const attachGodRays = useCallback((e: GodRaysEffect | null) => {
    if (godRaysRef.current && godRaysRef.current !== e) godRaysRef.current.dispose();
    godRaysRef.current = e;
  }, []);

  // 设备档异步微调（DetectGPU 到达）→ 熔断阶梯重置到新档上限
  useEffect(() => {
    setLevel(cap);
  }, [cap]);

  const composerOn = !locked && level >= 1;
  const bloomOn = composerOn && level >= 2;
  const godRaysOn = composerOn && level >= 3 && tier === 'high' && sunMesh !== null && sunOnScreen;

  // 低频状态同步：composer/Bloom 开关 → 模块总线（渲染层 uniform 联动）
  useEffect(() => {
    setComposerActive(composerOn);
    fx.linearPipe = composerOn ? 1 : 0;
    fx.grade = composerOn ? GRADE_ACES : 1;
    fx.bloomBoost = bloomOn ? BOOST_BY_TIER[tier] : 0;
    fx.spike = tier === 'low' ? 0 : 1; // 衍射芒是 shader 级效果，不依赖 composer
    return () => {
      setComposerActive(false);
      fx.linearPipe = 0;
      fx.grade = 1;
      fx.bloomBoost = 0;
      fx.spike = 0;
    };
  }, [composerOn, bloomOn, tier]);

  // GodRays 挂载状态 → 太阳光源盘显隐（PlanetsLayer 帧循环读）
  useEffect(() => {
    fx.sunLight = godRaysOn ? 1 : 0;
    return () => {
      fx.sunLight = 0;
    };
  }, [godRaysOn]);

  // 运行时质量档广播（不高于设备档；其它域读 perfBus 降载）
  useEffect(() => {
    const byLevel = PERF_BY_LEVEL[Math.min(Math.max(level, 0), 3)]!;
    setPerfTier(cap === 0 ? 'low' : byLevel);
  }, [level, cap]);

  useFrame((state) => {
    // 银河呼吸的同相位 Bloom 微调（r-fx §3.c）：与 MilkyWayLayer 的
    // uExposure 共用 clock.elapsedTime，两处波形天然同相；直写零 React。
    const bloom = bloomRef.current;
    if (bloom) {
      bloom.intensity =
        BLOOM_BASE[tier] * (1 + 0.05 * Math.sin(state.clock.elapsedTime * 0.15));
    }
    // 太阳屏内判定（滞回去抖）：只有 GodRays 有资格挂载时才花这几次矩阵乘
    if (tier === 'high' && !locked && level >= 3 && sunMesh) {
      let on = sunOnScreen;
      // 星历未就绪（位置仍在原点）视为屏外
      if (sunMesh.position.lengthSq() < 1) {
        on = false;
      } else {
        scratchSun.copy(sunMesh.position).applyMatrix4(camera.matrixWorldInverse);
        if (scratchSun.z >= 0) {
          on = false; // 相机身后
        } else {
          scratchSun.copy(sunMesh.position).project(camera);
          const r = Math.max(Math.abs(scratchSun.x), Math.abs(scratchSun.y));
          on = sunOnScreen ? r < SUN_EXIT_NDC : r < SUN_ENTER_NDC;
        }
      }
      if (on !== sunOnScreen) setSunOnScreen(on); // 布尔翻转，极低频
    } else if (sunOnScreen) {
      setSunOnScreen(false);
    }
  });

  if (cap === 0) return null; // 低档/逃生门：维持现直出管线，零回退风险

  return (
    <>
      {/* 熔断驱动器：锁死后卸载（不再有恢复路径，也不再花采样开销） */}
      {!locked && (
        <PerformanceMonitor
          flipflops={3}
          onDecline={() => setLevel((l) => Math.max(0, l - 1))}
          onIncline={() => setLevel((l) => Math.min(cap, l + 1))}
          onFallback={() => {
            setLocked(true);
            setLevel(0);
          }}
        />
      )}
      {composerOn && (
        <EffectComposer multisampling={tier === 'high' ? 4 : 0}>
          {godRaysOn && sunMesh ? (
            <GodRays
              ref={attachGodRays}
              sun={sunMesh}
              samples={32}
              density={0.9}
              decay={0.94}
            />
          ) : (
            <></>
          )}
          {bloomOn ? (
            <Bloom
              ref={attachBloom}
              mipmapBlur
              luminanceThreshold={1.0}
              luminanceSmoothing={0.08}
              intensity={BLOOM_BASE[tier]}
            />
          ) : (
            <></>
          )}
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          {/* 替换 UniverseScene 的 CSS vignette（composer 关闭时 CSS 版自动回归） */}
          <Vignette eskil={false} offset={0.22} darkness={0.55} />
          {/* 抖动颗粒（r-fx 规格 0.015 是显示域直觉值）：Noise 混合发生在链尾
            编码之前的线性域，0.015 线性在纯黑处会被编码抬到 ~0.13 显示亮度，
            整片天空变灰（实测踩坑）——0.003 线性 ≈ 原意图的显示域颗粒强度，
            仍足以打散暗部渐变 banding。 */}
          <Noise premultiply={false} blendFunction={BlendFunction.SCREEN} opacity={0.003} />
          {tier !== 'high' ? <SMAA /> : <></>}
        </EffectComposer>
      )}
    </>
  );
}
