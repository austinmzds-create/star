/**
 * 卫星状态注册表（模块级单例，镜像 ephemRegistry 模式）。
 *
 * 本文件 import satellite.js —— 仅由 SatellitesLayer（React.lazy）与信息卡的
 * 动态 import 引用，只进懒 chunk，绝不进首屏 bundle。
 *
 * 【与行星的关键差异】
 * 1. 逐帧计算：LEO 卫星角速度 ~1°/s，必须每帧 propagate（3 体 <0.3ms）；
 *    对相同 dateMs 去重直接 return（防多消费方重复算）。
 * 2. 站心（topocentric）坐标：卫星距地面仅 ~400km，地心视差近地平时可差
 *    几十度——这是全站唯一不能用地心坐标的天体类别。观测者 ECF→ECI 后
 *    与卫星 ECI（TEME）相减取站心矢量，再化 RA/Dec。
 * 3. 参考系：TEME ≈ 真春分点 of-date；与全站 J2000 星表差 = 岁差累计
 *    （2026 年 ≈0.36°）+ 章动（≲0.005°）。不做岁差旋转，统一走
 *    「人造卫星 · 演示精度」声明。
 *
 * 每颗卫星的 vec 是【固定引用、原地 mutate】的 THREE.Vector3：
 * pickRegistry 动态条目持同一引用，TargetHighlight 每帧 copy 自动追星。
 */

import { raDecToVector3 } from '@star/astro-core';
import {
  eciToGeodetic,
  geodeticToEcf,
  gstime,
  propagate,
  twoline2satrec,
  type SatRec,
} from 'satellite.js';
import * as THREE from 'three';
import type { City } from '../cities';
import { SPHERE_RADIUS } from '../universe';
import { parseTleEpoch, SATELLITE_DEFS, tleChecksumOk } from './tles';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** 单颗卫星的当前状态（坐标为最近一次 recomputeSatellites 时刻的站心值）。 */
export interface SatState {
  uid: string;
  nameZh: string;
  colorHex: string;
  /** 站心 RA/Dec（TEME ≈ of-date，演示精度）。 */
  raDeg: number;
  decDeg: number;
  /** 站心距离（km）。 */
  rangeKm: number;
  /** 轨道高度（km，eciToGeodetic）。 */
  heightKm: number;
  /** ECI 速度模长（km/s）。 */
  speedKmS: number;
  /** TLE 历元（当前生效的 satrec 对应；运行时刷新后更新）。 */
  tleEpoch: Date | null;
  /** 本帧 SGP4 是否有效（TLE 过期衰变/发散时 false，整点隐藏）。 */
  valid: boolean;
  /** 天球世界坐标——固定引用、原地 mutate，勿替换实例。 */
  vec: THREE.Vector3;
}

interface SatRegistry {
  /** 每次 recomputeSatellites 自增。 */
  version: number;
  /** 最近一次计算的时刻（epoch ms）；0 表示尚未计算。 */
  computedAtMs: number;
  states: Map<string, SatState>;
}

interface SatRecSlot {
  uid: string;
  satrec: SatRec | null;
}

/** localStorage 缓存键前缀（Celestrak 刷新结果，24h 内直接复用跳过网络）。 */
const TLE_CACHE_PREFIX = 'star:tle:';
const TLE_CACHE_TTL_MS = 24 * 3600 * 1000;

function createStates(): Map<string, SatState> {
  const map = new Map<string, SatState>();
  for (const def of SATELLITE_DEFS) {
    map.set(def.uid, {
      uid: def.uid,
      nameZh: def.nameZh,
      colorHex: def.colorHex,
      raDeg: 0,
      decDeg: 0,
      rangeKm: 0,
      heightKm: 0,
      speedKmS: 0,
      tleEpoch: parseTleEpoch(def.tle[0]),
      valid: false,
      vec: new THREE.Vector3(),
    });
  }
  return map;
}

export const sats: SatRegistry = { version: 0, computedAtMs: 0, states: createStates() };

/** 校验 TLE 两行（长度/行号/校验和/twoline2satrec 可解析）；通过返回 satrec，否则 null。 */
function validateTle(line1: string, line2: string): SatRec | null {
  if (line1.length !== 69 || line2.length !== 69) return null;
  if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) return null;
  if (!tleChecksumOk(line1) || !tleChecksumOk(line2)) return null;
  try {
    const rec = twoline2satrec(line1, line2);
    return rec.error === 0 ? rec : null;
  } catch {
    return null;
  }
}

/** 惰性构建 satrec：优先 localStorage 缓存（24h 内），否则内置快照。 */
function buildSatrecs(): Map<string, SatRecSlot> {
  const map = new Map<string, SatRecSlot>();
  for (const def of SATELLITE_DEFS) {
    let satrec: SatRec | null = null;
    try {
      const raw = localStorage.getItem(TLE_CACHE_PREFIX + def.noradId);
      if (raw) {
        const cached = JSON.parse(raw) as { fetchedAt?: number; lines?: [string, string] };
        if (
          cached.lines &&
          typeof cached.fetchedAt === 'number' &&
          Date.now() - cached.fetchedAt < TLE_CACHE_TTL_MS
        ) {
          satrec = validateTle(cached.lines[0], cached.lines[1]);
          if (satrec) {
            const st = sats.states.get(def.uid);
            if (st) st.tleEpoch = parseTleEpoch(cached.lines[0]);
          }
        }
      }
    } catch {
      // localStorage 不可用/解析失败 → 静默走快照
    }
    if (!satrec) satrec = validateTle(def.tle[0], def.tle[1]);
    map.set(def.uid, { uid: def.uid, satrec });
  }
  return map;
}

let satrecs: Map<string, SatRecSlot> | null = null;
/** 上次计算的城市 id：时间暂停时切换城市也必须重算（站心矢量对观测点敏感）。 */
let lastCityId: string | null = null;

/**
 * 模块级单例 Date（GC 纪律：recomputeSatellites 每帧调用，帧内禁 new Date）。
 * setTime 后传入 gstime/propagate——两者只读取时刻、不持引用，复用安全。
 */
const scratchDate = new Date(0);

/**
 * 整批重算 3 颗卫星的站心 RA/Dec（每帧可调，内部对「相同 dateMs + 相同城市」去重）。
 */
export function recomputeSatellites(dateMs: number, city: City): void {
  if (dateMs === sats.computedAtMs && city.id === lastCityId) return;
  lastCityId = city.id;
  if (!satrecs) satrecs = buildSatrecs();

  scratchDate.setTime(dateMs);
  const gmst = gstime(scratchDate);

  // 观测者（城市，海拔取 0）→ ECF → ECI（绕 z 轴转 +gmst，即 eciToEcf 的逆旋转）
  const gd = {
    latitude: city.latitudeDeg * DEG2RAD,
    longitude: city.longitudeDeg * DEG2RAD,
    height: 0,
  };
  const oEcf = geodeticToEcf(gd);
  const cosG = Math.cos(gmst);
  const sinG = Math.sin(gmst);
  const ox = oEcf.x * cosG - oEcf.y * sinG;
  const oy = oEcf.x * sinG + oEcf.y * cosG;
  const oz = oEcf.z;

  for (const slot of satrecs.values()) {
    const state = sats.states.get(slot.uid);
    if (!state) continue;
    let ok = false;
    if (slot.satrec && slot.satrec.error === 0) {
      try {
        const pv = propagate(slot.satrec, scratchDate);
        const pos = pv?.position;
        if (pv && pos && typeof pos !== 'boolean' && slot.satrec.error === 0) {
          // 站心矢量（TEME）→ RA/Dec
          const dx = pos.x - ox;
          const dy = pos.y - oy;
          const dz = pos.z - oz;
          const range = Math.hypot(dx, dy, dz);
          state.raDeg = ((Math.atan2(dy, dx) * RAD2DEG) % 360 + 360) % 360;
          state.decDeg = Math.asin(Math.max(-1, Math.min(1, dz / range))) * RAD2DEG;
          state.rangeKm = range;
          const vel = pv.velocity;
          state.speedKmS =
            vel && typeof vel !== 'boolean' ? Math.hypot(vel.x, vel.y, vel.z) : 0;
          try {
            state.heightKm = eciToGeodetic(pos, gmst).height;
          } catch {
            state.heightKm = 0;
          }
          const v = raDecToVector3(
            { raDeg: state.raDeg, decDeg: state.decDeg },
            SPHERE_RADIUS * 0.99,
          );
          state.vec.set(v.x, v.y, v.z); // 原地 mutate：pickRegistry 持同一引用
          ok = true;
        }
      } catch {
        // SGP4 发散 → 本帧无效
      }
    }
    state.valid = ok;
  }
  sats.computedAtMs = dateMs;
  sats.version += 1;
}

/**
 * 运行时从 Celestrak 拉最新 TLE（每星独立，5s 超时）。
 * 任一环节失败（网络/CORS/解析/校验）静默丢弃保快照——兜底是产品既定行为。
 * 成功则原子替换该星 satrec 并写 localStorage（24h 缓存）。
 */
export async function refreshTlesFromCelestrak(): Promise<void> {
  if (!satrecs) satrecs = buildSatrecs();
  await Promise.all(
    SATELLITE_DEFS.map(async (def) => {
      try {
        const res = await fetch(
          `https://celestrak.org/NORAD/elements/gp.php?CATNR=${def.noradId}&FORMAT=TLE`,
          { signal: AbortSignal.timeout(5000) },
        );
        if (!res.ok) return;
        const text = await res.text();
        // 返回 3 行：名称 + line1 + line2（行尾可能带空白）
        const lines = text.split(/\r?\n/).map((l) => l.trimEnd());
        const line1 = lines.find((l) => l.startsWith('1 '));
        const line2 = lines.find((l) => l.startsWith('2 '));
        if (!line1 || !line2) return;
        const rec = validateTle(line1, line2);
        if (!rec) return;
        const slot = satrecs?.get(def.uid);
        if (slot) slot.satrec = rec;
        const state = sats.states.get(def.uid);
        if (state) state.tleEpoch = parseTleEpoch(line1);
        try {
          localStorage.setItem(
            TLE_CACHE_PREFIX + def.noradId,
            JSON.stringify({ fetchedAt: Date.now(), lines: [line1, line2] }),
          );
        } catch {
          // 存储失败无所谓，下次再拉
        }
        // 强制下一次 recompute 生效（时间戳去重会挡住同 ms 的重算）
        sats.computedAtMs = 0;
      } catch {
        // 静默：快照兜底
      }
    }),
  );
}
