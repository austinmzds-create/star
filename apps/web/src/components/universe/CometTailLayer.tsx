'use client';

import {
  computeCometTailGeometry,
  MAX_TAIL_ANGLE_RAD,
} from '@star/astro-ephem';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { getDeviceTier, subscribeDeviceTier } from '@/lib/deviceTier';
import { EPHEM_SLERP_WINDOW_MS, slerpSphereVec } from '@/lib/ephemRegistry';
import { fx, getGlobalFade } from '@/lib/fxBus';
import {
  getMinorRosterVersion,
  minor,
  setCometTailVisible,
  subscribeMinorRoster,
  type MinorBodyState,
} from '@/lib/minorRegistry';
import { useUniverse } from '@/lib/store';
import { SPHERE_RADIUS } from '@/lib/universe';

/**
 * 真彗尾层（Phase 9B，调研 C §3a）：离子尾 + 尘埃尾 GPU 粒子，单 THREE.Points
 * 1 draw call。由 MinorBodiesLayer 挂载（同一懒 chunk，不改 UniverseScene）。
 *
 * 物理与几何全部来自 @star/astro-ephem/cometTail 纯函数（演示级声明见彼处）：
 *  - 离子尾：顶点着色器沿「彗星方向 P̂ → 切向 T_ion」大圆滑 aFrac^0.7·θ，
 *    高斯横向散布 σ≈0.5°，偏蓝 #88aaff，3% 正弦闪烁模拟太阳风扰动；
 *  - 尘埃尾：沿 synchrone 骨架（彗核方向 + 8 回溯点）Catmull-Rom 插值，
 *    σ≈2° 沿尾展开的扇面，黄白 #ffe8c0；
 *  - 亮度 = uBright·(1−aFrac)²，uBright 由总星等映射（r⁻ᴷ Δ⁻² 定律）。
 *
 * 帧循环纪律（与全站一致）：useFrame 零 React、零分配——只搬 uTime/总线
 * uniform 与（version 变化时）彗核方向；骨架/切向/亮度重算键 = observeTime
 * 量化 1h（3 彗星 ≤3×48 次星历调用，<0.5ms，render 期 useMemo 同步算）。
 *
 * 多彗星（≤3）合一次 draw：per-comet uniform 数组 + aInfo.x 粒子归属索引；
 * 不可见彗星 uBright=0，顶点着色器把其粒子钳到裁剪域外（零光栅化成本）；
 * setDrawRange 截掉尾部整段不活跃彗星。
 *
 * deepTimeYears（跨域契约，恒星自行时光机）非 null 时整层淡出——行星星历
 * 在万年尺度不可外推，与 MinorBodiesLayer 同节奏隐藏。
 */

/**
 * 支持同时渲染的彗星数上限（9C 跨域契约：预算封顶 8——内置 3 + 动态 ≤5；
 * 超出取最亮）。uniform 数组按 8 编译（8×(2+8) vec3 + 16 float，远在 WebGL
 * 最低 uniform 配额内）；不活跃槽 uBright=0 → 粒子钳出裁剪域零光栅化成本。
 */
const MAX_COMETS = 8;
/** 尘埃尾骨架点数（与 astro-ephem 默认一致，shader 里写死 8）。 */
const SKEL_K = 8;
/** 骨架/切向/亮度重算键：observeTime 量化 1h。 */
const QUANT_MS = 3600 * 1000;
/** 粒子半径：与小天体点位同层略靠内。 */
const TAIL_RADIUS = SPHERE_RADIUS * 0.99;
/** 每颗彗星的粒子预算：高/中档 4096，低档 1024（离子 40% / 尘埃 60%）。 */
const PARTICLES_HIGH = 4096;
const PARTICLES_LOW = 1024;

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uLayerFade;
  uniform vec3 uCometPos[${MAX_COMETS}];
  uniform vec3 uIonDir[${MAX_COMETS}];
  uniform vec3 uDustSkel[${MAX_COMETS * SKEL_K}];
  uniform float uTailAngle[${MAX_COMETS}];
  uniform float uBright[${MAX_COMETS}];
  // position 三通道复用为粒子参数（本层不需要真实静态坐标）：
  //   x = aFrac 沿尾 0–1，y = aLat 高斯横偏（单位 σ），z = aSeed 随机 0–1
  attribute vec2 aInfo; // x = 彗星索引 0..2，y = 尾种类 0 离子 / 1 尘埃
  varying float vAlpha;
  varying float vKind;

  // 尘埃骨架控制点：i=0 取彗核当前方向，i=1..8 取回溯骨架（i 越大越老）
  vec3 skelPoint(int base, int i, vec3 head) {
    i = clamp(i, 0, ${SKEL_K});
    return i == 0 ? head : uDustSkel[base + i - 1];
  }

  void main() {
    int c = int(aInfo.x + 0.5);
    float kind = aInfo.y;
    float frac = position.x;
    float lat = position.y;
    float seed = position.z;
    vec3 P = uCometPos[c];
    vec3 T = uIonDir[c];
    float bright = uBright[c] * uLayerFade;
    vec3 dir;
    float sizePx;
    if (kind < 0.5) {
      // —— 离子尾：大圆 slerp（P⊥T，故 P·cosθ+T·sinθ 即弧上点）——
      float ang = uTailAngle[c] * pow(frac, 0.7);
      vec3 N = cross(P, T); // P、T 均单位且正交 → N 已单位长
      // σ≈0.5°（0.0087 rad）横向高斯 + 随 uTime 微飘（模拟太阳风缕状扰动）
      float off = lat * 0.0087 * (0.35 + 0.65 * frac)
        + 0.004 * sin(uTime * 0.6 + seed * 6.2831 + frac * 7.0) * frac;
      dir = normalize(P * cos(ang) + T * sin(ang) + N * off);
      // 3% 闪烁（调研 §3a：离子尾扰动感）
      vAlpha = bright * pow(1.0 - frac, 2.0)
        * (1.0 + 0.03 * sin(uTime * 3.0 + seed * 6.2831));
      sizePx = 1.4 + 1.6 * (1.0 - frac);
    } else {
      // —— 尘埃尾：Catmull-Rom 沿 synchrone 骨架 ——
      float ft = frac * float(${SKEL_K});
      int seg = int(min(ft, float(${SKEL_K}) - 0.0001));
      float u = ft - float(seg);
      int base = c * ${SKEL_K};
      vec3 p0 = skelPoint(base, seg - 1, P);
      vec3 p1 = skelPoint(base, seg, P);
      vec3 p2 = skelPoint(base, seg + 1, P);
      vec3 p3 = skelPoint(base, seg + 2, P);
      vec3 q = 0.5 * (2.0 * p1 + (-p0 + p2) * u
        + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * (u * u)
        + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * (u * u * u));
      vec3 qn = normalize(q);
      // 横向基：骨架方向 × 离子切向（近头部 ⊥ 保证非零；深弯折处兜底）
      vec3 N = cross(qn, T);
      float nl = length(N);
      N = nl > 1e-4 ? N / nl : cross(qn, P);
      // σ≈2°（0.035 rad），沿尾展开成扇面
      float off = lat * 0.035 * (0.15 + 0.85 * frac);
      dir = normalize(qn + N * off);
      vAlpha = bright * pow(1.0 - frac, 2.0) * 0.75;
      sizePx = 2.0 + 2.2 * (1.0 - frac);
    }
    vKind = kind;
    if (vAlpha < 0.002) {
      // 不活跃彗星/尾梢暗粒子：钳出裁剪域，零光栅化成本
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    vec4 mv = modelViewMatrix * vec4(dir * ${TAIL_RADIUS.toFixed(1)}, 1.0);
    gl_PointSize = sizePx * uPixelRatio;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uGlobalFade;
  uniform float uPipe;
  varying float vAlpha;
  varying float vKind;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    if (d > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, d);
    // 离子蓝 #88aaff / 尘埃黄白 #ffe8c0（调研 §3a 配色）
    vec3 col = mix(vec3(0.533, 0.667, 1.0), vec3(1.0, 0.910, 0.753), vKind);
    col *= (0.55 + 0.65 * soft) * uGlobalFade;
    // 线性管线适配（composer 激活时 uPipe=1）：与 TwinkleStars 同一纪律——
    // 输出为显示参考值，先反解回线性域，避免链尾 ENCODE_OUTPUT 二次编码洗白
    if (uPipe > 0.5) {
      col = mix(
        pow((col + 0.055) / 1.055, vec3(2.4)),
        col / 12.92,
        vec3(lessThanEqual(col, vec3(0.04045)))
      );
    }
    gl_FragColor = vec4(col, vAlpha * soft);
  }
`;

/** 彗核方向平滑 slerp 输出 scratch（useFrame 路径零分配纪律）。 */
const dirScratch = new THREE.Vector3();

/** Box-Muller 高斯（钳 ±2.8σ，防离群粒子远飞）。 */
function gaussian(): number {
  const u = Math.max(Math.random(), 1e-9);
  const v = Math.random();
  const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(-2.8, Math.min(2.8, g));
}

export function CometTailLayer() {
  const tier = useSyncExternalStore(subscribeDeviceTier, getDeviceTier, getDeviceTier);
  const pixelRatio = useThree((s) => s.gl.getPixelRatio());
  const perComet = tier === 'low' ? PARTICLES_LOW : PARTICLES_HIGH;
  const versionRef = useRef(-1);
  const fadeRef = useRef(1);
  /** 播放平滑（§3b，与 MinorBodiesLayer 点位同窗口）：version 变化墙钟时刻。 */
  const versionWallMsRef = useRef(0);
  const smoothingRef = useRef(false);

  // 骨架/切向/亮度重算键：observeTime 量化 1h。播放 1周/秒 档 4Hz 写 store
  // 时该键约 4 次/秒变化，每次 <0.5ms，仍在预算内（调研 §3a 性能预算）。
  const quantKey = useUniverse((s) => Math.floor((s.observeTime ?? Date.now()) / QUANT_MS));
  // 跨域契约（Phase 9B 冻结）：deepTimeYears 归「地平锁定」域，本域只读；
  // 字段可能尚未合入（并行开发），读不到一律视为 null（关闭）。
  const deepTimeActive = useUniverse(
    (s) => ((s as unknown as { deepTimeYears?: number | null }).deepTimeYears ?? null) !== null,
  );

  // 动态花名册（9C）：版本变化重建槽位与粒子缓冲（roster 由 MinorBodiesLayer
  // 挂载时的 ensureMinorBodiesRoster 驱动，本层同 chunk 只订阅不发起）。
  const roster = useSyncExternalStore(
    subscribeMinorRoster,
    getMinorRosterVersion,
    getMinorRosterVersion,
  );

  const built = useMemo(() => {
    // 彗星槽位：注册表声明序（内置 3 颗恒在前，动态注册序次之），封顶 MAX_COMETS。
    // minorRegistry 侧注册已按 M1 最亮优先截断到同一预算，这里的 slice 只是双保险。
    const comets: MinorBodyState[] = [...minor.states.values()]
      .filter((s) => s.kind === 'comet')
      .slice(0, MAX_COMETS);
    const total = comets.length * perComet;
    const pos = new Float32Array(total * 3); // (aFrac, aLat, aSeed)
    const info = new Float32Array(total * 2); // (cometIdx, kind)
    for (let c = 0; c < comets.length; c++) {
      const ionCount = Math.floor(perComet * 0.4); // 离子 40% / 尘埃 60%
      for (let i = 0; i < perComet; i++) {
        const j = c * perComet + i;
        pos[j * 3] = Math.random(); // aFrac
        pos[j * 3 + 1] = gaussian(); // aLat
        pos[j * 3 + 2] = Math.random(); // aSeed
        info[j * 2] = c;
        info[j * 2 + 1] = i < ionCount ? 0 : 1;
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('aInfo', new THREE.BufferAttribute(info, 2));
    geom.setDrawRange(0, 0);

    const uniforms = {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uLayerFade: { value: 1 },
      uGlobalFade: { value: 1 },
      uPipe: { value: 0 },
      uCometPos: { value: Array.from({ length: MAX_COMETS }, () => new THREE.Vector3(0, 1, 0)) },
      uIonDir: { value: Array.from({ length: MAX_COMETS }, () => new THREE.Vector3(1, 0, 0)) },
      uDustSkel: {
        value: Array.from({ length: MAX_COMETS * SKEL_K }, () => new THREE.Vector3(0, 1, 0)),
      },
      uTailAngle: { value: new Array(MAX_COMETS).fill(0) as number[] },
      uBright: { value: new Array(MAX_COMETS).fill(0) as number[] },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geom, mat);
    points.renderOrder = 7.5; // 尾线（7）之上、小天体点（8）之下
    points.frustumCulled = false;
    points.visible = false;
    /** 每颗彗星最近一次量化重算的可见结论（deepTime 退出时恢复注册表旗标用）。 */
    const lastVisible = new Array<boolean>(comets.length).fill(false);
    /** 播放平滑插值起点（单位方向，version 变化时记 uniform 现值）。 */
    const prevDirs = comets.map(() => new THREE.Vector3(0, 1, 0));
    return { comets, geom, mat, uniforms, points, lastVisible, prevDirs };
  }, [perComet, roster]);

  useEffect(() => {
    return () => {
      built.geom.dispose();
      built.mat.dispose();
      // 卸载即撤旗标：防「层已关、信息卡徽章还亮」的幽灵状态
      for (const st of built.comets) setCometTailVisible(st.uid, false);
    };
  }, [built]);

  // 低频重算（render 期同步，与 MinorBodiesLayer 尾线同模式）：
  // 每颗彗星一次 computeCometTailGeometry（亮度阈值内含骨架自适应回溯），
  // 写 per-comet uniform 数组 + 注册表 tailVisible + drawRange。
  useMemo(() => {
    const date = new Date(quantKey * QUANT_MS);
    const u = built.uniforms;
    let lastActive = -1;
    built.comets.forEach((st, i) => {
      const g = computeCometTailGeometry(st.id, date);
      const on = !!g && g.visible;
      built.lastVisible[i] = on;
      if (g && on) {
        u.uCometPos.value[i]!.set(g.cometDir.x, g.cometDir.y, g.cometDir.z);
        u.uIonDir.value[i]!.set(g.ionDir.x, g.ionDir.y, g.ionDir.z);
        for (let k = 0; k < SKEL_K; k++) {
          const p = g.dustSkeleton[k];
          // 骨架恒 8 点；兜底重复末点（Catmull-Rom 端点钳制安全）
          const q = p ?? g.dustSkeleton[g.dustSkeleton.length - 1];
          if (q) u.uDustSkel.value[i * SKEL_K + k]!.set(q.x, q.y, q.z);
        }
        u.uTailAngle.value[i] = Math.min(g.tailAngleRad, MAX_TAIL_ANGLE_RAD);
        u.uBright.value[i] = g.brightness;
        lastActive = i;
      } else {
        u.uTailAngle.value[i] = 0;
        u.uBright.value[i] = 0;
      }
    });
    built.geom.setDrawRange(0, lastActive >= 0 ? (lastActive + 1) * perComet : 0);
  }, [built, perComet, quantKey]);

  // 注册表旗标随 deepTime 联动：万年模式里层已隐藏，徽章不应再亮
  useEffect(() => {
    built.comets.forEach((st, i) => {
      setCometTailVisible(st.uid, deepTimeActive ? false : built.lastVisible[i] === true);
    });
  }, [built, deepTimeActive, quantKey]);

  useFrame((_, delta) => {
    const u = built.uniforms;
    u.uTime.value += delta;
    u.uPixelRatio.value = pixelRatio;
    u.uGlobalFade.value = getGlobalFade();
    u.uPipe.value = fx.linearPipe;
    // deepTime 淡出/回归：场景级节奏（~0.5s 到位），uLayerFade 进顶点亮度
    fadeRef.current = THREE.MathUtils.damp(fadeRef.current, deepTimeActive ? 0 : 1, 6, delta);
    u.uLayerFade.value = fadeRef.current;
    // 彗核方向跟随注册表（30s 心跳 / 播放 4Hz），骨架保持 1h 量化——
    // 尾根永远贴着彗星点位。播放平滑（§3b）：MinorBodiesLayer 的点位在
    // 250ms 窗口内 slerp 补间，这里对 uCometPos 做同窗口同函数的插值，
    // 保证尾根与彗星点像素级同步滑动（版本快照起点 = uniform 现值）。
    const nowWall = performance.now();
    if (versionRef.current !== minor.version) {
      versionRef.current = minor.version;
      versionWallMsRef.current = nowWall;
      smoothingRef.current = true;
      for (let i = 0; i < built.comets.length; i++) {
        built.prevDirs[i]!.copy(u.uCometPos.value[i]!);
      }
    }
    if (smoothingRef.current) {
      const t = (nowWall - versionWallMsRef.current) / EPHEM_SLERP_WINDOW_MS;
      const k = t >= 1 ? 1 : t;
      for (let i = 0; i < built.comets.length; i++) {
        if (u.uBright.value[i]! <= 0) continue; // 不活跃彗星粒子已被钳出裁剪域
        // prevDirs 是单位向量、st.vec 半径 0.99R——slerpSphereVec 半径线性
        // 过渡不影响方向，出口归一即得纯方向
        slerpSphereVec(built.prevDirs[i]!, built.comets[i]!.vec, k, dirScratch);
        u.uCometPos.value[i]!.copy(dirScratch).normalize();
      }
      if (t >= 1) smoothingRef.current = false;
    }
    const { count } = built.geom.drawRange;
    built.points.visible = count > 0 && minor.version > 0 && fadeRef.current > 0.005;
  });

  return <primitive object={built.points} />;
}
