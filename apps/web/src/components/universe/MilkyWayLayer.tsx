'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { getDeviceTier } from '@/lib/deviceTier';
import { useUniverse } from '@/lib/store';

/**
 * 真实银河全景层（宇宙 V3-A，V4 色彩分级升级）。
 *
 * NASA SVS Deep Star Maps 2020（celestial/赤道坐标 equirectangular，
 * RA=0h 居中、RA 向左增；Gaia DR2 数据，署名见 public/credits.json）
 * 贴在半径 1600 的天球内壁：介于星点层（1000）与天穹渐变（1800）之间。
 *
 * draw call 账本（V4）：贴图球 1 + 程序化薄雾辉光带 1 = 2（低端 1：无薄雾带）。
 *
 * 资产路径约定（fetch-assets 脚本落盘，本组件不 import 二进制）：
 *   /textures/milkyway/starmap-2020-4k.jpg（高档） / starmap-2020-2k.jpg（低档）
 * 加载失败 → 整层静默降级：generateAmbientField 的程序化银河带仍在。
 * 薄雾带也随之不出现——它对齐真实银道坐标，而程序化兜底带是任意倾角
 * （rotationX 62°）的假带，两者同屏会出现两条错开的「银河」。
 *
 * 【V4 §2.1】meshBasicMaterial → ShaderMaterial 做色彩分级（不加 draw call）：
 * S 曲线压暗底/抬高光，按亮度分区调色（尘带核球暖调、外围冷蓝晕），
 * uExposure 随 fov 自适应（放大看局部时压曝光防灰白）。
 *
 * UV 朝向推导（详见宇宙 V3 设计 §2.3）：项目星点约定 x=cosδcosα, y=sinδ,
 * z=−cosδsinα 与 SphereGeometry 参数化联立解得 u_geo = 0.5 + α/360，而图像
 * u_img = 0.5 − α/360，二者互补 —— 只需一次水平翻转。原实现用 wrapS=Repeat、
 * repeat.x=−1；ShaderMaterial 不走纹理矩阵，等价翻转改在片元 `1.0 - vUv.x`
 * 完成。注意不要再叠 scale=[-1,1,1]（会二次镜像）。
 */

/** 银河天球半径：星点(1000) 与天穹渐变(1800) 之间。 */
const MILKY_RADIUS = 1600;
/** 薄雾辉光带半径：略小于贴图球，叠加时先画贴图再画薄雾（renderOrder 区分）。 */
const HAZE_RADIUS = 1590;
/** 淡入时长（秒）——首次加载完成后缓缓浮现。 */
const FADE_IN_SEC = 1.5;
/** 淡出时长（秒）——开关关闭时快速隐去。 */
const FADE_OUT_SEC = 0.25;

const MILKY_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const MILKY_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform float uExposure;
  varying vec2 vUv;
  void main() {
    // 水平翻转在此完成（等价于旧 repeat.x=-1，推导见组件头注释）
    vec3 c = texture2D(uMap, vec2(1.0 - vUv.x, vUv.y)).rgb;
    c = pow(c * 1.06, vec3(1.28));                       // S 曲线：压暗底、抬高光
    float L = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 warm = c * vec3(1.10, 0.97, 0.85);              // 尘带/核球暖调
    vec3 cool = c * vec3(0.80, 0.90, 1.14);              // 外围冷蓝晕
    c = mix(cool, warm, smoothstep(0.10, 0.42, L));      // 按亮度分区调色
    c *= uExposure;
    gl_FragColor = vec4(c, uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const HAZE_VERTEX = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * 程序化薄雾辉光带（V4 §2.2，高档专属 +1 draw call，零纹理）：
 * 世界坐标算到银道面/银心的角距——高斯银纬带（σ≈8°）+ 银心方向的核球增亮，
 * 冷蓝外围渐变到暖金核球。uFade 跟随贴图层透明度系数（0–1）同步淡入淡出。
 */
const HAZE_FRAGMENT = /* glsl */ `
  uniform float uFade;
  varying vec3 vWorldPos;
  void main() {
    // 项目约定 x=cosδcosα, y=sinδ, z=−cosδsinα 下的银道面法线（NGP）与银心方向
    const vec3 NGP = vec3(-0.8677, 0.4560, 0.1979);
    const vec3 GC  = vec3(-0.0549, -0.4839, 0.8734);
    vec3 dir = normalize(vWorldPos);
    float lat = asin(clamp(dot(dir, NGP), -1.0, 1.0));
    float band  = exp(-pow(lat / 0.14, 2.0));                       // σ≈8° 银纬带
    float bulge = exp(-pow(acos(clamp(dot(dir, GC), -1.0, 1.0)) / 0.42, 2.0));
    vec3 col = mix(vec3(0.35, 0.46, 0.72), vec3(0.86, 0.70, 0.50), bulge);
    float a = band * (0.055 + 0.075 * bulge) * uFade;
    gl_FragColor = vec4(col * a, a);   // 预乘感的加色薄雾
  }
`;

export function MilkyWayLayer() {
  const showMilkyWay = useUniverse((s) => s.showMilkyWay);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const failedRef = useRef(false);
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const hazeMeshRef = useRef<THREE.Mesh>(null);
  const hazeMatRef = useRef<THREE.ShaderMaterial>(null);
  // 低档设备：2k 纹理 + 略低目标透明度 + 不挂薄雾带
  const tierRef = useRef(getDeviceTier());
  // V4：高档目标透明度 0.55 → 0.62（色彩分级后信息密度更高，可承受）
  const targetOpacity = tierRef.current === 'low' ? 0.45 : 0.62;

  // 懒加载：首次开启（默认开）才 fetch 纹理；失败静默降级且不再重试。
  useEffect(() => {
    if (!showMilkyWay || texture || failedRef.current) return;
    let alive = true;
    const url =
      tierRef.current === 'low'
        ? '/textures/milkyway/starmap-2020-2k.jpg'
        : '/textures/milkyway/starmap-2020-4k.jpg';
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (tex) => {
        if (!alive) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        setTexture(tex);
      },
      undefined,
      () => {
        // 资产缺失/网络失败：无银河层，程序化银河带（AmbientField）仍在
        failedRef.current = true;
      },
    );
    return () => {
      alive = false;
    };
  }, [showMilkyWay, texture]);

  // 卸载时释放纹理
  useEffect(() => {
    return () => {
      texture?.dispose();
    };
  }, [texture]);

  // uniforms 只在纹理就绪时建一次；材质挂载晚于纹理，帧循环只写 value。
  const uniforms = useMemo(
    () =>
      texture
        ? {
            uMap: { value: texture },
            uOpacity: { value: 0 },
            uExposure: { value: 1 },
          }
        : null,
    [texture],
  );
  const hazeUniforms = useMemo(() => ({ uFade: { value: 0 } }), []);

  // 透明度插值：开→缓缓淡入，关→快速淡出；淡到 0 后隐藏 mesh 省填充率。
  // 曝光自适应：fov 25（放大）→ 0.85，fov 60（广角）→ 1.30，防局部灰白。
  useFrame((state, delta) => {
    const mat = matRef.current;
    const mesh = meshRef.current;
    if (!mat || !mesh) return;
    const uOpacity = mat.uniforms.uOpacity!;
    const target = showMilkyWay ? targetOpacity : 0;
    const diff = target - uOpacity.value;
    if (diff !== 0) {
      const step = delta / (diff > 0 ? FADE_IN_SEC : FADE_OUT_SEC);
      uOpacity.value =
        Math.abs(diff) <= step * targetOpacity
          ? target
          : uOpacity.value + Math.sign(diff) * step * targetOpacity;
    }
    const fov = (state.camera as THREE.PerspectiveCamera).fov;
    mat.uniforms.uExposure!.value = THREE.MathUtils.lerp(
      1.3,
      0.85,
      THREE.MathUtils.clamp((fov - 25) / (60 - 25), 0, 1),
    );
    const visible = uOpacity.value > 0.001;
    mesh.visible = visible;
    // 薄雾带跟随贴图层的透明度系数（0–1）同步淡入淡出
    const hazeMat = hazeMatRef.current;
    const hazeMesh = hazeMeshRef.current;
    if (hazeMat && hazeMesh) {
      hazeMat.uniforms.uFade!.value = uOpacity.value / targetOpacity;
      hazeMesh.visible = visible;
    }
  });

  if (!texture || !uniforms) return null;

  return (
    <group>
      <mesh ref={meshRef} renderOrder={0.5} frustumCulled={false}>
        <sphereGeometry args={[MILKY_RADIUS, 64, 32]} />
        <shaderMaterial
          ref={matRef}
          uniforms={uniforms}
          vertexShader={MILKY_VERTEX}
          fragmentShader={MILKY_FRAGMENT}
          side={THREE.BackSide}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      {/* 薄雾辉光带：低端 tier 不挂载（draw call 账本 +0） */}
      {tierRef.current !== 'low' && (
        <mesh ref={hazeMeshRef} renderOrder={0.55} frustumCulled={false}>
          <sphereGeometry args={[HAZE_RADIUS, 48, 24]} />
          <shaderMaterial
            ref={hazeMatRef}
            uniforms={hazeUniforms}
            vertexShader={HAZE_VERTEX}
            fragmentShader={HAZE_FRAGMENT}
            side={THREE.BackSide}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      )}
    </group>
  );
}
