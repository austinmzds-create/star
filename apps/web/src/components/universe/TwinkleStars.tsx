'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { fx, getGlobalFade } from '@/lib/fxBus';
import type { StarAttributes } from '@/lib/universe';

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uTwinkle;
  uniform float uPixelRatio;
  uniform float uSpike;
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aPhase;
  varying vec3 vColor;
  varying float vTw;
  varying float vFaint;
  varying float vBoost;
  varying float vSpike;
  void main() {
    vColor = aColor;
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
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
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

interface TwinkleStarsProps {
  attributes: StarAttributes;
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
    return geo;
  }, [attributes]);

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
