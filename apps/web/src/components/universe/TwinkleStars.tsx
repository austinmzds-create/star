'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { StarAttributes } from '@/lib/universe';

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uTwinkle;
  uniform float uPixelRatio;
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aPhase;
  varying vec3 vColor;
  varying float vTw;
  varying float vFaint;
  void main() {
    vColor = aColor;
    // 微弱星判定（宇宙 V4 §1.4）：aSize < 4.5px 视为暗视觉区，交给片元去饱和。
    // 用尺寸而非星等做代理——本 shader 被环境场/扩展场复用，只有尺寸是共同语言。
    vFaint = clamp((4.5 - aSize) / 4.5, 0.0, 1.0);
    float flicker = 0.5 + 0.5 * sin(uTime * 2.2 + aPhase);
    float tw = 1.0 - uTwinkle * flicker * 0.55;
    vTw = tw;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uSize * uPixelRatio * (0.7 + 0.6 * tw);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vTw;
  varying float vFaint;
  void main() {
    // PSF「锐核 + 宽晕」（宇宙 V4 §1.2）：亮星呈针尖 + 光晕两层，
    // 暗星（点小于核半径时）只剩微晕——天幕对比由此拉开。
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float core = smoothstep(0.22, 0.0, d);
    float halo = pow(smoothstep(0.5, 0.0, d), 3.0);
    float alpha = (core + 0.45 * halo) * vTw;
    // 微弱星去饱和（§1.4）：模拟人眼暗视觉——暗星滑向冷灰蓝，不再五彩斑斓
    float lum = dot(vColor, vec3(0.30, 0.55, 0.15));
    vec3 scot = lum * vec3(0.82, 0.90, 1.06);
    vec3 base = mix(vColor, scot, vFaint * 0.65);
    vec3 col = base * (0.30 + 1.35 * core + 0.40 * halo);
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
