'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { prefersReducedMotion } from '@/lib/device';
import { getDeviceTier } from '@/lib/deviceTier';
import {
  MAX_ACTIVE_SHOWERS,
  meteors,
  recomputeMeteorActivity,
} from '@/lib/meteorRegistry';
import { useUniverse } from '@/lib/store';
import { SPHERE_RADIUS } from '@/lib/universe';

/**
 * 流星雨层（Phase 9B §3d，「流星雨」域；文件落点为跨域契约 §4 冻结，
 * UniverseScene 挂载行归「地平锁定」域）。
 *
 * 三件套（活跃期外全部隐藏，零 draw）：
 *  1. 辐射点同心圆环 marker——单 THREE.Points shader sprite（≤3 顶点，
 *     1 draw），环带 + 由内向外的缓慢呼吸扩散环，强度随 ZHR_eff；
 *  2. 名称 sprite——每场活跃雨一枚 canvas 文本（≤3 draw，签名变化才重画）；
 *  3. 程序化流星——单 THREE.LineSegments 池 64 slot × 6 顶点（契约冻结：
 *     每颗 3 段连续折线 = 6 顶点对，报告「5 段」的工程简化，短弧观感等价），
 *     attribute aStart/aDir/aBirth/aLen/aSpeed，顶点着色器按 uNow − aBirth
 *     演进头部位置与亮度（头亮尾暗顶点色 + 出生/熄灭包络）；CPU 仅在
 *     spawn 时对单 slot 做 subarray 写入（addUpdateRange 增量上传，
 *     每秒 0–3 次），其余帧零 CPU。
 *
 * 【物理演出约定】流星从「距辐射点 20°–70° 的球面随机点」点亮，沿
 * 「辐射点 → 该点」的大圆延长线滑出 5°–25°（真实透视：流星迹反向延长
 * 必过辐射点，且不在辐射点处点亮）；寿命 0.4–1.0s（墙钟，不随时间机器
 * 加速——流星是氛围演出而非星历）。生成率 = 泊松过程，λ 来自
 * meteorRegistry（ZHR_eff·sin(alt)·K，辐射点地平线下为 0）。
 *
 * 【降级】prefers-reduced-motion → 生成率 ×0.15；低档设备 ×0.5。
 * 【深时】deepTimeYears 非 null 时整层淡出（辐射点/活跃期在 ±10 万年
 * 尺度同样不可外推，与行星/小天体各层同节奏，跨域契约 §3 精神）。
 *
 * 天象日历深链（almanac 流星雨事件）：深链把 observeTime travelTo 到极大
 * 期当夜并点亮辐射点星座——本层活跃判定跟随 observeTime，深链落地即自动
 * 点亮 marker 与流星，无需额外开关。
 */

/** 流星池容量（跨域契约冻结：64 slot × 6 顶点）。 */
const MAX_METEORS = 64;
const VERTS_PER_METEOR = 6;
/** 流星/辐射点渲染半径（恒星 1000 之内、行星尾线之外的夹层）。 */
const METEOR_RADIUS = SPHERE_RADIUS * 0.98;

const DEG2RAD = Math.PI / 180;

// ── spawn 用模块级 scratch（零分配纪律） ──
const sR = new THREE.Vector3();
const sU = new THREE.Vector3();
const sS = new THREE.Vector3();
const sT = new THREE.Vector3();
const sRnd = new THREE.Vector3();

const METEOR_VERTEX = /* glsl */ `
  uniform float uNow;
  uniform float uFade;
  attribute vec3 aStart;
  attribute vec3 aDir;
  attribute float aBirth;
  attribute float aLen;
  attribute float aSpeed;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    // position.x 复用为「沿迹分数」f：0 尾 → 1 头（本层无真实静态坐标）
    float f = position.x;
    float age = uNow - aBirth;
    float dur = aLen / max(aSpeed, 1e-6);
    if (age < 0.0 || age > dur * 1.25) {
      // 空闲/已熄灭 slot：钳到裁剪域外，零光栅化成本
      vAlpha = 0.0;
      vColor = vec3(0.0);
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    // 头部沿大圆推进（S⊥T 正交单位向量 → S·cosθ + T·sinθ 即弧上点）
    float head = min(age * aSpeed, aLen);
    float tail = min(head, aLen * 0.45 + 0.02);
    float ang = head - (1.0 - f) * tail;
    vec3 p = normalize(aStart * cos(ang) + aDir * sin(ang)) * ${METEOR_RADIUS.toFixed(1)};
    // 亮度：出生 0.1·dur 内淡入，0.7·dur 后拖尾淡出；头亮尾暗（f²）
    float lifeF = age / dur;
    float env = smoothstep(0.0, 0.1, lifeF) * (1.0 - smoothstep(0.7, 1.25, lifeF));
    vAlpha = uFade * env * (0.1 + 0.9 * f * f);
    // 尾偏蓝（电离余辉）→ 头暖白（灼烧头部）
    vColor = mix(vec3(0.45, 0.55, 0.95), vec3(1.0, 0.97, 0.9), f);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const METEOR_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    if (vAlpha < 0.004) discard;
    gl_FragColor = vec4(vColor * vAlpha, vAlpha);
  }
`;

const RING_VERTEX = /* glsl */ `
  attribute float aStrength;
  uniform float uPixelRatio;
  varying float vStrength;
  void main() {
    vStrength = aStrength;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = (64.0 + 40.0 * aStrength) * uPixelRatio;
  }
`;

const RING_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uFade;
  varying float vStrength;

  float ring(float d, float r, float w) {
    return 1.0 - smoothstep(0.0, w, abs(d - r));
  }

  void main() {
    vec2 pc = gl_PointCoord - 0.5;
    float d = length(pc) * 2.0; // 0 中心 → 1 点精灵边缘
    if (d > 1.0) discard;
    // 三重同心环（内亮外淡）+ 由内向外的缓慢扩散呼吸环（周期 4s）
    float a = ring(d, 0.22, 0.06) * 0.85
            + ring(d, 0.55, 0.05) * 0.5
            + ring(d, 0.88, 0.045) * 0.3;
    float pulse = fract(uTime * 0.25);
    a += ring(d, pulse, 0.06) * (1.0 - pulse) * 0.4;
    float alpha = a * (0.3 + 0.7 * vStrength) * uFade;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vec3(0.62, 0.74, 1.0) * alpha, alpha);
  }
`;

/** 名称文本纹理（与 PlanetsLayer 标签同风格，紫调辉光示流星雨）。 */
function drawShowerLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
): void {
  ctx.clearRect(0, 0, 256, 64);
  ctx.font = '600 26px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(150,130,255,0.9)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = 'rgba(235,238,255,0.95)';
  ctx.fillText(text, 128, 33);
}

export function MeteorShowerLayer() {
  const observeTime = useUniverse((s) => s.observeTime);
  const city = useUniverse((s) => s.city);
  // 跨域契约 §3：deepTimeYears 归「地平锁定」域写入，本层只读判 null
  const deepTimeActive = useUniverse((s) => s.deepTimeYears !== null);

  const fadeRef = useRef(1);
  /** 泊松过程的下一次 spawn 倒计时（秒）；<0 表示待采样。 */
  const spawnCountdownRef = useRef(-1);
  /** registry 版本（版本变化 → marker 已在 effect 重建，这里重采样倒计时）。 */
  const rateVersionRef = useRef(-1);
  /** 池写入游标（round-robin 覆盖最旧 slot）。 */
  const slotCursorRef = useRef(0);
  /** 活跃场次签名（名称纹理只在场次集合变化时重画）。 */
  const labelSigRef = useRef('');

  // 降频系数：一次性探测（reduced-motion 会话内不变；tier 异步微调误差可忽略）
  const rateScale = useMemo(
    () => (getDeviceTier() === 'low' ? 0.5 : 1) * (prefersReducedMotion() ? 0.15 : 1),
    [],
  );

  const built = useMemo(() => {
    const disposables: Array<{ dispose(): void }> = [];

    // ── 1. 辐射点圆环 marker：单 Points（≤3 顶点，1 draw） ──
    const ringGeom = new THREE.BufferGeometry();
    const ringPos = new Float32Array(MAX_ACTIVE_SHOWERS * 3);
    const ringStrength = new Float32Array(MAX_ACTIVE_SHOWERS);
    ringGeom.setAttribute('position', new THREE.BufferAttribute(ringPos, 3));
    ringGeom.setAttribute('aStrength', new THREE.BufferAttribute(ringStrength, 1));
    ringGeom.setDrawRange(0, 0);
    const ringMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFade: { value: 1 },
        uPixelRatio: { value: 1 },
      },
      vertexShader: RING_VERTEX,
      fragmentShader: RING_FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    disposables.push(ringGeom, ringMat);
    const rings = new THREE.Points(ringGeom, ringMat);
    rings.renderOrder = 6;
    rings.frustumCulled = false;

    // ── 2. 名称 sprite（≤3 枚，各自 canvas；场次集合变化才重画） ──
    const labels: Array<{
      sprite: THREE.Sprite;
      material: THREE.SpriteMaterial;
      ctx: CanvasRenderingContext2D;
      tex: THREE.CanvasTexture;
    }> = [];
    for (let i = 0; i < MAX_ACTIVE_SHOWERS; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0.8,
        depthTest: false,
        depthWrite: false,
      });
      disposables.push(tex, material);
      const sprite = new THREE.Sprite(material);
      const h = 13;
      sprite.scale.set(h * 4, h, 1);
      // 锚点上移 → 名称渲染在辐射点圆环下方
      sprite.center.set(0.5, 3.2);
      sprite.renderOrder = 6.2;
      sprite.visible = false;
      labels.push({ sprite, material, ctx, tex });
    }

    // ── 3. 流星池：单 LineSegments，64 slot × 6 顶点（契约冻结布局） ──
    const total = MAX_METEORS * VERTS_PER_METEOR;
    const meteorGeom = new THREE.BufferGeometry();
    // position.x = 沿迹分数（3 段连续折线的顶点对：0-⅓ ⅓-⅔ ⅔-1），静态一次写入
    const posArr = new Float32Array(total * 3);
    const FRACS = [0, 1 / 3, 1 / 3, 2 / 3, 2 / 3, 1] as const;
    for (let s = 0; s < MAX_METEORS; s++) {
      for (let i = 0; i < VERTS_PER_METEOR; i++) {
        posArr[(s * VERTS_PER_METEOR + i) * 3] = FRACS[i]!;
      }
    }
    const aStart = new Float32Array(total * 3);
    const aDir = new Float32Array(total * 3);
    const aBirth = new Float32Array(total).fill(-1e9); // 空闲标记：age 超限即被裁剪
    const aLen = new Float32Array(total).fill(0.1);
    const aSpeed = new Float32Array(total).fill(1);
    const posAttr = new THREE.BufferAttribute(posArr, 3);
    const startAttr = new THREE.BufferAttribute(aStart, 3);
    const dirAttr = new THREE.BufferAttribute(aDir, 3);
    const birthAttr = new THREE.BufferAttribute(aBirth, 1);
    const lenAttr = new THREE.BufferAttribute(aLen, 1);
    const speedAttr = new THREE.BufferAttribute(aSpeed, 1);
    startAttr.setUsage(THREE.DynamicDrawUsage);
    dirAttr.setUsage(THREE.DynamicDrawUsage);
    birthAttr.setUsage(THREE.DynamicDrawUsage);
    lenAttr.setUsage(THREE.DynamicDrawUsage);
    speedAttr.setUsage(THREE.DynamicDrawUsage);
    meteorGeom.setAttribute('position', posAttr);
    meteorGeom.setAttribute('aStart', startAttr);
    meteorGeom.setAttribute('aDir', dirAttr);
    meteorGeom.setAttribute('aBirth', birthAttr);
    meteorGeom.setAttribute('aLen', lenAttr);
    meteorGeom.setAttribute('aSpeed', speedAttr);
    const meteorMat = new THREE.ShaderMaterial({
      uniforms: {
        uNow: { value: 0 },
        uFade: { value: 1 },
      },
      vertexShader: METEOR_VERTEX,
      fragmentShader: METEOR_FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    disposables.push(meteorGeom, meteorMat);
    const meteorLines = new THREE.LineSegments(meteorGeom, meteorMat);
    meteorLines.renderOrder = 6.5;
    meteorLines.frustumCulled = false;

    return {
      disposables,
      rings, ringGeom, ringPos, ringStrength, ringMat,
      labels,
      meteorLines, meteorMat,
      startAttr, dirAttr, birthAttr, lenAttr, speedAttr,
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const d of built.disposables) d.dispose();
    };
  }, [built]);

  // 活跃期重算 + marker 同步（低频：observeTime/city 变化，播放期 ≤4Hz；
  // 全部为 attribute/canvas 写入，无 React 状态）
  useEffect(() => {
    recomputeMeteorActivity(
      observeTime ?? Date.now(),
      city.latitudeDeg,
      city.longitudeDeg,
    );
    const act = meteors.active;
    for (let i = 0; i < act.length; i++) {
      const st = act[i]!;
      built.ringPos[i * 3] = st.vec.x;
      built.ringPos[i * 3 + 1] = st.vec.y;
      built.ringPos[i * 3 + 2] = st.vec.z;
      // 强度归一：ZHR_eff 120 以上封顶（双子/英仙极大 → 满强度环）
      built.ringStrength[i] = Math.min(1, Math.sqrt(st.zhrEff / 120));
      built.labels[i]!.sprite.position.copy(st.vec);
    }
    built.ringGeom.setDrawRange(0, act.length);
    built.ringGeom.attributes.position!.needsUpdate = true;
    built.ringGeom.attributes.aStrength!.needsUpdate = true;
    // 名称纹理：场次集合变化才重画（canvas 文本成本不进 4Hz 路径）
    const sig = act.map((s) => s.info.showerId).join(',');
    if (sig !== labelSigRef.current) {
      labelSigRef.current = sig;
      for (let i = 0; i < act.length; i++) {
        const label = built.labels[i]!;
        drawShowerLabel(label.ctx, act[i]!.info.nameZh);
        label.tex.needsUpdate = true;
      }
    }
  }, [observeTime, city, built]);

  /** 生成一颗流星（spawn 路径：每秒 0–3 次，scratch 零分配）。 */
  function spawnMeteor(nowSec: number): void {
    // 按生成率加权选场次
    const act = meteors.active;
    if (act.length === 0 || meteors.totalRatePerSec <= 0) return;
    let pick = Math.random() * meteors.totalRatePerSec;
    let shower = act[0]!;
    for (const st of act) {
      pick -= st.ratePerSec;
      if (pick <= 0) {
        shower = st;
        break;
      }
    }
    // 辐射点方向 R̂；随机取与 R̂ 夹角 20°–70° 的球面点为起点 S
    //（真实透视：流星在离辐射点一段距离处点亮，反向延长必过辐射点）
    sR.copy(shower.vec).normalize();
    // 随机单位向量 → 投影出 ⊥R̂ 的方位向量 U
    do {
      sRnd.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      sU.copy(sRnd).addScaledVector(sR, -sRnd.dot(sR));
    } while (sU.lengthSq() < 1e-4);
    sU.normalize();
    const theta = (20 + 50 * Math.random()) * DEG2RAD;
    sS.copy(sR).multiplyScalar(Math.cos(theta)).addScaledVector(sU, Math.sin(theta));
    // 大圆切向（远离辐射点方向）：T = −normalize(R̂ − S(S·R̂))
    sT.copy(sR).addScaledVector(sS, -sS.dot(sR)).normalize().negate();
    const lenRad = (5 + 20 * Math.random()) * DEG2RAD;
    const lifeSec = 0.4 + 0.6 * Math.random();
    const speed = lenRad / lifeSec;

    const slot = slotCursorRef.current;
    slotCursorRef.current = (slot + 1) % MAX_METEORS;
    const vBase = slot * VERTS_PER_METEOR;
    for (let i = 0; i < VERTS_PER_METEOR; i++) {
      const v = vBase + i;
      built.startAttr.setXYZ(v, sS.x, sS.y, sS.z);
      built.dirAttr.setXYZ(v, sT.x, sT.y, sT.z);
      built.birthAttr.setX(v, nowSec);
      built.lenAttr.setX(v, lenRad);
      built.speedAttr.setX(v, speed);
    }
    // 增量上传：只标记本 slot 的 subarray（three 上传后自动清空 ranges）
    built.startAttr.addUpdateRange(vBase * 3, VERTS_PER_METEOR * 3);
    built.dirAttr.addUpdateRange(vBase * 3, VERTS_PER_METEOR * 3);
    built.birthAttr.addUpdateRange(vBase, VERTS_PER_METEOR);
    built.lenAttr.addUpdateRange(vBase, VERTS_PER_METEOR);
    built.speedAttr.addUpdateRange(vBase, VERTS_PER_METEOR);
    built.startAttr.needsUpdate = true;
    built.dirAttr.needsUpdate = true;
    built.birthAttr.needsUpdate = true;
    built.lenAttr.needsUpdate = true;
    built.speedAttr.needsUpdate = true;
  }

  useFrame((state, delta) => {
    // 深时淡出 + 活跃期整层显隐
    fadeRef.current = THREE.MathUtils.damp(fadeRef.current, deepTimeActive ? 0 : 1, 6, delta);
    const fade = fadeRef.current;
    const activeCount = meteors.active.length;
    const shown = activeCount > 0 && fade > 0.005;
    built.rings.visible = shown;
    built.meteorLines.visible = shown;
    for (let i = 0; i < built.labels.length; i++) {
      const l = built.labels[i]!;
      l.sprite.visible = shown && i < activeCount; // 隐藏即省 draw call
      l.material.opacity = 0.8 * fade;
    }
    if (!shown) return;

    // 低频 uniform：呼吸环时钟 / DPR / 淡出（单值写入，零成本）
    const now = state.clock.elapsedTime;
    built.ringMat.uniforms.uTime!.value = now;
    built.ringMat.uniforms.uFade!.value = fade;
    built.ringMat.uniforms.uPixelRatio!.value = state.gl.getPixelRatio();
    built.meteorMat.uniforms.uNow!.value = now;
    built.meteorMat.uniforms.uFade!.value = fade;

    // ── 泊松 spawn：λ = registry 总生成率 × 降级系数 ──
    const rate = meteors.totalRatePerSec * rateScale;
    if (rate <= 0) return;
    // 生成率变化（version 步进）或首帧 → 重采样倒计时，避免陈旧长间隔
    if (rateVersionRef.current !== meteors.version || spawnCountdownRef.current < 0) {
      rateVersionRef.current = meteors.version;
      spawnCountdownRef.current = -Math.log(1 - Math.random()) / rate;
    }
    spawnCountdownRef.current -= delta;
    let burst = 0;
    while (spawnCountdownRef.current <= 0 && burst < 3) {
      spawnMeteor(now);
      spawnCountdownRef.current += -Math.log(1 - Math.random()) / rate;
      burst++;
    }
    // 长挂后台回来 delta 巨大 → 倒计时残留大负值：夹回 0 附近防补偿爆发
    if (spawnCountdownRef.current < -1) spawnCountdownRef.current = 0;
  });

  return (
    <>
      <primitive object={built.rings} />
      <primitive object={built.meteorLines} />
      {built.labels.map((l, i) => (
        // 数量固定（≤3），index key 安全；显隐走 sprite.visible 不重挂
        // eslint-disable-next-line react/no-array-index-key
        <primitive key={i} object={l.sprite} />
      ))}
    </>
  );
}
