'use client';

import type { CelestialObject } from '@star/astro-data';
import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Component, useEffect, useMemo, useRef, type ComponentRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { getDeviceTier } from '@/lib/deviceTier';
import { deriveStarVisual, type StarVisual } from '@/lib/starVisual';

/**
 * 恒星 3D 视觉面（全天体查看器，8896 颗恒星全覆盖）：独立 R3F Canvas，
 * 参数照 PlanetViewer3D 的 modal 形态（dpr[1,2]、always、抗锯齿、
 * high-performance、OrbitControls 用户接管停自动旋转）。
 *
 * 视觉 = derivePhysical 档案的确定性映射（lib/starVisual.ts）：
 *  - tempK → 黑体色（参宿四红 / 天狼星蓝白）；
 *  - radiusSolar 对数 → 球径（白矮星强制最小且辉光更锐）；
 *  - 演化阶段 → 米粒噪声频率（巨星大对流胞 / 白矮星细密）。
 * 表面为 snoise fbm 米粒组织 + 边缘变暗 + 色球边缘光；日冕为 2 张模块级
 * 缓存的径向渐变 Sprite（加色混合），慢速反向自旋 + 呼吸。
 *
 * 纪律：uTime/呼吸全走 ref/uniform，帧循环零 React 状态；GL 上下文
 * 任意时刻 ≤2（主场景 + 本 Canvas，照片/艺术图 pane 均为 img）。
 * 低端档：dpr=1、48×32 段、去掉日冕第二层。
 */

// ── 日冕纹理（模块级缓存 2 张：柔和 / 白矮星锐利） ──

function makeCoronaCanvas(sharp: boolean): HTMLCanvasElement {
  const size = 256;
  const c = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
  if (sharp) {
    // 白矮星：核锐利、衰减陡
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.08, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.18, 'rgba(255,255,255,0.28)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.06)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
  } else {
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.15, 'rgba(255,255,255,0.6)');
    grad.addColorStop(0.42, 'rgba(255,255,255,0.16)');
    grad.addColorStop(0.72, 'rgba(255,255,255,0.045)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

const coronaTexCache = new Map<string, THREE.CanvasTexture>();

/** 灰度径向渐变纹理（tint 走 SpriteMaterial.color），同形态全站只建一次。 */
function getCoronaTexture(sharp: boolean): THREE.CanvasTexture {
  const key = sharp ? 'sharp' : 'soft';
  let tex = coronaTexCache.get(key);
  if (!tex) {
    tex = new THREE.CanvasTexture(makeCoronaCanvas(sharp));
    coronaTexCache.set(key, tex);
  }
  return tex;
}

// ── 恒星表面 shader（ashima snoise + 4 октav fbm 米粒组织） ──

const VERTEX_SHADER = /* glsl */ `
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vViewPos;
void main() {
  vPos = position;                       // 模型空间：噪声随球体自转稳定
  vNormal = normalMatrix * normal;       // 视空间法线：limb darkening 用
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uNoiseScale;
uniform float uLimb;
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vViewPos;

// ── ashima 3D simplex noise（经典公域实现） ──
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float fbm(vec3 p) {
  float f = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    f += a * snoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return f;
}

void main() {
  // 米粒组织：模型空间 fbm 沿 z 缓动（0.05/s，对流胞缓慢翻涌）
  float n = fbm(vPos * uNoiseScale + vec3(0.0, 0.0, uTime * 0.05));
  float granule = 0.75 + 0.5 * n;
  vec3 viewDir = normalize(-vViewPos);
  float mu = max(dot(normalize(vNormal), viewDir), 0.0);
  vec3 col = uColor * granule * (0.35 + 0.65 * pow(mu, uLimb)); // limb darkening
  col += uColor * pow(1.0 - mu, 3.0) * 0.4;                     // 色球边缘光
  gl_FragColor = vec4(col, 1.0);
}
`;

/** 依恒星尺寸把相机放到合适距离（scale 0.4–1.8 → z 3.1–6.2）。 */
function CameraFit({ scale }: { scale: number }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    camera.position.set(0, 0, 2.2 + 2.2 * scale);
    camera.updateProjectionMatrix();
  }, [camera, scale]);
  return null;
}

function StarMesh({ visual, lowTier }: { visual: StarVisual; lowTier: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const corona1 = useRef<THREE.Sprite>(null);
  const corona2 = useRef<THREE.Sprite>(null);

  // uniforms 引用一次性创建（帧循环/换星只改 value，不换对象）
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(visual.rgb[0], visual.rgb[1], visual.rgb[2]) },
      uNoiseScale: { value: visual.noiseScale },
      uLimb: { value: visual.limb },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅建一次，换星走下方 effect 改 value
    [],
  );
  useEffect(() => {
    uniforms.uColor.value.setRGB(visual.rgb[0], visual.rgb[1], visual.rgb[2]);
    uniforms.uNoiseScale.value = visual.noiseScale;
    uniforms.uLimb.value = visual.limb;
  }, [uniforms, visual]);

  const coronaTex = useMemo(() => getCoronaTexture(visual.isWhiteDwarf), [visual.isWhiteDwarf]);
  const tint = useMemo(
    () => new THREE.Color(visual.rgb[0], visual.rgb[1], visual.rgb[2]),
    [visual],
  );

  // 米粒缓动 + 日冕呼吸/反向自旋：全走 uniform/ref，零 React 状态
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    uniforms.uTime.value = t;
    const breathe = 1 + Math.sin(t * 0.4) * 0.04;
    const d = visual.scale * 2; // 球直径
    const c1 = corona1.current;
    if (c1) {
      c1.scale.set(2.4 * d * breathe, 2.4 * d * breathe, 1);
      c1.material.rotation = t * 0.02;
    }
    const c2 = corona2.current;
    if (c2) {
      c2.scale.set(3.2 * d * breathe, 3.2 * d * breathe, 1);
      c2.material.rotation = -t * 0.015; // 反向自旋
    }
  });

  const seg: [number, number] = lowTier ? [48, 32] : [64, 48];

  return (
    <group>
      <mesh ref={meshRef} scale={visual.scale}>
        <sphereGeometry args={[1, seg[0], seg[1]]} />
        <shaderMaterial
          vertexShader={VERTEX_SHADER}
          fragmentShader={FRAGMENT_SHADER}
          uniforms={uniforms}
        />
      </mesh>
      <sprite ref={corona1}>
        <spriteMaterial
          map={coronaTex}
          color={tint}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          transparent
          opacity={0.85}
        />
      </sprite>
      {/* 第二层日冕：低端档去掉（省一层大面积加色叠绘） */}
      {!lowTier && (
        <sprite ref={corona2}>
          <spriteMaterial
            map={coronaTex}
            color={tint}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            transparent
            opacity={0.4}
          />
        </sprite>
      )}
    </group>
  );
}

/** Canvas 渲染错误边界：WebGL 创建失败等 → 静默降级，不白屏。 */
class CanvasErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="flex h-full w-full items-center justify-center text-[12px] text-nebula-200/50">
          无法创建 3D 视图
        </div>
      );
    }
    return this.props.children;
  }
}

export function StarPane3D({ obj }: { obj: CelestialObject }) {
  const visual = useMemo(() => deriveStarVisual(obj), [obj]);
  const lowTier = useMemo(() => getDeviceTier() === 'low', []);
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);

  return (
    <div className="relative h-full w-full">
      <CanvasErrorBoundary>
        <Canvas
          dpr={lowTier ? 1 : [1, 2]}
          frameloop="always"
          camera={{ fov: 40, position: [0, 0, 4.4] }}
          gl={{ antialias: true, powerPreference: 'high-performance', alpha: true }}
        >
          <CameraFit scale={visual.scale} />
          <StarMesh visual={visual} lowTier={lowTier} />
          <OrbitControls
            ref={controlsRef}
            enablePan={false}
            enableDamping
            minDistance={1.5}
            maxDistance={9}
            autoRotate
            autoRotateSpeed={0.6}
            onStart={() => {
              // 用户接管后不再抢镜头
              const c = controlsRef.current;
              if (c) c.autoRotate = false;
            }}
          />
        </Canvas>
      </CanvasErrorBoundary>
    </div>
  );
}
