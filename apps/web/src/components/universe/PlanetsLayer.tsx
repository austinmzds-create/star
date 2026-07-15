'use client';

import { localSiderealTime } from '@star/astro-core';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { DeviceTier } from '@/lib/deviceTier';
import {
  ephem,
  EPHEM_SLERP_WINDOW_MS,
  slerpSphereVec,
  type EphemBodyState,
} from '@/lib/ephemRegistry';
import { fx, setSunLightMesh } from '@/lib/fxBus';
import { useUniverse } from '@/lib/store';

/**
 * 行星日月层（9 体：太阳/月亮/水金火木土天海）。
 *
 * 每体 = 盘面 sprite + 光晕 sprite（低端设备省略）+ 名称 sprite。
 * 名称用 canvas 文本纹理而非 drei Html：Html 每帧做矩阵换算并触发 DOM 样式
 * 写入，是不必要的主线程负担；canvas 文本一次生成常驻 GPU。
 *
 * 【位置更新纪律】不每帧计算：EphemDriver 在 observeTime 变化时整批重算
 * ephemRegistry 并 version++；本层 useFrame 只比较 version（O(1)），
 * 版本变化才更新插值目标 / 重画月相 canvas——帧内零 React 更新。
 *
 * 【播放平滑（Phase 9B §3b）】时间机器播放以 4Hz 写 observeTime，直接搬运
 * 坐标会有台阶跳动（1周/秒 档月亮单步 ~20°）。version 变化时记住「当前
 * 显示位置」为插值起点，useFrame 里对起点→新目标做球面 slerp（因子 =
 * 距 version 变化的墙钟时间 / 250ms），9 次 slerp 零分配，250ms 内收敛后
 * 恢复零逐帧成本。注意：pickRegistry/TargetHighlight 持有的 body.vec 是
 * 插值终点，播放期视觉位置最多滞后一个节流周期（≤250ms），可接受。
 *
 * 【低空大气消光（Phase 9B §3e-4，演示级）】version 搬运时顺带算 9 体地平
 * 高度角（1 次 LST + 9 次纯三角，零分配）：Kasten–Young 大气质量
 * X = 1/(sin h + 0.50572·(h+6.07995°)^−1.6364)，减亮 Δm = 0.25·(X−1) mag
 * （报告公式 Δm=k·X 为绝对消光，此处取相对天顶的 X−1，保持天顶观感不变），
 * 色调按波长指数偏红 tint = (1, e^−0.12(X−1), e^−0.35(X−1))——低空日月
 * 自然变红变暗。X 钳制 ≤8（演示级：真实地平线 X≈38 会让 sprite 全黑）。
 *
 * 【深时淡出（Phase 9B 跨域契约 §3）】deepTimeYears 非 null（恒星自行
 * 时光机开启）时整层渐隐——行星星历在 ±10 万年尺度不可外推；「此尺度
 * 不可外推」的注记由自行时光机域的模式 UI 统一显示。
 *
 * 月相：产品级近似——照亮比例 + 盈亏方向画进 128² canvas（半盘 + 明暗界线
 * 椭圆），仅在 version 变化时重画，不追天文精确。
 */

const TEX_SIZE = 128;

/** 盘面纹理：主色径向渐变圆盘；太阳带十字光芒，土星带扁环。 */
function makeDiskTexture(colorHex: string, kind: EphemBodyState['kind']): THREE.CanvasTexture {
  const size = TEX_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const r = kind === 'sun' ? 30 : 40;

  if (kind === 'sun') {
    // 强光晕
    const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
    glow.addColorStop(0, 'rgba(255,248,225,1)');
    glow.addColorStop(0.28, 'rgba(255,240,200,0.55)');
    glow.addColorStop(0.6, 'rgba(255,230,170,0.14)');
    glow.addColorStop(1, 'rgba(255,225,160,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
    // 十字光芒
    ctx.strokeStyle = 'rgba(255,244,210,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c - 56, c);
    ctx.lineTo(c + 56, c);
    ctx.moveTo(c, c - 56);
    ctx.lineTo(c, c + 56);
    ctx.stroke();
  }

  // 盘面：中心偏白 → 主色 → 透明边缘
  const g = ctx.createRadialGradient(c, c, 0, c, c, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.45, colorHex);
  g.addColorStop(0.92, colorHex);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 土星专属：盘面 + 倾斜扁环。 */
function makeSaturnTexture(colorHex: string): THREE.CanvasTexture {
  const size = TEX_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const r = 30;

  // 环（画在盘面之下，倾斜椭圆）
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate(-0.35);
  ctx.scale(1, 0.32);
  ctx.strokeStyle = 'rgba(233,220,180,0.85)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(0, 0, 52, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(210,196,158,0.4)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, 62, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  const g = ctx.createRadialGradient(c, c, 0, c, c, r);
  g.addColorStop(0, '#fff8e8');
  g.addColorStop(0.5, colorHex);
  g.addColorStop(0.95, colorHex);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 共享光晕纹理（各体 tint 主色）。 */
function makeHaloTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.22)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.05)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 名称文本纹理（中文常显标签）。 */
function makeLabelTexture(text: string): { tex: THREE.CanvasTexture; aspect: number } {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 72;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '600 34px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(120,140,255,0.9)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.fillText(text, 128, 38);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: 256 / 72 };
}

/**
 * 月相绘制（产品级近似）：
 * 暗盘打底 → 盈亏方向的半个亮盘 → 明暗界线用椭圆（rx = r·|cos 相位角|）修正。
 * 相位角 0 新月 / 90 上弦 / 180 满月 / 270 下弦；<180 视为盈（右侧亮）。
 */
function drawMoonPhase(ctx: CanvasRenderingContext2D, phaseAngleDeg: number): void {
  const size = TEX_SIZE;
  const c = size / 2;
  const r = 40;
  const a = ((phaseAngleDeg % 360) + 360) % 360;
  const rad = (a * Math.PI) / 180;
  const waxing = a <= 180;
  const lit = (1 - Math.cos(rad)) / 2; // 照亮比例 0–1

  ctx.clearRect(0, 0, size, size);

  // 外缘极淡光晕
  const glow = ctx.createRadialGradient(c, c, r * 0.7, c, c, r * 1.5);
  glow.addColorStop(0, 'rgba(220,224,240,0.18)');
  glow.addColorStop(1, 'rgba(220,224,240,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // 暗面打底
  ctx.fillStyle = 'rgba(52,57,76,0.92)';
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();

  const light = '#e8e9f0';
  // 亮的半圆：盈 → 右半，亏 → 左半
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.arc(c, c, r, -Math.PI / 2, Math.PI / 2, !waxing);
  ctx.closePath();
  ctx.fill();

  // 明暗界线椭圆：lit>0.5 用亮色外扩，lit<0.5 用暗色内收
  const rx = r * Math.abs(Math.cos(rad));
  ctx.fillStyle = lit >= 0.5 ? light : 'rgba(52,57,76,0.92)';
  ctx.beginPath();
  ctx.ellipse(c, c, Math.max(rx, 0.01), r, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** 世界单位尺寸（相机在中心、天球 1000，FOV60 下 ≈1 单位 ≈1px）。 */
function diskWorldSize(body: EphemBodyState): number {
  if (body.kind === 'sun') return 90;
  if (body.kind === 'moon') return 64;
  return body.displaySize * 1.3;
}

interface BodyRec {
  uid: string;
  /** ephemRegistry 状态槽的固定引用（Map 条目稳定，缓存后帧内零查表）。 */
  body: EphemBodyState;
  disk: THREE.Sprite;
  diskMaterial: THREE.SpriteMaterial;
  /** Bloom 激活时盘面 HDR 超白系数（太阳最强、月亮为 0——暗面不可增亮）。 */
  boostScale: number;
  halo: THREE.Sprite | null;
  haloMaterial: THREE.SpriteMaterial | null;
  /** 光晕原始主色（消光 tint 的乘算基准，勿原地改）。 */
  haloBaseColor: THREE.Color;
  haloBaseOpacity: number;
  label: THREE.Sprite;
  labelMaterial: THREE.SpriteMaterial;
  /** 标签开关决定的基础透明度（deepTime fade 再乘其上）。 */
  labelBaseOpacity: number;
  moonCtx: CanvasRenderingContext2D | null;
  moonTex: THREE.CanvasTexture | null;
  lastPhaseDeg: number;
  /** 播放平滑：上一 version 时的「显示位置」（插值起点，预分配）。 */
  prevVec: THREE.Vector3;
  /** 低空消光当前值（version 搬运时更新；dim = 10^(−0.4Δm)）。 */
  extDim: number;
  extG: number;
  extB: number;
}

/** Kasten–Young 大气质量钳制上限（演示级：X=8 → Δm≈1.75、已明显红暗）。 */
const AIRMASS_CLAMP = 8;
/** 消光系数 k（mag/airmass，报告 §3e-4 取 0.25）。 */
const EXTINCTION_K = 0.25;

const DEG2RAD = Math.PI / 180;
/** 消光计算 scratch（version 变化时使用；零分配纪律）。 */
const extScratchDate = new Date(0);

export function PlanetsLayer({ tier }: { tier: DeviceTier }) {
  const showLabels = useUniverse((s) => s.showLabels);
  // 跨域契约 §3：deepTimeYears 归「地平锁定」域写入，本层只读判 null
  const deepTimeActive = useUniverse((s) => s.deepTimeYears !== null);
  const versionRef = useRef(-1);
  const recsRef = useRef<BodyRec[]>([]);
  const lastBoostRef = useRef(0);
  /** 播放平滑：最近一次 version 变化的墙钟时刻（ms）。 */
  const versionWallMsRef = useRef(0);
  /** 插值是否仍在进行（收敛后 useFrame 提前短路，恢复零逐帧成本）。 */
  const smoothingRef = useRef(false);
  /** 深时淡出系数（1 → 0 渐隐；MinorBodiesLayer 同节奏）。 */
  const fadeRef = useRef(1);
  const lastFadeAppliedRef = useRef(1);
  /** 城市变化也要刷新消光（version 不一定变），记 id 做低频比较。 */
  const lastCityIdRef = useRef('');

  // 一次性构建全部 sprite（组内 ≈27 个，纹理 ≈1.5MB），随组件生命周期释放。
  const { group, disposables, sunLight, sunLightMat } = useMemo(() => {
    const group = new THREE.Group();
    const disposables: Array<{ dispose(): void }> = [];
    const haloTex = makeHaloTexture();
    disposables.push(haloTex);
    const recs: BodyRec[] = [];

    for (const body of ephem.bodies.values()) {
      const size = diskWorldSize(body);

      // 盘面
      let diskTex: THREE.CanvasTexture;
      let moonCtx: CanvasRenderingContext2D | null = null;
      if (body.bodyId === 'moon') {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = TEX_SIZE;
        moonCtx = canvas.getContext('2d')!;
        drawMoonPhase(moonCtx, body.phaseAngleDeg ?? 180);
        diskTex = new THREE.CanvasTexture(canvas);
        diskTex.colorSpace = THREE.SRGBColorSpace;
      } else if (body.bodyId === 'saturn') {
        diskTex = makeSaturnTexture(body.colorHex);
      } else {
        diskTex = makeDiskTexture(body.colorHex, body.kind);
      }
      disposables.push(diskTex);

      const diskMat = new THREE.SpriteMaterial({
        map: diskTex,
        transparent: true,
        depthWrite: false,
        // Phase 9A 选择性泛光（r-fx §2.1.3）：材质级 tonemap 关掉——tonemapping
        // 统一由 PostFX 的 ToneMapping 效果做，盘面 color 抬 >1 的 HDR 超白
        // 才能原样进 Bloom 阈值判定（boost 值见 useFrame 内 fx.bloomBoost 联动）
        toneMapped: false,
        // 月亮有暗面，用普通混合保证暗面可见；其余发光体用叠加
        blending: body.bodyId === 'moon' ? THREE.NormalBlending : THREE.AdditiveBlending,
      });
      disposables.push(diskMat);
      const disk = new THREE.Sprite(diskMat);
      disk.scale.set(size, size, 1);
      disk.renderOrder = 8;
      group.add(disk);

      // 光晕（低端设备省略；月亮暗面观感靠盘面自带光晕即可）
      let halo: THREE.Sprite | null = null;
      let haloMaterial: THREE.SpriteMaterial | null = null;
      const haloBaseOpacity = body.kind === 'sun' ? 0.55 : 0.3;
      if (tier !== 'low' && body.bodyId !== 'moon') {
        const haloMat = new THREE.SpriteMaterial({
          map: haloTex,
          color: new THREE.Color(body.colorHex),
          transparent: true,
          opacity: haloBaseOpacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        disposables.push(haloMat);
        halo = new THREE.Sprite(haloMat);
        haloMaterial = haloMat;
        const hs = body.kind === 'sun' ? size * 2.8 : size * 2.2;
        halo.scale.set(hs, hs, 1);
        halo.renderOrder = 8;
        group.add(halo);
      }

      // 名称标签（canvas 文本，常驻 GPU；受「名称标签」总开关控制透明度）
      const { tex: labelTex, aspect } = makeLabelTexture(body.nameZh);
      disposables.push(labelTex);
      const labelMaterial = new THREE.SpriteMaterial({
        map: labelTex,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      });
      disposables.push(labelMaterial);
      const label = new THREE.Sprite(labelMaterial);
      const labelH = 15;
      label.scale.set(labelH * aspect, labelH, 1);
      // 锚点上移 → 标签渲染在天体下方
      label.center.set(0.5, 0.5 + (size * 0.65) / labelH + 0.5);
      label.renderOrder = 8;
      group.add(label);

      recs.push({
        uid: body.uid,
        body,
        disk,
        diskMaterial: diskMat,
        // 太阳超白最强（联动 GodRays 观感），行星次之，月亮不加（暗面会假）
        boostScale: body.kind === 'sun' ? 0.9 : body.bodyId === 'moon' ? 0 : 0.6,
        halo,
        haloMaterial,
        haloBaseColor: new THREE.Color(body.colorHex),
        haloBaseOpacity,
        label,
        labelMaterial,
        labelBaseOpacity: 0.9,
        moonCtx,
        moonTex: body.bodyId === 'moon' ? (diskMat.map as THREE.CanvasTexture) : null,
        lastPhaseDeg: body.phaseAngleDeg ?? -1,
        prevVec: new THREE.Vector3(),
        extDim: 1,
        extG: 1,
        extB: 1,
      });
    }

    // GodRays 光源盘（Phase 9A，高档专属 +1 draw call，r-fx §2.1.6）：
    // 太阳 sprite 是 canvas 纹理，不能当 GodRays 光源——挂一个小 CircleMesh
    // 注册进 fxBus，PostFX 在太阳屏内时把它接给 <GodRays sun>。HDR 色值 >1
    // 让它同时越过 Bloom 阈值；平时由 fx.sunLight 显隐（无 GodRays 时的
    // 硬边圆盘观感反而是减分项）。depthWrite 不开：GodRays 的光源 pass
    // 内部临时开启，主场景保持「无深度写入」纪律。
    let sunLight: THREE.Mesh | null = null;
    let sunLightMat: THREE.MeshBasicMaterial | null = null;
    if (tier === 'high') {
      const sunGeo = new THREE.CircleGeometry(22, 32);
      const sunMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(1.6, 1.45, 1.1),
        toneMapped: false,
        depthWrite: false,
      });
      disposables.push(sunGeo, sunMat);
      sunLight = new THREE.Mesh(sunGeo, sunMat);
      sunLightMat = sunMat;
      sunLight.renderOrder = 7.5; // 压在太阳 sprite（renderOrder 8）之下
      sunLight.frustumCulled = false;
      sunLight.visible = false;
      group.add(sunLight);
    }

    recsRef.current = recs;
    return { group, disposables, sunLight, sunLightMat };
    // tier 变化由父层以 key 重挂（异步 GPU 微调一次），本体不热更
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      for (const d of disposables) d.dispose();
    };
  }, [disposables]);

  // GodRays 光源注册（跨组件走模块注册表，PostFX 订阅；卸载即注销）
  useEffect(() => {
    if (!sunLight) return;
    setSunLightMesh(sunLight);
    return () => setSunLightMesh(null);
  }, [sunLight]);

  // 标签开关（低频 React 状态 → 材质透明度；deepTime fade 乘在基础值上）
  useEffect(() => {
    for (const rec of recsRef.current) {
      rec.labelBaseOpacity = showLabels ? 0.9 : 0;
      rec.labelMaterial.opacity = rec.labelBaseOpacity * fadeRef.current;
    }
  }, [showLabels]);

  /** 盘面颜色 = HDR 超白基数 × 消光偏红 tint（boost 变化与 version 变化共用）。 */
  function applyDiskColor(rec: BodyRec, boost: number): void {
    const base = 1 + rec.boostScale * boost;
    rec.diskMaterial.color.setRGB(base, base * rec.extG, base * rec.extB);
    if (rec.haloMaterial) {
      const c = rec.haloBaseColor;
      rec.haloMaterial.color.setRGB(c.r, c.g * rec.extG, c.b * rec.extB);
    }
  }

  /** 透明度 = 消光减亮 × 深时淡出（fade/version 变化时统一走这里）。 */
  function applyOpacity(rec: BodyRec, fade: number): void {
    rec.diskMaterial.opacity = rec.extDim * fade;
    if (rec.haloMaterial) rec.haloMaterial.opacity = rec.haloBaseOpacity * rec.extDim * fade;
    rec.labelMaterial.opacity = rec.labelBaseOpacity * fade;
  }

  useFrame((state, delta) => {
    // 深时淡出（跨域契约 §3）：恒星自行时光机开启时整层渐隐（λ=6 ≈0.5s 到位），
    // 到位后 visible=false 彻底移出渲染队列
    fadeRef.current = THREE.MathUtils.damp(fadeRef.current, deepTimeActive ? 0 : 1, 6, delta);
    const fade = fadeRef.current;
    // 星历未成功计算过（version 0）→ 整层隐藏
    group.visible = ephem.version > 0 && fade > 0.005;
    // GodRays 光源盘显隐（PostFX 写 fx.sunLight，布尔直读零成本；深时淡出时同灭）
    if (sunLight) sunLight.visible = fx.sunLight > 0 && fade > 0.005;
    // 盘面 HDR 超白联动（r-fx §2.1.3）：Bloom 熔断/恢复才变，值比较拦住帧循环
    const boost = fx.bloomBoost;
    if (boost !== lastBoostRef.current) {
      lastBoostRef.current = boost;
      for (const rec of recsRef.current) applyDiskColor(rec, boost);
    }
    // fade 动画期才写材质透明度（收敛后 |Δ|<1e-3 直接跳过，恢复零逐帧写）
    if (Math.abs(fade - lastFadeAppliedRef.current) > 1e-3) {
      lastFadeAppliedRef.current = fade;
      for (const rec of recsRef.current) applyOpacity(rec, fade);
    }

    // ── 播放平滑（§3b）：version 未变时若插值未收敛，继续 slerp ──
    // 城市切换（version 不一定变）也要立刻刷新消光：并入 versionChanged 分支
    //（getState 只读引用不订阅，帧内零 React；字符串比较 O(1)）
    const s = useUniverse.getState();
    const nowWall = performance.now();
    const versionChanged =
      versionRef.current !== ephem.version || s.city.id !== lastCityIdRef.current;
    if (versionChanged) {
      versionRef.current = ephem.version;
      versionWallMsRef.current = nowWall;
      smoothingRef.current = true;
    }
    if (!versionChanged && !smoothingRef.current) return;

    if (versionChanged) {
      // 消光更新（低频，≤4Hz）：1 次 LST + 9 次纯三角，零分配
      extScratchDate.setTime(ephem.computedAtMs || Date.now());
      const lstDeg = localSiderealTime(extScratchDate, s.city.longitudeDeg);
      const latRad = s.city.latitudeDeg * DEG2RAD;
      const sinLat = Math.sin(latRad);
      const cosLat = Math.cos(latRad);
      lastCityIdRef.current = s.city.id;
      for (const rec of recsRef.current) {
        const body = rec.body;
        // 插值起点 = 当前显示位置（播放中途 version 到达也无跳变续接）；
        // 首次搬运（显示位置还是原点占位）直接 snap 到目标
        rec.prevVec.copy(rec.disk.position);
        if (rec.prevVec.lengthSq() < 1) rec.prevVec.copy(body.vec);

        // —— 低空大气消光（§3e-4，演示级声明见文件头）——
        const hRad = (lstDeg - body.raDeg) * DEG2RAD;
        const decRad = body.decDeg * DEG2RAD;
        const sinAlt = sinLat * Math.sin(decRad) + cosLat * Math.cos(decRad) * Math.cos(hRad);
        const altDeg = Math.asin(Math.max(-1, Math.min(1, sinAlt))) / DEG2RAD;
        // Kasten–Young 公式定义域到 h≈−6°；地平线下取 h=0 的极值即可
        const h = Math.max(altDeg, 0);
        const x = Math.min(
          1 / (Math.sin(h * DEG2RAD) + 0.50572 * Math.pow(h + 6.07995, -1.6364)),
          AIRMASS_CLAMP,
        );
        const xr = x - 1; // 相对天顶
        rec.extDim = Math.pow(10, -0.4 * EXTINCTION_K * xr);
        rec.extG = Math.exp(-0.12 * xr);
        rec.extB = Math.exp(-0.35 * xr);
        applyDiskColor(rec, boost);
        applyOpacity(rec, fade);

        // GodRays 光源盘同步偏红（高档专属；基色 1.6/1.45/1.1 乘 tint）
        if (sunLightMat && body.kind === 'sun') {
          sunLightMat.color.setRGB(1.6, 1.45 * rec.extG, 1.1 * rec.extB);
        }

        // 月相变化才重画（低频：observeTime 变化时）
        if (rec.moonCtx && rec.moonTex && body.phaseAngleDeg !== undefined) {
          if (Math.abs(body.phaseAngleDeg - rec.lastPhaseDeg) > 0.05) {
            drawMoonPhase(rec.moonCtx, body.phaseAngleDeg);
            rec.moonTex.needsUpdate = true;
            rec.lastPhaseDeg = body.phaseAngleDeg;
          }
        }
      }
    }

    // 逐帧插值：t ∈ [0,1]，收敛后置 smoothing=false 恢复零逐帧成本
    const t = (nowWall - versionWallMsRef.current) / EPHEM_SLERP_WINDOW_MS;
    const k = t >= 1 ? 1 : t;
    for (const rec of recsRef.current) {
      slerpSphereVec(rec.prevVec, rec.body.vec, k, rec.disk.position);
      rec.halo?.position.copy(rec.disk.position);
      rec.label.position.copy(rec.disk.position);
      // 太阳位置同步光源盘（lookAt 朝球心，即朝相机；无堆分配）
      if (sunLight && rec.body.kind === 'sun') {
        sunLight.position.copy(rec.disk.position);
        sunLight.lookAt(0, 0, 0);
      }
    }
    if (t >= 1) smoothingRef.current = false;
  });

  return <primitive object={group} />;
}
