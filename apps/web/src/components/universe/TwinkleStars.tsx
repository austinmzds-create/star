'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { fx, getGlobalFade } from '@/lib/fxBus';
import { useUniverse } from '@/lib/store';
import { MAS_YR_TO_RAD_YR, type StarAttributes } from '@/lib/universe';
import { ensureStarExtrasReady } from '@/lib/useStarExtra';

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uTwinkle;
  uniform float uPixelRatio;
  uniform float uSpike;
  uniform float uEpochYr;      // 深时偏移年数（J2000 起算；常态 0，见 useFrame）
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aPhase;
  attribute vec2 aPm;          // 自行 (pmra*, pmdec)，rad/yr 预转（pmra 含 cosδ）
  attribute float aCi;         // B−V 色指数（9C 星色连续化；哨兵 1000 = 无 ci，走 aColor）
  varying vec3 vColor;

  // ── 星色连续化（Phase 9C，r-data §4-3）────────────────────────────────
  // 有 ci 的星（核心真实星表，extras 加载后回填）用 Ballesteros 公式反解色温，
  // 再沿「与既有 OBAFGKM 7 档同锚点」的连续色带取色——观感与旧色板一脉相承，
  // 但相邻光谱子型之间不再跳档。无 ci（哨兵 1000）保持旧 aColor 不动。
  // Ballesteros: T = 4600(1/(0.92BV+1.7)+1/(0.92BV+0.62))；BV 钳 [-0.4,3.5]
  //（HYG 核心层实测 ci ∈ [-0.31, 3.33]，BV→-0.674 分母过零）。
  float ciToTemp(float ci) {
    float b = clamp(ci, -0.4, 3.5);
    return 4600.0 * (1.0 / (0.92 * b + 1.7) + 1.0 / (0.92 * b + 0.62));
  }
  // 色温 → RGB：log2(T) 域分段线性（锚点即 lib/universe spectralColor 7 档色），
  // 链式 mix 每段依次饱和 = 标准梯度链。锚点 log2：3200K=11.64 4450K=12.12
  // 5600K=12.45 6800K=12.73 9000K=13.14 15000K=13.87。
  vec3 tempToRgb(float t) {
    float x = log2(t);
    vec3 c = vec3(1.0, 0.60, 0.42);                                            // <2700K 炭火深红
    c = mix(c, vec3(1.0, 0.66, 0.48), clamp((x - 11.40) / 0.24, 0.0, 1.0));    // M
    c = mix(c, vec3(1.0, 0.80, 0.56), clamp((x - 11.64) / 0.48, 0.0, 1.0));    // K
    c = mix(c, vec3(1.0, 0.95, 0.84), clamp((x - 12.12) / 0.33, 0.0, 1.0));    // G
    c = mix(c, vec3(1.0, 0.98, 0.94), clamp((x - 12.45) / 0.28, 0.0, 1.0));    // F
    c = mix(c, vec3(0.83, 0.89, 1.0), clamp((x - 12.73) / 0.41, 0.0, 1.0));    // A
    c = mix(c, vec3(0.61, 0.70, 1.0), clamp((x - 13.14) / 0.73, 0.0, 1.0));    // B/O
    return c;
  }
  varying float vTw;
  varying float vFaint;
  varying float vBoost;
  varying float vSpike;

  // ── 恒星自行（Phase 9B 星座时光机，r-dyn §3c）────────────────────────
  // east/north 切向量按仓库天球约定推导：y=北天极、RA 从 +x 向 −z 增
  // （raDecToVector3）。east = ĵ×n̂ 指向 RA 增方向，north = n̂×east 指向北天极。
  //【精确大圆旋转而非小角度近似】报告原式 normalize(p+tv) 只在 |pm·dt|≲5° 成立；
  // 核心层实测最快星 Groombridge 1830（HIP57939）7.06″/yr × 10 万年 ≈ 196°，
  // 小角度式在此偏差可达 122°（scratchpad/verify-pm.mjs 实跑核实 2026-07-15）。
  // 改用罗德里格斯旋转的大圆退化式 p' = n̂·cosθ + t̂·sinθ（θ=|切向位移|），
  // 全角度域成立，仅多一对 sin/cos——sin(θ)/θ 形式天然规避 θ→0 除零。
  //【演示级近似（DeepTimeBar 注记同步声明）】把自行视为常角速率的大圆运动：
  // 忽略视向速度带来的透视加速度与岁差（岁差是整体刚性旋转，不改变星座形状）。
  vec3 properMotion(vec3 posIn) {
    float r = length(posIn);
    vec3 pn = posIn / r;
    vec3 east = cross(vec3(0.0, 1.0, 0.0), pn);
    // 极点退化保护：|east|→0 时（恰在天极的装饰星）除以下限，tv 随之为 0 向量
    east /= max(length(east), 1e-6);
    vec3 north = cross(pn, east);
    vec3 tv = (east * aPm.x + north * aPm.y) * uEpochYr; // 切向位移（rad）
    float theta = max(length(tv), 1e-12);
    return (pn * cos(theta) + tv * (sin(theta) / theta)) * r;
  }

  void main() {
    // 9C 星色连续化：aCi < 900 视为有效 ci（哨兵 1000 = 无 ci 保持旧色）
    vColor = aCi < 900.0 ? tempToRgb(ciToTemp(aCi)) : aColor;
    // 微弱星判定（宇宙 V4 §1.4）：aSize < 4.5px 视为暗视觉区，交给片元去饱和。
    // 用尺寸而非星等做代理——本 shader 被环境场/扩展场复用，只有尺寸是共同语言。
    vFaint = clamp((4.5 - aSize) / 4.5, 0.0, 1.0);
    // 亮星系数（Phase 9A 选择性泛光，r-fx §2.1.3）：HDR 超白只给大 size 星，
    // Bloom luminanceThreshold=1.0 下暗星永不越阈——零额外 pass 的选择性泛光。
    vBoost = smoothstep(5.5, 10.0, aSize);
    // 衍射芒仅 aSize>9 的头部亮星生效（r-fx §3.c），uSpike 是档位总开关
    vSpike = uSpike * smoothstep(9.0, 13.0, aSize);
    float flicker = 0.5 + 0.5 * sin(uTime * 2.2 + aPhase);
    float tw = 1.0 - uTwinkle * flicker * 0.55;
    vTw = tw;
    // 深时位移：常态（uEpochYr=0）θ=0 → 结果即原位，代价一对 sin/cos，无分支发散
    vec4 mv = modelViewMatrix * vec4(properMotion(position), 1.0);
    gl_PointSize = aSize * uSize * uPixelRatio * (0.7 + 0.6 * tw);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uBoost;
  uniform float uGlobalFade;
  uniform float uPipe;
  varying vec3 vColor;
  varying float vTw;
  varying float vFaint;
  varying float vBoost;
  varying float vSpike;
  void main() {
    // PSF「锐核 + 宽晕」（宇宙 V4 §1.2）：亮星呈针尖 + 光晕两层，
    // 暗星（点小于核半径时）只剩微晕——天幕对比由此拉开。
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    if (d > 0.5) discard;
    float core = smoothstep(0.22, 0.0, d);
    float halo = pow(smoothstep(0.5, 0.0, d), 3.0);
    float alpha = (core + 0.45 * halo) * vTw;
    // 微弱星去饱和（§1.4）：模拟人眼暗视觉——暗星滑向冷灰蓝，不再五彩斑斓
    float lum = dot(vColor, vec3(0.30, 0.55, 0.15));
    vec3 scot = lum * vec3(0.82, 0.90, 1.06);
    vec3 base = mix(vColor, scot, vFaint * 0.65);
    vec3 col = base * (0.30 + 1.35 * core + 0.40 * halo);
    // 亮星衍射芒（Phase 9A，r-fx §3.c）：各向异性十字项 |x·y| 调制——轴上为 0
    // 得细臂，随半径衰减、随闪烁呼吸。分支按点整体一致，无 warp 发散负担。
    if (vSpike > 0.001) {
      float spike = vSpike * pow(max(1.0 - abs(p.x * p.y) * 34.0, 0.0), 22.0)
        * smoothstep(0.5, 0.06, d) * vTw;
      col += base * spike * 0.8;
      alpha += spike * 0.8;
    }
    // 全局亮度（序曲淡入契约，lib/fxBus.ts）：乘颜色不乘 alpha——加色混合下
    // 贡献 = col·alpha，只乘一侧保证淡入是线性而非平方曲线。
    // 刻意放在线性化之前：两条管线下淡入的感知曲线一致。
    col *= uGlobalFade;
    // 线性管线适配（uPipe=1 仅 composer 激活时）：本 shader 输出是「显示参考」
    // 调校值，而链尾 EffectPass 的 ENCODE_OUTPUT 会统一做 linear→sRGB 编码
    // ——不先反解回线性域就会被二次编码洗白（实测踩坑）。行内为 sRGB EOTF
    // 精确式，与 three colorspace_fragment 的编码互为逆变换。
    if (uPipe > 0.5) {
      col = mix(
        pow((col + 0.055) / 1.055, vec3(2.4)),
        col / 12.92,
        vec3(lessThanEqual(col, vec3(0.04045)))
      );
    }
    // HDR 超白（r-fx §2.1.3）：Bloom 激活时（uBoost>0）亮星核区输出乘至 1.5–3，
    // 在线性域越过 luminanceThreshold=1 触发泛光；composer 关闭时 uBoost=0，
    // 直出管线不变。
    col *= 1.0 + uBoost * vBoost * (0.5 + 1.7 * core);
    gl_FragColor = vec4(col, alpha);
  }
`;

/** aCi 哨兵：无 ci 数据（装饰星/扩展星/extras 未达）→ shader 保持旧 aColor。 */
const CI_NONE = 1000;

interface TwinkleStarsProps {
  /**
   * 渲染属性。可选 objects（CatalogRenderData 结构性携带，与各缓冲同序）：
   * 存在时本组件在 extras（star-extras.json 异步 chunk）加载完成后按 uid
   * 回填 aPm（自行）与 aCi（B−V）attribute——9C 主 chunk 回收后目录不再自带 pm，
   * GPU 缓冲的真实数据一律异步补齐（加载前 uEpochYr 语义不变：pm=0 星不动）。
   */
  attributes: StarAttributes & { objects?: readonly { objectUid: string }[] };
  /** 全局尺寸缩放。 */
  sizeScale?: number;
  /** 闪烁强度 0–1。 */
  twinkle?: number;
  renderOrder?: number;
}

/** 用一次 draw call 渲染一批带柔和光晕与闪烁的恒星。 */
export function TwinkleStars({
  attributes,
  sizeScale = 1,
  twinkle = 0.6,
  renderOrder = 0,
}: TwinkleStarsProps) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const pixelRatio = useThree((s) => s.gl.getPixelRatio());

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(attributes.positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(attributes.colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(attributes.sizes, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(attributes.phases, 1));
    // 自行属性（9B 深时模式）：未提供的层（环境星场/星屑）零填充——
    // shader 恒有 aPm 可读，装饰星在时光机里保持不动（一次性 64–96KB，非帧循环）。
    geo.setAttribute(
      'aPm',
      new THREE.BufferAttribute(attributes.pms ?? new Float32Array(attributes.count * 2), 2),
    );
    // B−V 色指数（9C 星色连续化）：初值全哨兵（保持旧色）；带 objects 的真实
    // 星层在 extras 加载后按 uid 回填（下方 effect），无 ci 星与装饰层永不变。
    geo.setAttribute(
      'aCi',
      new THREE.BufferAttribute(new Float32Array(attributes.count).fill(CI_NONE), 1),
    );
    return geo;
  }, [attributes]);

  // ── extras 回填（9C）：aPm/aCi 在 star-extras.json 异步 chunk 到达后一次性写入 ──
  // 空闲时机触发（不与首屏关键路径抢带宽；DeepTimeBar 入口会 await 同一单例，
  // 用户先开时光机则加载被动提前）。needsUpdate 一次，非帧循环。
  useEffect(() => {
    const objects = attributes.objects;
    if (!objects || objects.length === 0) return;
    let cancelled = false;
    let idleId: number | null = null;
    let timerId: number | null = null;

    const backfill = (): void => {
      void ensureStarExtrasReady().then((extras) => {
        if (cancelled) return;
        const pmAttr = geometry.getAttribute('aPm') as THREE.BufferAttribute;
        const ciAttr = geometry.getAttribute('aCi') as THREE.BufferAttribute;
        const pmArr = pmAttr.array as Float32Array;
        const ciArr = ciAttr.array as Float32Array;
        const n = Math.min(objects.length, attributes.count);
        for (let i = 0; i < n; i++) {
          const ex = extras.get(objects[i]!.objectUid);
          if (!ex) continue;
          if (ex.pmRa !== undefined && ex.pmDec !== undefined) {
            // mas/yr → rad/yr 预转（shader 零换算，与 9B 约定一致）
            pmArr[i * 2] = ex.pmRa * MAS_YR_TO_RAD_YR;
            pmArr[i * 2 + 1] = ex.pmDec * MAS_YR_TO_RAD_YR;
          }
          if (ex.ci !== undefined) ciArr[i] = ex.ci;
        }
        pmAttr.needsUpdate = true;
        ciAttr.needsUpdate = true;
      });
    };

    // 首帧后的空闲时机（fallback: 2.5s 定时器）——与 ExtendedStars 同一纪律
    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(backfill, { timeout: 4000 });
    } else {
      timerId = window.setTimeout(backfill, 2500);
    }
    return () => {
      cancelled = true;
      if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [attributes, geometry]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSize: { value: sizeScale },
      uTwinkle: { value: twinkle },
      uPixelRatio: { value: pixelRatio },
      uSpike: { value: 0 },
      uBoost: { value: 0 },
      uGlobalFade: { value: 1 },
      uPipe: { value: 0 },
      // 深时偏移初值取挂载时刻 store 现值：扩展星层是懒加载的，若在时光机
      // 开启期间才 fetch 完成挂载，首帧就要与其它星层同一历元，不能闪回 J2000
      uEpochYr: { value: useUniverse.getState().deepTimeYears ?? 0 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useFrame((_, delta) => {
    const u = materialRef.current?.uniforms;
    if (u) {
      u.uTime!.value += delta;
      u.uSize!.value = sizeScale;
      u.uTwinkle!.value = twinkle;
      u.uPixelRatio!.value = pixelRatio;
      // 后处理域联动（模块总线直读，零 React）：衍射芒档位开关 /
      // Bloom 激活才给 HDR 超白 / 序曲全局亮度（跨域契约见 lib/fxBus.ts）
      u.uSpike!.value = fx.spike;
      u.uBoost!.value = fx.bloomBoost;
      u.uGlobalFade!.value = getGlobalFade();
      u.uPipe!.value = fx.linearPipe;
      // 深时偏移（9B 契约：deepTimeYears 只读，getState 直读零 React）：
      // null=时光机关闭 → 0（J2000 原位）。滑条拖动即帧级跟手；星座连线的
      // CPU 重算走 100ms 节流（ConstellationLayer），瞬态错位 ≤ 一次节流窗。
      u.uEpochYr!.value = useUniverse.getState().deepTimeYears ?? 0;
    }
  });

  return (
    <points geometry={geometry} renderOrder={renderOrder} frustumCulled={false}>
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
