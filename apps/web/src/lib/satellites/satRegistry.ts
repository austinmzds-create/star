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

import { computeVisibility, raDecToVector3 } from '@star/astro-core';
import type { CelestialObject } from '@star/astro-data';
import { getEquatorial } from '@star/astro-ephem';
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
/** 地球平均半径（km）：星链受照判定的圆柱地影半径。 */
const R_EARTH_KM = 6371;
/** 星链光点统一色（冷白青）。 */
const STARLINK_COLOR = '#a8c4ff';

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
  /** 本帧卫星是否被太阳照亮（圆柱地影近似，演示级；见 recomputeSatellites）。 */
  sunlit: boolean;
  /**
   * 本帧「现在可见 · 过境中」：卫星受照 && 观测点已足够暗（太阳高度<−6°）
   * && 卫星仰角>10°。星链层据此染色/高亮；信息卡可据此显徽章。
   */
  visiblePass: boolean;
  /** 分档：著名内置三星 'famous'；星链动态成员 'starlink'。 */
  group: 'famous' | 'starlink';
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
      sunlit: false,
      visiblePass: false,
      group: 'famous',
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

  // ── 晨昏 + 太阳方向（每帧一次，非逐星）——星链「现在可见」判定的公共量 ──
  // 太阳地心 J2000 赤道坐标 → (a) 观测点太阳高度角判民用晨昏；(b) ECI 单位方向
  // 供受照判定。sunEq 每帧不变，循环内复用 sx/sy/sz，避免逐星重算太阳位置。
  const observer = { latitudeDeg: city.latitudeDeg, longitudeDeg: city.longitudeDeg };
  const sunEq = getEquatorial('sun', scratchDate);
  const sunAltDeg = computeVisibility(sunEq, observer, scratchDate).horizontal.altitudeDeg;
  const darkEnough = sunAltDeg < -6; // 民用晨昏：天已足够暗
  const sRa = sunEq.raDeg * DEG2RAD;
  const sDec = sunEq.decDeg * DEG2RAD;
  const sx = Math.cos(sDec) * Math.cos(sRa);
  const sy = Math.cos(sDec) * Math.sin(sRa);
  const sz = Math.sin(sDec);

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

          // 受照判定（ECI 圆柱地影近似，忽略半影/折射，演示级）：
          // 日向轴投影 >0 → 朝阳半侧必受照；否则查到日-地轴垂距是否在地影柱外。
          const proj = pos.x * sx + pos.y * sy + pos.z * sz;
          let sunlit: boolean;
          if (proj > 0) {
            sunlit = true;
          } else {
            const px = pos.x - proj * sx;
            const py = pos.y - proj * sy;
            const pz = pos.z - proj * sz;
            sunlit = Math.hypot(px, py, pz) > R_EARTH_KM;
          }
          state.sunlit = sunlit;
          // 「现在可见」：受照 && 天已暗 && 卫星仰角 > 10°（站心 RA/Dec 复用上面已算值）
          const satAltDeg = computeVisibility(
            { raDeg: state.raDeg, decDeg: state.decDeg },
            observer,
            scratchDate,
          ).horizontal.altitudeDeg;
          state.visiblePass = darkEnough && sunlit && satAltDeg > 10;
          ok = true;
        }
      } catch {
        // SGP4 发散 → 本帧无效
      }
    }
    state.valid = ok;
    if (!ok) {
      state.sunlit = false;
      state.visiblePass = false;
    }
  }
  sats.computedAtMs = dateMs;
  sats.version += 1;
}

/**
 * 运行时刷新 TLE（Phase 9C：改打自家 /api/v1/tle 服务端代理，一次拉全）。
 *
 * 客户端【零 Celestrak 直连】——Celestrak usage policy 要求同一数据 2h 更新
 * 节奏内不重复拉取，违者 403→封 IP；全站访客各自直连必被封。改为 services/api
 * 每 6h 集中拉一次落库，前端只打自家接口（api.ts never-reject 模式）。
 * 失败（未配置 API / 网络 / 校验不过）静默保内置快照 + localStorage 24h 缓存
 * ——兜底是产品既定行为；快照过期 >7 天时 SatellitesLayer 已有「轨道数据 X 天前」声明。
 * 成功则原子替换该星 satrec 并写 localStorage（键与旧版一致，缓存平滑续用）。
 */
export async function refreshTles(): Promise<void> {
  if (!satrecs) satrecs = buildSatrecs();
  const { fetchTleFeed } = await import('../api'); // 懒 chunk 内动态引，避免拉宽本模块静态依赖
  const feed = await fetchTleFeed();
  if (!feed) return; // 快照/缓存兜底
  const byId = new Map(feed.sats.map((s) => [s.id, s]));
  for (const def of SATELLITE_DEFS) {
    // 跨域契约（feed.types.ts 冻结）：TLE 条目 id 与本侧卫星 uid 对齐（'SAT-ISS' 等），
    // 不是 NORAD 编号——按 uid 命中，否则整轮刷新静默落空
    const row = byId.get(def.uid);
    if (!row) continue;
    // 行尾容错 + 双行校验（长度/行号/mod-10 校验和/satrec 可解析）
    const line1 = row.l1?.trimEnd();
    const line2 = row.l2?.trimEnd();
    if (!line1 || !line2) continue;
    const rec = validateTle(line1, line2);
    if (!rec) continue;
    const slot = satrecs.get(def.uid);
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
  }
}

// ============================== 星链（动态注入）==============================

/** 本次会话已注入的星链 uid（供清理时精准移除 states/satrecs，停止其逐帧 SGP4）。 */
const starlinkUids = new Set<string>();

/** 构造星链动态目录行（供 getObjectByUid / hover / 信息卡解析名字；合规 isNamable=false）。 */
function makeStarlinkRow(uid: string, nameZh: string): CelestialObject {
  const norad = uid.slice('SAT-STARLINK-'.length);
  return {
    objectUid: uid,
    type: 'satellite',
    nameEn: nameZh, // 组内英文名（STARLINK-xxxxx）即展示名
    nameZh,
    aliases: [nameZh, 'Starlink', '星链'],
    constellation: 'Earth Orbit',
    constellationZh: '近地轨道',
    raDeg: 0, // 占位：实时坐标见 satRegistry
    decDeg: 0,
    magnitude: -1,
    distanceLy: null,
    catalogIds: norad ? { norad } : {},
    isNamable: false, // 合规红线：人造卫星绝不进命名池
    isFeatured: false,
    isEphemeris: false,
    descriptionZh: 'Starlink 通信卫星星座成员 · 近地轨道 · TLE 演示精度',
    renderPriority: 120,
    searchPriority: 5, // 低优先级：不淹没恒星/著名天体搜索结果
    sourceCatalog: 'celestrak-tle-snapshot',
  };
}

/**
 * 注入星链动态卫星（earth 模式的 StarlinkLayer 挂载时调用）。
 *
 * 从自家 /api/v1/tle 拉全 feed，取 id 前缀 'SAT-STARLINK-' 的条目，按 deviceTier
 * 上限 cap 截断后建 state + satrec，并把目录行 append 进搜索目录（名字可解析）。
 * 客户端零 Celestrak 直连（服务端已集中拉取，政策红线）。失败静默——无星链即空层。
 *
 * 截断纪律：只注入前 cap 颗即停——recomputeSatellites 逐帧遍历 satrecs，
 * 未注入的不产生 SGP4 成本（mid 档 60 颗、high 档 120 颗，见性能预算）。
 */
export async function injectStarlink(cap: number): Promise<void> {
  if (cap <= 0) return;
  if (!satrecs) satrecs = buildSatrecs();
  const { fetchTleFeed } = await import('../api');
  const feed = await fetchTleFeed();
  if (!feed) return; // 未配置 API / 网络失败 → 空层（确定性回退，不编造）
  const newRows: CelestialObject[] = [];
  let n = 0;
  for (const row of feed.sats) {
    if (n >= cap) break;
    if (!row.id.startsWith('SAT-STARLINK-')) continue;
    const line1 = row.l1?.trimEnd();
    const line2 = row.l2?.trimEnd();
    if (!line1 || !line2) continue;
    const rec = validateTle(line1, line2);
    if (!rec) continue;
    n++;
    const nameZh = row.nameZh ?? row.name ?? row.id;
    if (!sats.states.has(row.id)) {
      sats.states.set(row.id, {
        uid: row.id,
        nameZh,
        colorHex: STARLINK_COLOR,
        raDeg: 0,
        decDeg: 0,
        rangeKm: 0,
        heightKm: 0,
        speedKmS: 0,
        tleEpoch: parseTleEpoch(line1),
        valid: false,
        vec: new THREE.Vector3(),
        sunlit: false,
        visiblePass: false,
        group: 'starlink',
      });
      newRows.push(makeStarlinkRow(row.id, nameZh));
    }
    satrecs.set(row.id, { uid: row.id, satrec: rec });
    starlinkUids.add(row.id);
  }
  sats.computedAtMs = 0; // 触发下帧重算
  if (newRows.length > 0) {
    const { appendDynamicSatelliteRows } = await import('../solarSystem');
    appendDynamicSatelliteRows(newRows); // 幂等：同 uid 跳过
  }
}

/**
 * 清理星链动态注入（StarlinkLayer 卸载时调用）：从 states/satrecs 移除，
 * 使 recomputeSatellites 不再对其做 SGP4。搜索目录行保留无害（幂等可再注入）。
 */
export function clearStarlink(): void {
  for (const uid of starlinkUids) {
    sats.states.delete(uid);
    satrecs?.delete(uid);
  }
  starlinkUids.clear();
  sats.computedAtMs = 0;
}

/** 当前已注入的星链 uid 列表（StarlinkLayer 遍历渲染/注册用）。 */
export function getStarlinkUids(): readonly string[] {
  return [...starlinkUids];
}
