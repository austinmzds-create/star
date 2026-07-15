'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { DeviceTier } from '@/lib/deviceTier';
import { ephem, type EphemBodyState } from '@/lib/ephemRegistry';
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
 * 版本变化才把新坐标写进 sprite.position / 重画月相 canvas——帧内零 React 更新。
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
  disk: THREE.Sprite;
  diskMaterial: THREE.SpriteMaterial;
  /** Bloom 激活时盘面 HDR 超白系数（太阳最强、月亮为 0——暗面不可增亮）。 */
  boostScale: number;
  halo: THREE.Sprite | null;
  label: THREE.Sprite;
  labelMaterial: THREE.SpriteMaterial;
  moonCtx: CanvasRenderingContext2D | null;
  moonTex: THREE.CanvasTexture | null;
  lastPhaseDeg: number;
}

export function PlanetsLayer({ tier }: { tier: DeviceTier }) {
  const showLabels = useUniverse((s) => s.showLabels);
  const versionRef = useRef(-1);
  const recsRef = useRef<BodyRec[]>([]);
  const lastBoostRef = useRef(0);

  // 一次性构建全部 sprite（组内 ≈27 个，纹理 ≈1.5MB），随组件生命周期释放。
  const { group, disposables, sunLight } = useMemo(() => {
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
      if (tier !== 'low' && body.bodyId !== 'moon') {
        const haloMat = new THREE.SpriteMaterial({
          map: haloTex,
          color: new THREE.Color(body.colorHex),
          transparent: true,
          opacity: body.kind === 'sun' ? 0.55 : 0.3,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        disposables.push(haloMat);
        halo = new THREE.Sprite(haloMat);
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
        disk,
        diskMaterial: diskMat,
        // 太阳超白最强（联动 GodRays 观感），行星次之，月亮不加（暗面会假）
        boostScale: body.kind === 'sun' ? 0.9 : body.bodyId === 'moon' ? 0 : 0.6,
        halo,
        label,
        labelMaterial,
        moonCtx,
        moonTex: body.bodyId === 'moon' ? (diskMat.map as THREE.CanvasTexture) : null,
        lastPhaseDeg: body.phaseAngleDeg ?? -1,
      });
    }

    // GodRays 光源盘（Phase 9A，高档专属 +1 draw call，r-fx §2.1.6）：
    // 太阳 sprite 是 canvas 纹理，不能当 GodRays 光源——挂一个小 CircleMesh
    // 注册进 fxBus，PostFX 在太阳屏内时把它接给 <GodRays sun>。HDR 色值 >1
    // 让它同时越过 Bloom 阈值；平时由 fx.sunLight 显隐（无 GodRays 时的
    // 硬边圆盘观感反而是减分项）。depthWrite 不开：GodRays 的光源 pass
    // 内部临时开启，主场景保持「无深度写入」纪律。
    let sunLight: THREE.Mesh | null = null;
    if (tier === 'high') {
      const sunGeo = new THREE.CircleGeometry(22, 32);
      const sunMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(1.6, 1.45, 1.1),
        toneMapped: false,
        depthWrite: false,
      });
      disposables.push(sunGeo, sunMat);
      sunLight = new THREE.Mesh(sunGeo, sunMat);
      sunLight.renderOrder = 7.5; // 压在太阳 sprite（renderOrder 8）之下
      sunLight.frustumCulled = false;
      sunLight.visible = false;
      group.add(sunLight);
    }

    recsRef.current = recs;
    return { group, disposables, sunLight };
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

  // 标签开关（低频 React 状态 → 材质透明度）
  useEffect(() => {
    for (const rec of recsRef.current) {
      rec.labelMaterial.opacity = showLabels ? 0.9 : 0;
    }
  }, [showLabels]);

  useFrame(() => {
    // 星历未成功计算过（version 0）→ 整层隐藏
    group.visible = ephem.version > 0;
    // GodRays 光源盘显隐（PostFX 写 fx.sunLight，布尔直读零成本）
    if (sunLight) sunLight.visible = fx.sunLight > 0;
    // 盘面 HDR 超白联动（r-fx §2.1.3）：Bloom 熔断/恢复才变，值比较拦住帧循环
    const boost = fx.bloomBoost;
    if (boost !== lastBoostRef.current) {
      lastBoostRef.current = boost;
      for (const rec of recsRef.current) {
        rec.diskMaterial.color.setScalar(1 + rec.boostScale * boost);
      }
    }
    if (versionRef.current === ephem.version) return;
    versionRef.current = ephem.version;

    for (const rec of recsRef.current) {
      const body = ephem.bodies.get(rec.uid);
      if (!body) continue;
      rec.disk.position.copy(body.vec);
      rec.halo?.position.copy(body.vec);
      rec.label.position.copy(body.vec);
      // 太阳位置搬运时同步光源盘（lookAt 朝球心，即朝相机；无堆分配）
      if (sunLight && body.kind === 'sun') {
        sunLight.position.copy(body.vec);
        sunLight.lookAt(0, 0, 0);
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
  });

  return <primitive object={group} />;
}
