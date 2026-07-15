'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { CONSTELLATION_ART_BY_CON } from '@/lib/constellation-art';
import {
  activateThresholdDeg,
  applyConstellationDeepTime,
  FADE_OUT_SEC,
  GAZE_HYSTERESIS_DEG,
  getConstellationRenderData,
  REDUCED_MOTION_DUR_SEC,
} from '@/lib/constellation-render';
import { isCoarsePointer, prefersReducedMotion } from '@/lib/device';
import type { DeviceTier } from '@/lib/deviceTier';
import { setConstellationFocusDim } from '@/lib/fxBus';
import { worldToSkyLocal } from '@/lib/skyFrame';
import { useUniverse } from '@/lib/store';
import { ConstellationArtPlane } from './ConstellationArt';
import { ConstellationLines } from './ConstellationLines';
import { ConstellationMemberGlow } from './ConstellationMemberGlow';
import { ConstellationName } from './ConstellationNames';

/**
 * 星座层总控（Star Walk 式）：
 * - 注视判定（88 次点积，150ms 节流 + 250ms 驻留确认 + 3° 滞回）；
 * - 每帧把各座点亮进度 progress[i] 推向目标（激活=1 / 其余=0），
 *   进度数组在 ref 内原地更新，不进 React state；
 * - 连线（1 draw call）+ 中文名 Sprite（≤2）+ 艺术图切平面（桌面 ≤2 / 移动 ≤1）。
 * showConstellations=false 时整层不挂载，几何/纹理随卸载释放。
 */

export function ConstellationLayer({ tier }: { tier: DeviceTier }) {
  const show = useUniverse((s) => s.showConstellations);
  if (!show) return null;
  return <ConstellationLayerInner tier={tier} />;
}

function ConstellationLayerInner({ tier }: { tier: DeviceTier }) {
  const camera = useThree((s) => s.camera);
  const data = useMemo(() => getConstellationRenderData(), []);
  const coarse = useMemo(() => isCoarsePointer(), []);
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);

  // 各座点亮进度（0..1）：ref 内原地推进，shader/子组件按帧读取。
  const progressRef = useRef<Float32Array>(new Float32Array(data.cons.length));

  // ── 聚焦聚光灯（§3）：非激活座压暗系数（1↔0.45，damp λ5）+ 激活座索引 ──
  // focusDim 每帧写 fxBus（TwinkleStars/ExtendedStars/MilkyWay 读 getGlobalFade
  // 自动吃到全局压暗）与 ConstellationLines uFocusDim（同一 ref）。
  const focusDimRef = useRef(1);
  const activeIndexRef = useRef(-1);
  const lastFocusDimRef = useRef(1);
  // 卸载（隐藏星座层）时必须复位全局压暗，否则恒星/银河永远暗着。
  useEffect(() => () => setConstellationFocusDim(1), []);

  // 「进度 > 0 的座」列表（低频 React state：仅集合/排序变化时 set，动画帧内零更新）。
  const [visibleAbbrs, setVisibleAbbrs] = useState<string[]>([]);
  // 变更检测缓冲（GC 纪律：帧内禁新数组/字符串）：预分配定长索引数组，
  // 每帧把「进度降序的可见座索引」写进 curVisIdx，与上帧 prevVisIdx 逐元素比较——
  // 等价于旧版 join(',') 字符串键（abbr↔index 双射且同为顺序敏感），但零分配。
  // 不用纯位掩码：移动端艺术图只取 top-1，两座进度交叉（集合不变、排序变）也必须触发更新。
  const curVisIdx = useRef(new Int32Array(data.cons.length));
  const prevVisIdx = useRef(new Int32Array(data.cons.length));
  const prevVisCount = useRef(0);

  // ── 注视判定内部状态（全部 ref，不触 React） ──
  const gazeAccum = useRef(0);
  const pendingAbbr = useRef<string | null>(null);
  const pendingSec = useRef(0);
  const tmpDir = useRef(new THREE.Vector3());

  // ── 深时同步（9B 星座时光机）：deepTimeYears 变化 → 100ms 节流 CPU 重算
  // 88 座连线端点 + 成员光环点位（≈2100 顶点 <0.5ms，与 TwinkleStars shader
  // 同公式保证线星贴合）。zustand 命令式订阅，滑条拖动不触发本组件重渲染；
  // 上传由 ConstellationLines/MemberGlow 在 useFrame 比对版本号后置 needsUpdate。
  useEffect(() => {
    const THROTTLE_MS = 100;
    let timer: number | null = null;
    let lastRun = -Infinity;
    const run = (): void => {
      lastRun = performance.now();
      applyConstellationDeepTime(useUniverse.getState().deepTimeYears ?? 0);
    };
    const schedule = (): void => {
      const wait = THROTTLE_MS - (performance.now() - lastRun);
      if (wait <= 0) run(); // 前沿立即执行：单次拨动（预设跳转）零延迟
      else if (timer == null) {
        timer = window.setTimeout(() => {
          timer = null;
          run(); // 尾沿执行读 getState 现值——连续拖动收敛到最新
        }, wait);
      }
    };
    // 挂载对齐：本层可能在时光机开启期间才挂载（showConstellations 重开），
    // applyConstellationDeepTime 内部同值幂等，常态（0→0）零成本。
    schedule();
    const unsub = useUniverse.subscribe((s, prev) => {
      if (s.deepTimeYears !== prev.deepTimeYears) schedule();
    });
    return () => {
      unsub();
      if (timer != null) window.clearTimeout(timer);
    };
  }, []);

  useFrame((_, delta) => {
    const state = useUniverse.getState();
    const active = state.activeConstellation;
    const progress = progressRef.current;

    // ── 0. 聚焦聚光灯：有激活座 → 全局压暗其余天空（damp λ5 ≈0.4s） ──
    const activeInfo = active ? data.byAbbr.get(active) : undefined;
    activeIndexRef.current = activeInfo ? activeInfo.index : -1;
    const dimTarget = activeInfo ? 0.45 : 1;
    const dim = THREE.MathUtils.damp(focusDimRef.current, dimTarget, 5, delta);
    focusDimRef.current = dim;
    // 收敛后停写（|Δ|<1e-3 恢复零成本；写 fxBus 供恒星/银河层读）
    if (Math.abs(dim - lastFocusDimRef.current) > 1e-4) {
      lastFocusDimRef.current = dim;
      setConstellationFocusDim(dim);
    }

    // ── 1. 进度推进：激活座升向 1（历时 = 依次点亮总时长），其余以 0.4s 匀速回落 ──
    for (let i = 0; i < data.cons.length; i++) {
      const info = data.cons[i]!;
      const target = info.abbr === active ? 1 : 0;
      const p = progress[i]!;
      if (p === target) continue;
      const dur = reducedMotion
        ? REDUCED_MOTION_DUR_SEC
        : target > p
          ? info.riseDurSec
          : FADE_OUT_SEC;
      const step = delta / Math.max(dur, 1e-3);
      progress[i] = target > p ? Math.min(p + step, 1) : Math.max(p - step, 0);
    }

    // ── 2. 注视判定（节流：桌面 150ms / 移动 250ms） ──
    gazeAccum.current += delta;
    const interval = coarse ? 0.25 : 0.15;
    if (gazeAccum.current >= interval) {
      const elapsed = gazeAccum.current;
      gazeAccum.current = 0;

      // 相机在原点，视线方向即天球注视点单位向量。
      // 地平锁定（9B，只读 skyFrame）：本层挂在天旋 group 下，质心是天球
      // 本地系向量——把世界系视线反旋回本地系再比对（free 模式恒等）。
      camera.getWorldDirection(tmpDir.current);
      worldToSkyLocal(tmpDir.current, tmpDir.current);
      let best: string | null = null;
      let bestAngle = Infinity;
      for (const info of data.cons) {
        const angle = THREE.MathUtils.radToDeg(
          Math.acos(THREE.MathUtils.clamp(tmpDir.current.dot(info.centroid), -1, 1)),
        );
        // 滞回：当前已激活座的失活阈值放宽 3°，防边界抖动。
        const threshold =
          activateThresholdDeg(info.radiusDeg) + (info.abbr === active ? GAZE_HYSTERESIS_DEG : 0);
        if (angle < threshold && angle < bestAngle) {
          bestAngle = angle;
          best = info.abbr;
        }
      }

      // 驻留确认：同一候选连续 ≥250ms 才激活；无候选连续 ≥400ms 才清空。
      if (best === pendingAbbr.current) {
        pendingSec.current += elapsed;
      } else {
        pendingAbbr.current = best;
        pendingSec.current = 0;
      }
      if (best !== active) {
        if (best !== null && pendingSec.current >= 0.25) state.setGazeConstellation(best);
        if (best === null && pendingSec.current >= 0.4) state.setGazeConstellation(null);
      }
    }

    // ── 3. 可见座列表维护（集合/排序变化才 setState；实际同时 ≤2：新亮 + 旧淡出）──
    // 默认路径（无激活座 / 单座稳定点亮）逐帧零分配；仅变化那一帧才构建字符串数组。
    const cur = curVisIdx.current;
    let visCount = 0;
    for (let i = 0; i < data.cons.length; i++) {
      if ((progress[i] ?? 0) > 0.005) cur[visCount++] = i;
    }
    // 按进度降序原地插入排序（可见座个位数，稳定、零分配；等值保持索引序，同旧版稳定 sort）。
    for (let i = 1; i < visCount; i++) {
      const idx = cur[i]!;
      const p = progress[idx] ?? 0;
      let j = i - 1;
      while (j >= 0 && (progress[cur[j]!] ?? 0) < p) {
        cur[j + 1] = cur[j]!;
        j--;
      }
      cur[j + 1] = idx;
    }
    // 顺序敏感比较：数量或任一位次不同才重建列表。
    const prev = prevVisIdx.current;
    let changed = visCount !== prevVisCount.current;
    for (let i = 0; !changed && i < visCount; i++) {
      if (cur[i] !== prev[i]) changed = true;
    }
    if (changed) {
      prevVisCount.current = visCount;
      const nowVisible: string[] = [];
      for (let i = 0; i < visCount; i++) {
        prev[i] = cur[i]!;
        nowVisible.push(data.cons[cur[i]!]!.abbr);
      }
      setVisibleAbbrs(nowVisible);
    }
  });

  // 名称/成员星光环最多 2 个（新亮 + 旧淡出）；艺术图桌面 ≤2、移动 ≤1（旧图直接消失不交叉淡）。
  const nameAbbrs = visibleAbbrs.slice(0, 2);
  const artAbbrs = visibleAbbrs.filter((a) => CONSTELLATION_ART_BY_CON.has(a)).slice(0, coarse ? 1 : 2);

  return (
    <>
      <ConstellationLines
        key={`lines-${tier}`}
        data={data}
        progressRef={progressRef}
        reducedMotion={reducedMotion}
        tier={tier}
        focusDimRef={focusDimRef}
        activeIndexRef={activeIndexRef}
      />
      {nameAbbrs.map((abbr) => {
        const info = data.byAbbr.get(abbr);
        return info ? (
          <ConstellationMemberGlow
            key={`${abbr}-${tier}`}
            info={info}
            progressRef={progressRef}
            reducedMotion={reducedMotion}
            tier={tier}
          />
        ) : null;
      })}
      {nameAbbrs.map((abbr) => {
        const info = data.byAbbr.get(abbr);
        return info ? <ConstellationName key={abbr} info={info} progressRef={progressRef} /> : null;
      })}
      {artAbbrs.map((abbr) => {
        const info = data.byAbbr.get(abbr);
        const meta = CONSTELLATION_ART_BY_CON.get(abbr);
        return info && meta ? (
          <ConstellationArtPlane
            key={abbr}
            info={info}
            meta={meta}
            progressRef={progressRef}
            coarse={coarse}
            reducedMotion={reducedMotion}
          />
        ) : null;
      })}
    </>
  );
}
