'use client';

import {
  equatorialToHorizontal,
  horizontalToEquatorial,
  localSiderealTime,
  raDecToVector3,
} from '@star/astro-core';
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { getDeviceTier } from '@/lib/deviceTier';
import { ephem } from '@/lib/ephemRegistry';
import { getSkyQuaternion } from '@/lib/skyFrame';
import { useUniverse, type ViewMode } from '@/lib/store';
import { SPHERE_RADIUS } from '@/lib/universe';

/**
 * 观测视角辅助层（宇宙 V3-F 组3 + G 整组 + Phase 9B 罗盘/晨昏辉光，
 * 共用 showHorizon 开关；本层刻意在天旋 group 之外——地平线固定于观测者）：
 *  1. 地平线大圆：free 模式按所选城市+时刻把 alt=0 反投影回赤道系天球
 *     （120 点，<0.2ms）；earth 模式（9B）地平线就是世界系 y=0 的固定圆，
 *     一次构建零重算；
 *  2. 东南西北方位标：free 模式 4 个 canvas Sprite（北=红橙）置于 alt=+2.5°；
 *     earth 模式隐藏（罗盘条带已含方位名，避免重复）；
 *  3. 罗盘（9B，earth 模式才显示）：36 段方位刻度（单 LineSegments，10° 一格、
 *     30°/90° 加长）+ 1 张环形 canvas 纹理条带（东南西北 + 30° 数字，贴
 *     alt≈0 上方，1 draw）——世界系静态几何，切城市/时间零重算；
 *  4. 半球暗罩 + 晨昏色调 + 方向性辉光：全天球 ShaderMaterial（1 draw）——
 *     片元用「顶点方向·天顶向量」≈ sin(高度角) 做地平线下压暗与三段式
 *     高度渐变（天顶深蓝→中天→地平暖白，Preetham 的廉价近似，9B §3e-3）；
 *     晨昏时太阳方位一侧 pow(dot,6) 局部辉光。earth 模式天顶恒 (0,1,0)。
 *
 * 更新纪律：几何/色调计算全部发生在低频 useEffect（[city, observeTime,
 * viewMode, showHorizon]）；useFrame 内仅同步 uSunDir（太阳赤道系方向 ×
 * 当帧天旋，一次四元数乘，零分配）——天旋 slerp 过渡期辉光不脱节。
 * 太阳坐标直接读 ephemRegistry（本层挂载在 EphemDriver 之后，同一 commit
 * 内 effect 先后有序，读到的即当次 observeTime 的新鲜值）。
 * 关闭开关整层 return null（暗罩+大圆+方位标+罗盘一起消失，几何缓存保留）。
 */

/**
 * 当前观测者天顶向量（渲染/世界系；Phase 10 悬停万物的地平线探针读取器）。
 * free 模式赤道系天顶（天旋 group 恒等 ⇒ 世界系）与 earth 模式 (0,1,0) 都在
 * 世界系与地平暗罩球一致——lib/skyProbe 的地平线命中直接用世界方向点乘它。
 * null = 地平线层未显示（不给「悬停一条看不见的线」的困惑）。
 */
const zenithReader = new THREE.Vector3();
let zenithValid = false;
export function getHorizonZenith(): THREE.Vector3 | null {
  return zenithValid ? zenithReader : null;
}

/** 地平线大圆采样点数（每 3° 一点）。 */
const HORIZON_POINTS = 120;
/** 大圆半径：略在星点内侧。 */
const HORIZON_RADIUS = SPHERE_RADIUS * 0.98;
/** 暗罩球半径。 */
const SHADE_RADIUS = SPHERE_RADIUS * 0.97;
/** 地平线下压暗强度。 */
const DIM_STRENGTH = 0.35;

/** 罗盘刻度数（每 10° 一格）。 */
const TICK_COUNT = 36;
/** 罗盘纹理条带方位分段（96 段折线近似圆环）。 */
const BAND_SEGS = 96;
/** 条带高度角范围（度）：贴在地平线上方一窄条。 */
const BAND_ALT0 = 0.7;
const BAND_ALT1 = 4.7;

const DEG2RAD = Math.PI / 180;

/** 方位标（北/东/南/西；free 模式 Sprite 用，earth 模式由罗盘条带承担）。 */
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
uniform vec3 uZenith;     // 观测者天顶单位向量（free=赤道系反投影；earth=(0,1,0)）
uniform float uDim;       // 地平线下压暗强度
uniform vec3 uSkyTint;    // 晨昏/白天中天色调（JS 侧按太阳高度角插值）
uniform float uSkyAmount; // 色调强度 0~0.10
uniform vec3 uSunDir;     // 太阳方向（渲染系单位向量，JS 每帧同步天旋）
uniform float uGlow;      // 晨昏辉光强度（太阳高度角钟形，白天高悬/深夜为 0）
varying vec3 vDir;
void main() {
  vec3 dir = normalize(vDir);
  float sinAlt = dot(dir, uZenith); // ≈该方向的地平高度角正弦
  // 地平线下渐变压暗（alt≈-6°处满值）
  float below = (1.0 - smoothstep(-0.10, 0.02, sinAlt)) * uDim;
  // 天空色调主要染地平线以上
  float tint = uSkyAmount * smoothstep(-0.06, 0.20, sinAlt);
  // 三段式高度渐变（9B §3e-3，Preetham 天空的廉价近似）：
  // 地平暖白 → 中天（uSkyTint，晨昏金橙/白天淡青蓝）→ 天顶深蓝 #0b1e3a
  vec3 sky = mix(vec3(1.00, 0.93, 0.82), uSkyTint, smoothstep(0.00, 0.30, sinAlt));
  sky = mix(sky, vec3(0.043, 0.118, 0.227), smoothstep(0.30, 0.85, sinAlt));
  // 晨昏方向性辉光：太阳方位一侧 pow^6 局部增亮，且只染地平线附近高度带
  float glow = pow(max(dot(dir, uSunDir), 0.0), 6.0) * uGlow
             * (1.0 - smoothstep(0.0, 0.45, abs(sinAlt)));
  // 预乘 alpha：rgb 带色彩；压暗仅贡献 alpha；辉光抬亮天色同时轻微压底下星光
  gl_FragColor = vec4(sky * tint + vec3(1.0, 0.72, 0.42) * glow,
                      clamp(tint + below + glow * 0.5, 0.0, 0.75));
}
`;

/** 世界系 az/alt（度）→ 天球坐标（北=−Z、东=+X、天顶=+Y，与 skyFrame 约定一致）。 */
function azAltToWorld(azDeg: number, altDeg: number, radius: number, out: THREE.Vector3): THREE.Vector3 {
  const az = azDeg * DEG2RAD;
  const alt = altDeg * DEG2RAD;
  const c = Math.cos(alt) * radius;
  return out.set(Math.sin(az) * c, Math.sin(alt) * radius, -Math.cos(az) * c);
}

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

/**
 * 罗盘环形纹理条带（9B）：东南西北 + 30° 数字画进一张 2048×64 canvas，
 * u = az/360（az=0 在画布左缘；跨接缝字形在 ±W 处补绘一份）。
 * 配套几何的 uv 同为 u = az/360——从天球内侧看，方位角向屏幕右增大，
 * u 随 az 同向增大 ⇒ 文字全周正立不镜像（推导：北望时东=+X=屏右）。
 */
function makeCompassBandTexture(): { tex: THREE.CanvasTexture } {
  const W = 2048;
  const H = 64;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const drawAt = (azDeg: number, text: string, color: string, font: string): void => {
    ctx.font = font;
    ctx.fillStyle = color;
    const x = (azDeg / 360) * W;
    // 接缝补绘：az≈0 附近的字形横跨纹理两端
    for (const dx of [-W, 0, W]) ctx.fillText(text, x + dx, H / 2 + 2);
  };
  const CARDINAL_FONT = '600 38px "PingFang SC", "Microsoft YaHei", sans-serif';
  const NUM_FONT = '500 22px "Helvetica Neue", Arial, sans-serif';
  for (const d of DIRECTIONS) drawAt(d.azimuthDeg, d.text, d.color, CARDINAL_FONT);
  for (let a = 30; a < 360; a += 30) {
    if (a % 90 === 0) continue; // 东南西北位已有汉字
    drawAt(a, String(a), 'rgba(168,192,216,0.85)', NUM_FONT);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; // u 越界（补绘冗余）安全回绕
  return { tex };
}

/** 罗盘条带几何：球面上 alt∈[0.7°,4.7°] 的环带，96 段，uv.u = az/360。 */
function makeCompassBandGeometry(): THREE.BufferGeometry {
  const cols = BAND_SEGS + 1;
  const positions = new Float32Array(cols * 2 * 3);
  const uvs = new Float32Array(cols * 2 * 2);
  const indices = new Uint16Array(BAND_SEGS * 6);
  const v = new THREE.Vector3();
  for (let i = 0; i < cols; i++) {
    const azDeg = (i / BAND_SEGS) * 360;
    const rows: [number, number] = [BAND_ALT0, BAND_ALT1];
    for (let r = 0; r < 2; r++) {
      azAltToWorld(azDeg, rows[r]!, HORIZON_RADIUS, v);
      const vi = (i * 2 + r) * 3;
      positions[vi] = v.x;
      positions[vi + 1] = v.y;
      positions[vi + 2] = v.z;
      const ti = (i * 2 + r) * 2;
      uvs[ti] = i / BAND_SEGS;
      uvs[ti + 1] = r; // 0=下缘 1=上缘（CanvasTexture flipY：v=1 为画布顶）
    }
  }
  for (let i = 0; i < BAND_SEGS; i++) {
    const a = i * 2; // 本列下缘
    const ii = i * 6;
    indices[ii] = a;
    indices[ii + 1] = a + 2;
    indices[ii + 2] = a + 1;
    indices[ii + 3] = a + 1;
    indices[ii + 4] = a + 2;
    indices[ii + 5] = a + 3;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  return geom;
}

/** 罗盘刻度几何：36 段短线（10° 一格；90° 长 3.2°、30° 长 2.2°、其余 1.4°）。 */
function makeCompassTicksGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array(TICK_COUNT * 2 * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < TICK_COUNT; i++) {
    const azDeg = i * 10;
    const lenDeg = azDeg % 90 === 0 ? 3.2 : azDeg % 30 === 0 ? 2.2 : 1.4;
    azAltToWorld(azDeg, 0, HORIZON_RADIUS, v);
    positions[i * 6] = v.x;
    positions[i * 6 + 1] = v.y;
    positions[i * 6 + 2] = v.z;
    azAltToWorld(azDeg, lenDeg, HORIZON_RADIUS, v);
    positions[i * 6 + 3] = v.x;
    positions[i * 6 + 4] = v.y;
    positions[i * 6 + 5] = v.z;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geom;
}

interface Built {
  group: THREE.Group;
  /** 地平线大圆顶点缓冲（预分配，effect 内原地重写）。 */
  circleAttr: THREE.BufferAttribute;
  dirSprites: THREE.Sprite[];
  /** 罗盘整组（刻度 + 条带）：earth 模式才 visible，世界系静态几何。 */
  compass: THREE.Group;
  uniforms: {
    uZenith: { value: THREE.Vector3 };
    uDim: { value: number };
    uSkyTint: { value: THREE.Color };
    uSkyAmount: { value: number };
    uSunDir: { value: THREE.Vector3 };
    uGlow: { value: number };
  };
  /** 太阳的赤道系单位方向（低频 effect 更新；useFrame 乘天旋写 uSunDir）。 */
  sunEqDir: THREE.Vector3;
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

  // ② 方位标 ×4（free 模式用；earth 模式隐藏，条带承担方位名）
  const dirSprites: THREE.Sprite[] = [];
  for (const d of DIRECTIONS) {
    const { sprite, disposables: dd } = makeDirectionSprite(d.text, d.color);
    group.add(sprite);
    dirSprites.push(sprite);
    disposables.push(...dd);
  }

  // ③ 罗盘（9B）：刻度单 LineSegments + 纹理条带单 Mesh，共 2 draw，
  // 世界系静态几何（earth 模式地平线恒为 y=0 圆）——切城市/时间零重算
  const compass = new THREE.Group();
  compass.visible = false;
  const ticksGeom = makeCompassTicksGeometry();
  const ticksMat = new THREE.LineBasicMaterial({
    color: '#a8c0d8',
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    depthTest: false,
  });
  const ticks = new THREE.LineSegments(ticksGeom, ticksMat);
  ticks.renderOrder = 0.55;
  ticks.frustumCulled = false;
  compass.add(ticks);
  disposables.push(ticksGeom, ticksMat);

  const { tex: bandTex } = makeCompassBandTexture();
  const bandGeom = makeCompassBandGeometry();
  const bandMat = new THREE.MeshBasicMaterial({
    map: bandTex,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
  });
  const band = new THREE.Mesh(bandGeom, bandMat);
  band.renderOrder = 0.55;
  band.frustumCulled = false;
  compass.add(band);
  disposables.push(bandGeom, bandMat, bandTex);
  group.add(compass);

  // ④ 半球暗罩 + 晨昏色调 + 方向性辉光（全天球 shader，1 draw；低端机降细分）
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
    uSunDir: { value: new THREE.Vector3(0, -1, 0) },
    uGlow: { value: 0 },
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

  return {
    group,
    circleAttr,
    dirSprites,
    compass,
    uniforms,
    sunEqDir: new THREE.Vector3(0, -1, 0),
    disposables,
  };
}

export function HorizonLayer() {
  const showHorizon = useUniverse((s) => s.showHorizon);
  const city = useUniverse((s) => s.city);
  const observeTime = useUniverse((s) => s.observeTime);
  const viewMode: ViewMode = useUniverse((s) => s.viewMode);

  // 懒构建 + 缓存（默认关闭零成本；关闭只摘除不销毁）
  const builtRef = useRef<Built | null>(null);
  if (showHorizon && !builtRef.current) builtRef.current = build();

  // 低频重建：城市/时刻/模式变化 → 大圆顶点、方位标、天顶向量、晨昏色调
  useEffect(() => {
    const built = builtRef.current;
    if (!showHorizon || !built) {
      zenithValid = false; // 地平线未显示：探针不给「悬停看不见的线」的困惑
      return;
    }
    const date = new Date(observeTime ?? Date.now());
    const observer = { latitudeDeg: city.latitudeDeg, longitudeDeg: city.longitudeDeg };
    const earth = viewMode === 'earth';

    // ① 地平线大圆
    const arr = built.circleAttr.array as Float32Array;
    const v3 = new THREE.Vector3();
    for (let i = 0; i < HORIZON_POINTS; i++) {
      if (earth) {
        // earth 模式：地平线是世界系 y=0 的固定圆（天空旋转、地平线不动）
        azAltToWorld(i * 3, 0, HORIZON_RADIUS, v3);
        arr[i * 3] = v3.x;
        arr[i * 3 + 1] = v3.y;
        arr[i * 3 + 2] = v3.z;
      } else {
        // free 模式：alt=0 反投影回赤道系天球（沿用 V3-G 行为）
        const eq = horizontalToEquatorial({ altitudeDeg: 0, azimuthDeg: i * 3 }, observer, date);
        const v = raDecToVector3(eq, HORIZON_RADIUS);
        arr[i * 3] = v.x;
        arr[i * 3 + 1] = v.y;
        arr[i * 3 + 2] = v.z;
      }
    }
    built.circleAttr.needsUpdate = true;

    // ② 方位标：free 模式 alt=+2.5° 悬在地平线上方；earth 模式隐藏（条带承担）
    built.dirSprites.forEach((sprite, i) => {
      sprite.visible = !earth;
      if (earth) return;
      const eq = horizontalToEquatorial(
        { altitudeDeg: 2.5, azimuthDeg: DIRECTIONS[i]!.azimuthDeg },
        observer,
        date,
      );
      const v = raDecToVector3(eq, HORIZON_RADIUS);
      sprite.position.set(v.x, v.y, v.z);
    });

    // ③ 罗盘：earth 模式才显示（静态世界系几何，无需重算）
    built.compass.visible = earth;

    // ④ 天顶向量：earth 模式恒 (0,1,0)；free 模式 RA=LST、Dec=纬度
    if (earth) {
      built.uniforms.uZenith.value.set(0, 1, 0);
    } else {
      const zv = raDecToVector3(
        { raDeg: localSiderealTime(date, observer.longitudeDeg), decDeg: observer.latitudeDeg },
        1,
      );
      built.uniforms.uZenith.value.set(zv.x, zv.y, zv.z).normalize();
    }
    // 天顶探针读取器同步（Phase 10）：copy 世界系天顶，供 skyProbe 地平线命中
    zenithReader.copy(built.uniforms.uZenith.value);
    zenithValid = true;

    // ⑤ 太阳高度角 → 晨昏色调/辉光（太阳坐标读 ephemRegistry，勿重复调引擎）
    let sunAltDeg = -90;
    if (ephem.version > 0) {
      for (const body of ephem.bodies.values()) {
        if (body.kind === 'sun') {
          sunAltDeg = equatorialToHorizontal(
            { raDeg: body.raDeg, decDeg: body.decDeg },
            observer,
            date,
          ).altitudeDeg;
          // 太阳赤道系方向缓存：useFrame 里乘当帧天旋写 uSunDir（辉光不脱节）
          built.sunEqDir.copy(body.vec).normalize();
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
    // 晨昏辉光强度（9B §3e-3）：太阳高度角 ±14° 的钟形——日面贴近地平线时
    // 最亮（0.4），白天高悬与深夜均为 0（方向/高度衰减在片元内）
    const bell = Math.max(0, 1 - Math.abs(sunAltDeg) / 14);
    built.uniforms.uGlow.value = 0.4 * bell * bell;
  }, [showHorizon, city, observeTime, viewMode]);

  // uSunDir 帧同步：太阳赤道系方向 × 当帧天旋（free 恒等）。一次四元数乘/帧，
  // 零分配——天旋 slerp 过渡与时间播放期辉光始终贴着太阳 sprite 的方位。
  useFrame(() => {
    const built = builtRef.current;
    if (!built || !showHorizon) return;
    built.uniforms.uSunDir.value.copy(built.sunEqDir).applyQuaternion(getSkyQuaternion());
  });

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
