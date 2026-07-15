/**
 * 流星雨活跃状态注册表（Phase 9B §3d；模块级单例，镜像 ephemRegistry 模式）。
 *
 * 数据源 = @star/astro-ephem/events 的 METEOR_SHOWERS 静态表（IMO/公域常识
 * 数据）。本模块负责纯计算：
 *  1. 活跃期判定（activeFrom/To，含象限仪雨 12/28→1/12 的跨年环绕）；
 *  2. 活跃强度 ZHR_eff = ZHR·10^(−γ·|D−D_peak|)，γ=0.15/天（钟形衰减的
 *     工程近似，调研 C §3d）；
 *  3. 辐射点当前时刻的真实地平高度角（equatorialToHorizontal，按 store 的
 *     city + observeTime——free 模式也按真实 alt，辐射点在地平线下 rate=0）；
 *  4. 观赏生成率 rate/min = ZHR_eff·sin(max(alt,0))·K，K 调到双子雨峰值
 *     ≈8–12 颗/分（观赏优先于写实：真实 ZHR 是理想天顶小时率，直接照搬
 *     用户会抱怨「看不到」，Stellarium 社区同款问题）。
 *
 * 【演示级声明】流星为程序化演出：真实流星的出现时刻/路径随机不可预报，
 * 本层只保证「辐射点方位、活跃期与相对频率」符合天文事实。
 *
 * 调用纪律：recomputeMeteorActivity 仅由 MeteorShowerLayer 的低频 effect
 * 调用（observeTime/city 变化，播放期 ≤4Hz；全表 10 场纯数学 + ≤3 次
 * 地平转换 <0.05ms）。渲染层 useFrame 只读 active/totalRatePerSec，
 * 版本比较后才重建 marker——帧内零 React、零分配。
 */

import { equatorialToHorizontal, raDecToVector3 } from '@star/astro-core';
import { METEOR_SHOWERS, type MeteorShowerInfo } from '@star/astro-ephem/events';
import * as THREE from 'three';
import { SPHERE_RADIUS } from './universe';

/** ZHR 钟形衰减系数 γ（1/天）。 */
const GAMMA_PER_DAY = 0.15;
/**
 * 观赏生成率标定系数 K（颗/分 per ZHR）：双子雨 ZHR=150 在辐射点近天顶
 * （sin(alt)≈0.99）时 rate ≈ 150·0.99·0.075 ≈ 11 颗/分，落在验收带 8–12。
 */
const RATE_K = 0.075;
/** 同屏最多渲染的活跃流星雨场次（按 ZHR_eff 取前 3）。 */
export const MAX_ACTIVE_SHOWERS = 3;
/** ZHR_eff 低于此值视为不活跃（远离峰值的长尾不值得画 marker）。 */
const MIN_ZHR_EFF = 1;

const DAY_MS = 86_400_000;

/** 单场活跃流星雨的当前状态。 */
export interface ActiveShowerState {
  info: MeteorShowerInfo;
  /** 钟形衰减后的有效 ZHR。 */
  zhrEff: number;
  /** 辐射点当前地平高度角（度；地平线下为负）。 */
  radiantAltDeg: number;
  /** 观赏生成率（颗/秒；已含 sin(alt) 与 K，地平线下为 0）。 */
  ratePerSec: number;
  /** 辐射点天球坐标（赤道系 = SkyRotationGroup 本地系；固定引用原地 mutate）。 */
  vec: THREE.Vector3;
}

interface MeteorRegistry {
  /** 每次 recomputeMeteorActivity 自增；渲染层版本比较后才重建 marker。 */
  version: number;
  computedAtMs: number;
  /** 当前活跃场次（≤MAX_ACTIVE_SHOWERS，按 zhrEff 降序）。 */
  active: ActiveShowerState[];
  /** 全部活跃场次生成率之和（颗/秒，spawn 预算直读）。 */
  totalRatePerSec: number;
}

export const meteors: MeteorRegistry = {
  version: 0,
  computedAtMs: 0,
  active: [],
  totalRatePerSec: 0,
};

// 状态槽池：每场雨一个固定 State（vec 固定引用），避免重算时重建对象
const statePool = new Map<string, ActiveShowerState>();
for (const info of METEOR_SHOWERS) {
  statePool.set(info.showerId, {
    info,
    zhrEff: 0,
    radiantAltDeg: -90,
    ratePerSec: 0,
    vec: new THREE.Vector3(),
  });
}

/** (月,日) 是否在 [from, to] 活跃期内（支持跨年环绕，如 12/28 → 1/12）。 */
function inActivePeriod(month: number, day: number, info: MeteorShowerInfo): boolean {
  const cur = month * 100 + day;
  const from = info.activeFrom[0] * 100 + info.activeFrom[1];
  const to = info.activeTo[0] * 100 + info.activeTo[1];
  return from <= to ? cur >= from && cur <= to : cur >= from || cur <= to;
}

/** 距最近一次极大的天数（跨年安全：取前后三个年份候选的最小值）。 */
function daysFromPeak(timeMs: number, info: MeteorShowerInfo): number {
  const year = new Date(timeMs).getUTCFullYear();
  let best = Infinity;
  for (let y = year - 1; y <= year + 1; y++) {
    const peak = Date.UTC(y, info.peakMonth - 1, info.peakDay);
    const d = Math.abs(timeMs - peak) / DAY_MS;
    if (d < best) best = d;
  }
  return best;
}

const scratchDate = new Date(0);
const scratchObserver = { latitudeDeg: 0, longitudeDeg: 0 };

/**
 * 重算当前活跃流星雨（低频：observeTime/city 变化时由 MeteorShowerLayer
 * 调用）。写入 meteors 单例并自增 version。
 */
export function recomputeMeteorActivity(
  timeMs: number,
  latitudeDeg: number,
  longitudeDeg: number,
): void {
  scratchDate.setTime(timeMs);
  const month = scratchDate.getUTCMonth() + 1;
  const day = scratchDate.getUTCDate();
  scratchObserver.latitudeDeg = latitudeDeg;
  scratchObserver.longitudeDeg = longitudeDeg;

  const found: ActiveShowerState[] = [];
  for (const info of METEOR_SHOWERS) {
    if (!inActivePeriod(month, day, info)) continue;
    const zhrEff = info.zhr * Math.pow(10, -GAMMA_PER_DAY * daysFromPeak(timeMs, info));
    if (zhrEff < MIN_ZHR_EFF) continue;
    const st = statePool.get(info.showerId)!;
    st.zhrEff = zhrEff;
    // 辐射点真实地平高度（free 模式也按当前时刻真实 alt——任务书要求）
    const hor = equatorialToHorizontal(
      { raDeg: info.radiantRaDeg, decDeg: info.radiantDecDeg },
      scratchObserver,
      scratchDate,
    );
    st.radiantAltDeg = hor.altitudeDeg;
    const sinAlt = Math.sin((Math.max(hor.altitudeDeg, 0) * Math.PI) / 180);
    st.ratePerSec = (zhrEff * sinAlt * RATE_K) / 60;
    const v = raDecToVector3(
      { raDeg: info.radiantRaDeg, decDeg: info.radiantDecDeg },
      SPHERE_RADIUS * 0.99,
    );
    st.vec.set(v.x, v.y, v.z);
    found.push(st);
  }
  found.sort((a, b) => b.zhrEff - a.zhrEff);
  if (found.length > MAX_ACTIVE_SHOWERS) found.length = MAX_ACTIVE_SHOWERS;

  let total = 0;
  for (const st of found) total += st.ratePerSec;
  meteors.active = found;
  meteors.totalRatePerSec = total;
  meteors.computedAtMs = timeMs;
  meteors.version += 1;
}
