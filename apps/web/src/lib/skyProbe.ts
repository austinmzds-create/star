/**
 * 天空解析探针（Phase 10「悬停万物」）：把屏幕光标点 → 说明气泡（HoverInfo）。
 *
 * 核心是【解析法】而非逐顶点采样：把光标反投影成方向向量，用「点到大圆/小圆的
 * 角距」判断命中——零几何依赖、与 earth 模式坐标系天然兼容。大圆定义在天球本地系
 * （赤道系），故先 worldToSkyLocal 把世界方向反旋回本地系比对；地平线定义在世界系，
 * 直接用世界方向与天顶点乘。
 *
 * 帧纪律：只读 store 与模块单例，不写 store、不进帧循环——事件时刻调用（≈40ms
 * 一次），模块级 scratch 预分配，零 GC 抖动。星座连线的命中由 CameraRig 前置处理
 * （连线是 CPU 几何，复用点击用的段距离逻辑）；本探针只测坐标线/黄道/银河/地平线。
 *
 * 坐标沿用仓库约定（raDecToVector3：+Y=北天极，RA 从 +X 向 −Z 增；世界系天顶=+Y、
 * 北点=−Z、东=+X）。文案纯科普，无官方命名/认证/产权措辞（合规红线）。
 */

import { DEG2RAD, raDecToVector3, RAD2DEG } from '@star/astro-core';
import * as THREE from 'three';
import { getHorizonZenith } from '@/components/universe/HorizonLayer';
import type { HoverInfo } from './hoverBus';
import { worldToSkyLocal } from './skyFrame';
import { useUniverse } from './store';

/** 黄赤交角（J2000，度；与 GridLayer 同值）。 */
const OBLIQUITY_DEG = 23.4393;

/** 黄道十二宫中文名（自春分点 λ=0° 起，每 30° 一宫；与 GridLayer.ZODIAC_ZH 一致）。 */
const ZODIAC_ZH = [
  '白羊',
  '金牛',
  '双子',
  '巨蟹',
  '狮子',
  '室女',
  '天秤',
  '天蝎',
  '人马',
  '摩羯',
  '宝瓶',
  '双鱼',
];

/** 单位方向常量（模块级）。 */
function vecOf(raDeg: number, decDeg: number): THREE.Vector3 {
  const v = raDecToVector3({ raDeg, decDeg }, 1);
  return new THREE.Vector3(v.x, v.y, v.z);
}
/** 黄北极（J2000）赤道系：RA=270°, Dec=+66.561°(=90−23.439)。 */
const ECLIPTIC_POLE = vecOf(270, 66.561);
/** 银北极（J2000）：RA=192.8595°, Dec=+27.1283°。 */
const GALACTIC_POLE = vecOf(192.8595, 27.1283);
/** 天赤道法向（北天极）。 */
const NORTH_POLE = new THREE.Vector3(0, 1, 0);

// ── 说明文案表（准确、简洁、有星空味） ──
const INFO = {
  equator: { icon: '⊙', title: '天赤道', sub: '地球赤道投向星空的大圈' } as HoverInfo,
  milkyway: { icon: '🌌', title: '银河', sub: '我们所在恒星之城的侧影' } as HoverInfo,
};
function decCircleInfo(decDeg: number): HoverInfo {
  const sign = decDeg >= 0 ? '+' : '−';
  return {
    icon: '∥',
    title: `赤纬 ${sign}${Math.abs(decDeg)}° 圈`,
    sub: '与天赤道平行、纬度相同的星',
  };
}
function raCircleInfo(hour: number): HoverInfo {
  return {
    icon: 'ǁ',
    title: `赤经 ${hour}h 圈`,
    sub: '从北天极垂下的经线（每 2 小时一条）',
  };
}
function eclipticInfo(signIdx: number): HoverInfo {
  const name = ZODIAC_ZH[((signIdx % 12) + 12) % 12] ?? '';
  return {
    icon: '☀️',
    title: `黄道 · ${name}宫`,
    sub: '太阳此段时节所经的天区',
  };
}
function horizonInfo(cardinal: string | null): HoverInfo {
  if (cardinal) {
    return { icon: '〰️', title: `地平线 · 正${cardinal}`, sub: '此刻你面向的方位' };
  }
  return { icon: '〰️', title: '地平线', sub: '天与地相接的圆——其下是脚下的大地' };
}

// ── 模块级 scratch（事件路径零 GC 抖动） ──
const worldDir = new THREE.Vector3();
const localDir = new THREE.Vector3();

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** 世界方向 → 就近四正向（仅 earth 模式有意义：天顶=+Y、北=−Z、东=+X）。 */
function cardinalOf(dir: THREE.Vector3): string {
  const azDeg = (Math.atan2(dir.x, -dir.z) * RAD2DEG + 360) % 360;
  const idx = Math.round(azDeg / 90) % 4; // 0=北 1=东 2=南 3=西
  return ['北', '东', '南', '西'][idx] ?? '北';
}

/** 黄道黄经宫序号（0=白羊…11=双鱼）：由本地系（赤道三向量）反解。 */
function zodiacSignIndex(v: THREE.Vector3): number {
  // raDecToVector3 三向量 → 标准赤道系（X=春分点, Y=90°RA, Z=北极）：Xs=x, Ys=−z, Zs=y
  const eps = OBLIQUITY_DEG * DEG2RAD;
  const cosE = Math.cos(eps);
  const sinE = Math.sin(eps);
  const Xs = v.x;
  const Ys = -v.z;
  const Zs = v.y;
  // 逆黄赤交角旋转 → 黄道系：Ex=cosβcosλ, Ey=cosβsinλ
  const ex = Xs;
  const ey = Ys * cosE + Zs * sinE;
  const lam = (Math.atan2(ey, ex) * RAD2DEG + 360) % 360;
  return Math.floor(lam / 30) % 12;
}

interface Candidate {
  d: number;
  info: HoverInfo;
}

/**
 * 屏幕点 → 说明气泡。clientPx/clientPy 相对画布左上角；返回命中项（角距最近者），
 * 无命中返回 null。各元素仅在对应图层可见时才测（门控在此，不给「悬停看不见的线」
 * 的困惑）。星座连线不在此测——由 CameraRig 前置处理并优先。
 */
export function probeSkyAt(
  clientPx: number,
  clientPy: number,
  cam: THREE.PerspectiveCamera,
  rect: { width: number; height: number },
): HoverInfo | null {
  const s = useUniverse.getState();

  // 1) 光标 → 世界方向（用真相机）
  const ndcX = (clientPx / rect.width) * 2 - 1;
  const ndcY = -((clientPy / rect.height) * 2 - 1);
  worldDir.set(ndcX, ndcY, 0.5).unproject(cam).normalize();
  // 2) 世界方向 → 天球本地系（earth 模式反旋天旋；free 恒等）
  worldToSkyLocal(worldDir, localDir);

  // 命中阈值随缩放自适应（22px 折算成角度）：fov60/height900 ≈1.47°
  const thrRad = 22 * (cam.fov / rect.height) * DEG2RAD;

  const cand: Candidate[] = [];

  // —— 天赤道 + 赤纬圈 + 赤经时圈（赤道网格开时才测）——
  if (s.showEquatorGrid) {
    // 到大圆角距 = |asin(p·n)|；赤道法向 = 北极 ⇒ = |asin(y)| = |dec|
    const decRad = Math.asin(clamp(localDir.y, -1, 1));
    const dEquator = Math.abs(decRad);
    if (dEquator < thrRad) cand.push({ d: dEquator, info: INFO.equator });
    // 赤纬圈 ±30/±60（小圆）：点 dec 与圈值角距
    const decDeg = decRad * RAD2DEG;
    for (const c of [-60, -30, 30, 60]) {
      const dd = Math.abs(decDeg - c) * DEG2RAD;
      if (dd < thrRad) cand.push({ d: dd, info: decCircleInfo(c) });
    }
    // 赤经时圈（每 2h=30°，过极大圆）：Δα·cos(dec) 为球面角距
    const raDeg = (Math.atan2(-localDir.z, localDir.x) * RAD2DEG + 360) % 360;
    const nearest = (Math.round(raDeg / 30) * 30) % 360;
    let dRaDeg = raDeg - nearest;
    if (dRaDeg > 180) dRaDeg -= 360;
    else if (dRaDeg < -180) dRaDeg += 360;
    const dRa = Math.abs(dRaDeg) * DEG2RAD * Math.cos(decRad);
    if (dRa < thrRad) cand.push({ d: dRa, info: raCircleInfo(nearest / 15) });
  }

  // —— 黄道 + 当前黄道宫（黄道开时才测；黄道带略宽）——
  if (s.showEcliptic) {
    const dEc = Math.abs(Math.asin(clamp(localDir.dot(ECLIPTIC_POLE), -1, 1)));
    if (dEc < thrRad * 1.4) cand.push({ d: dEc, info: eclipticInfo(zodiacSignIndex(localDir)) });
  }

  // —— 银河（区域，带宽 ±12°；最低优先级：让位给线）——
  if (s.showMilkyWay) {
    const dGal = Math.abs(Math.asin(clamp(localDir.dot(GALACTIC_POLE), -1, 1)));
    if (dGal < 12 * DEG2RAD) cand.push({ d: dGal + 999, info: INFO.milkyway });
  }

  // —— 地平线（世界系，earth/free 都用天顶向量）——
  if (s.showHorizon) {
    const zenith = getHorizonZenith();
    if (zenith) {
      const dHor = Math.abs(Math.asin(clamp(worldDir.dot(zenith), -1, 1)));
      if (dHor < thrRad) {
        // 方位仅在 earth 模式可靠（天顶=+Y，az=atan2(x,−z)）；free 模式给简版
        const cardinal = s.viewMode === 'earth' ? cardinalOf(worldDir) : null;
        cand.push({ d: dHor, info: horizonInfo(cardinal) });
      }
    }
  }

  if (cand.length === 0) return null;
  cand.sort((a, b) => a.d - b.d);
  return cand[0]!.info;
}
