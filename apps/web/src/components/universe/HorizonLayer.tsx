'use client';

import {
  equatorialToHorizontal,
  horizontalToEquatorial,
  localSiderealTime,
  raDecToVector3,
} from '@star/astro-core';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { getDeviceTier } from '@/lib/deviceTier';
import { ephem } from '@/lib/ephemRegistry';
import { useUniverse } from '@/lib/store';
import { SPHERE_RADIUS } from '@/lib/universe';

/**
 * 观测视角辅助层（宇宙 V3-F 组3 + G 整组，共用 showHorizon 开关）：
 *  1. 地平线大圆：所选城市+时刻 alt=0 的大圆（120 点，随 city/observeTime 重建，
 *     horizontalToEquatorial 反投影回赤道系天球，<0.2ms）；
 *  2. 东南西北方位标：4 个 canvas Sprite（北=红橙）置于 alt=+2.5°；
 *  3. 半球暗罩 + 晨昏色调：全天球 ShaderMaterial（1 draw）——片元用
 *     「顶点方向·天顶向量」≈ sin(高度角) 同时做地平线下渐变压暗与
 *     白天/晨昏天空色调（按太阳高度角在 JS 侧插值好再写 uniform），
 *     预乘 alpha 混合把地平线下的星光按比例压暗，行星落下同样变暗。
 *
 * 更新纪律：全部计算发生在低频 useEffect（[city, observeTime, showHorizon]），
 * useFrame 内零计算；实时模式 60s 心跳 / 时间机器 4Hz 驱动 observeTime，
 * LST/晨昏自动演化。太阳坐标直接读 ephemRegistry（本层挂载在 EphemDriver
 * 之后，同一 commit 内 effect 先后有序，读到的即当次 observeTime 的新鲜值）。
 * 关闭开关整层 return null（暗罩+大圆+方位标+色调一起消失，几何缓存保留）。
 */

/** 地平线大圆采样点数（每 3° 一点）。 */
const HORIZON_POINTS = 120;
/** 大圆半径：略在星点内侧。 */
const HORIZON_RADIUS = SPHERE_RADIUS * 0.98;
/** 暗罩球半径。 */
const SHADE_RADIUS = SPHERE_RADIUS * 0.97;
/** 地平线下压暗强度。 */
const DIM_STRENGTH = 0.35;

/** 方位标（北/东/南/西）。 */
const DIRECTIONS: Array<{ text: string; azimuthDeg: number; color: string }> = [
  { text: '北', azimuthDeg: 0, color: '#e8907a' },
  { text: '东', azimuthDeg: 90, color: '#a8c0d8' },
  { text: '南', azimuthDeg: 180, color: '#a8c0d8' },
  { text: '西', azimuthDeg: 270, color: '#a8c0d8' },
];

const VERTEX_SHADER = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uZenith;     // 观测者天顶的赤道系单位向量
uniform float uDim;       // 地平线下压暗强度
uniform vec3 uSkyTint;    // 晨昏/白天色调（JS 侧按太阳高度角插值）
uniform float uSkyAmount; // 色调强度 0~0.10
varying vec3 vDir;
void main() {
  float sinAlt = dot(normalize(vDir), uZenith); // ≈该方向的地平高度角正弦
  // 地平线下渐变压暗（alt≈-6°处满值）
  float below = (1.0 - smoothstep(-0.10, 0.02, sinAlt)) * uDim;
  // 天空色调主要染地平线以上
  float tint = uSkyAmount * smoothstep(-0.06, 0.20, sinAlt);
  // 预乘 alpha：rgb 只带色调，压暗仅贡献 alpha（把底下星光按比例压黑）
  gl_FragColor = vec4(uSkyTint * tint, clamp(tint + below, 0.0, 0.75));
}
`;

/** 方位标 canvas Sprite。 */
function makeDirectionSprite(text: string, color: string): {
  sprite: THREE.Sprite;
  disposables: Array<{ dispose(): void }>;
} {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '600 40px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 32, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(26, 26, 1);
  sprite.renderOrder = 0.5;
  return { sprite, disposables: [tex, mat] };
}

interface Built {
  group: THREE.Group;
  /** 地平线大圆顶点缓冲（预分配，effect 内原地重写）。 */
  circleAttr: THREE.BufferAttribute;
  dirSprites: THREE.Sprite[];
  uniforms: {
    uZenith: { value: THREE.Vector3 };
    uDim: { value: number };
    uSkyTint: { value: THREE.Color };
    uSkyAmount: { value: number };
  };
  disposables: Array<{ dispose(): void }>;
}

function build(): Built {
  const group = new THREE.Group();
  const disposables: Array<{ dispose(): void }> = [];

  // ① 地平线大圆（预分配顶点，LineLoop，1 draw）
  const circleAttr = new THREE.BufferAttribute(new Float32Array(HORIZON_POINTS * 3), 3);
  circleAttr.setUsage(THREE.DynamicDrawUsage);
  const circleGeom = new THREE.BufferGeometry();
  circleGeom.setAttribute('position', circleAttr);
  const circleMat = new THREE.LineBasicMaterial({
    color: '#a8c0d8',
    transparent: true,
    opacity: 0.4, // 比坐标网格醒目：这是「你此刻真实的地平线」
    depthWrite: false,
    depthTest: false,
  });
  const circle = new THREE.LineLoop(circleGeom, circleMat);
  circle.renderOrder = 0.5;
  circle.frustumCulled = false;
  group.add(circle);
  disposables.push(circleGeom, circleMat);

  // ② 方位标 ×4
  const dirSprites: THREE.Sprite[] = [];
  for (const d of DIRECTIONS) {
    const { sprite, disposables: dd } = makeDirectionSprite(d.text, d.color);
    group.add(sprite);
    dirSprites.push(sprite);
    disposables.push(...dd);
  }

  // ③ 半球暗罩 + 晨昏色调（全天球 shader，1 draw；低端机降细分）
  const tier = getDeviceTier();
  const shadeGeom = new THREE.SphereGeometry(
    SHADE_RADIUS,
    tier === 'low' ? 32 : 48,
    tier === 'low' ? 20 : 32,
  );
  const uniforms = {
    uZenith: { value: new THREE.Vector3(0, 1, 0) },
    uDim: { value: DIM_STRENGTH },
    uSkyTint: { value: new THREE.Color('#e8a86a') },
    uSkyAmount: { value: 0 },
  };
  const shadeMat = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms,
    transparent: true,
    // 预乘 alpha 混合：out = src.rgb + dst.rgb × (1 - src.a)
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthWrite: false,
    depthTest: false,
    side: THREE.BackSide,
  });
  const shade = new THREE.Mesh(shadeGeom, shadeMat);
  // 压在恒星/DSO/银河/行星(8)之上、TargetHighlight(9)之下——行星落下同样变暗
  shade.renderOrder = 8.5;
  shade.frustumCulled = false;
  group.add(shade);
  disposables.push(shadeGeom, shadeMat);

  return { group, circleAttr, dirSprites, uniforms, disposables };
}

export function HorizonLayer() {
  const showHorizon = useUniverse((s) => s.showHorizon);
  const city = useUniverse((s) => s.city);
  const observeTime = useUniverse((s) => s.observeTime);

  // 懒构建 + 缓存（默认关闭零成本；关闭只摘除不销毁）
  const builtRef = useRef<Built | null>(null);
  if (showHorizon && !builtRef.current) builtRef.current = build();

  // 低频重建：城市/时刻变化 → 大圆顶点、方位标位置、天顶向量、晨昏色调
  useEffect(() => {
    const built = builtRef.current;
    if (!showHorizon || !built) return;
    const date = new Date(observeTime ?? Date.now());
    const observer = { latitudeDeg: city.latitudeDeg, longitudeDeg: city.longitudeDeg };

    // ① 地平线大圆：az 每 3° 反投影（120 次逆变换 <0.2ms）
    const arr = built.circleAttr.array as Float32Array;
    for (let i = 0; i < HORIZON_POINTS; i++) {
      const eq = horizontalToEquatorial(
        { altitudeDeg: 0, azimuthDeg: i * 3 },
        observer,
        date,
      );
      const v = raDecToVector3(eq, HORIZON_RADIUS);
      arr[i * 3] = v.x;
      arr[i * 3 + 1] = v.y;
      arr[i * 3 + 2] = v.z;
    }
    built.circleAttr.needsUpdate = true;

    // ② 方位标：alt=+2.5° 悬在地平线上方
    built.dirSprites.forEach((sprite, i) => {
      const eq = horizontalToEquatorial(
        { altitudeDeg: 2.5, azimuthDeg: DIRECTIONS[i]!.azimuthDeg },
        observer,
        date,
      );
      const v = raDecToVector3(eq, HORIZON_RADIUS);
      sprite.position.set(v.x, v.y, v.z);
    });

    // ③ 天顶向量：RA=LST、Dec=纬度
    const zv = raDecToVector3(
      { raDeg: localSiderealTime(date, observer.longitudeDeg), decDeg: observer.latitudeDeg },
      1,
    );
    built.uniforms.uZenith.value.set(zv.x, zv.y, zv.z).normalize();

    // ④ 太阳高度角 → 晨昏色调插值（太阳坐标读 ephemRegistry，勿重复调引擎）
    let sunAltDeg = -90;
    if (ephem.version > 0) {
      for (const body of ephem.bodies.values()) {
        if (body.kind === 'sun') {
          sunAltDeg = equatorialToHorizontal(
            { raDeg: body.raDeg, decDeg: body.decDeg },
            observer,
            date,
          ).altitudeDeg;
          break;
        }
      }
    }
    // 分段：夜(≤-6°) → 民用晨昏(金橙) → 白天(淡青蓝)
    const dawn = { r: 0xe8 / 255, g: 0xa8 / 255, b: 0x6a / 255 };
    const day = { r: 0xa9 / 255, g: 0xc6 / 255, b: 0xe8 / 255 };
    let amount = 0;
    const tint = built.uniforms.uSkyTint.value;
    if (sunAltDeg <= -6) {
      amount = 0;
      tint.setRGB(dawn.r, dawn.g, dawn.b);
    } else if (sunAltDeg <= 0) {
      amount = (0.05 * (sunAltDeg + 6)) / 6;
      tint.setRGB(dawn.r, dawn.g, dawn.b);
    } else if (sunAltDeg <= 8) {
      const k = sunAltDeg / 8;
      amount = 0.05 + 0.05 * k;
      tint.setRGB(
        dawn.r + (day.r - dawn.r) * k,
        dawn.g + (day.g - dawn.g) * k,
        dawn.b + (day.b - dawn.b) * k,
      );
    } else {
      amount = 0.1;
      tint.setRGB(day.r, day.g, day.b);
    }
    built.uniforms.uSkyAmount.value = amount;
  }, [showHorizon, city, observeTime]);

  // 卸载时释放
  useEffect(() => {
    return () => {
      const built = builtRef.current;
      if (built) for (const d of built.disposables) d.dispose();
    };
  }, []);

  if (!showHorizon || !builtRef.current) return null;
  return <primitive object={builtRef.current.group} />;
}
