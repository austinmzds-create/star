'use client';

import { DEG2RAD, RAD2DEG, raDecToVector3 } from '@star/astro-core';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useUniverse } from '@/lib/store';
import { SPHERE_RADIUS } from '@/lib/universe';

/**
 * 坐标线层（宇宙 V3-F）：黄道组 + 赤道网格组，全部静态几何（J2000）。
 *
 * 分组取舍（设计 §1）：黄道独立开关（金色，认知上是「太阳的路」，含
 * 十二宫刻度与宫名）；天赤道与 RA/Dec 网格合并一组（同属赤道参考系，
 * 赤道即 Dec=0 的加粗青线）。地平线组见 HorizonLayer（随城市/时间动）。
 *
 * 性能：默认全关、零成本；首次开启才构建几何/Sprite 并缓存（ref 持有，
 * 关闭仅从场景摘除不销毁，重开零重建）。黄道 2 draw + 宫名 12 Sprite、
 * 赤道 1 draw + 网格合并 1 draw。样式克制：细线低透明、depthTest 关闭
 * 贴内壁（renderOrder 0.5，星点之下、背景之上）。
 */

/** 黄赤交角（J2000，度）。 */
const OBLIQUITY_DEG = 23.4393;
/** 线几何半径：贴天球内壁略内。 */
const LINE_RADIUS = SPHERE_RADIUS * 0.99;

/** 黄道十二宫中文名（自春分点 λ=0° 起，每 30° 一宫）。 */
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

/** 黄道坐标（λ 黄经 / β 黄纬，度）→ 天球世界坐标（绕 x 轴转黄赤交角）。 */
function eclipticToVector3(lambdaDeg: number, betaDeg: number, radius: number): THREE.Vector3 {
  const l = lambdaDeg * DEG2RAD;
  const b = betaDeg * DEG2RAD;
  const eps = OBLIQUITY_DEG * DEG2RAD;
  const xe = Math.cos(b) * Math.cos(l);
  const ye = Math.cos(b) * Math.sin(l);
  const ze = Math.sin(b);
  const yq = ye * Math.cos(eps) - ze * Math.sin(eps);
  const zq = ye * Math.sin(eps) + ze * Math.cos(eps);
  const raDeg = RAD2DEG * Math.atan2(yq, xe);
  const decDeg = RAD2DEG * Math.asin(Math.max(-1, Math.min(1, zq)));
  const v = raDecToVector3({ raDeg, decDeg }, radius);
  return new THREE.Vector3(v.x, v.y, v.z);
}

/** 赤道坐标 → THREE.Vector3 快捷方式。 */
function eqVec(raDeg: number, decDeg: number, radius = LINE_RADIUS): THREE.Vector3 {
  const v = raDecToVector3({ raDeg, decDeg }, radius);
  return new THREE.Vector3(v.x, v.y, v.z);
}

/** 顶点数组 → 关深度的线材质 + 几何（默认 LineLoop）。 */
function makeLine(
  points: THREE.Vector3[],
  color: string,
  opacity: number,
  segments = false,
): { obj: THREE.Line | THREE.LineSegments; disposables: Array<{ dispose(): void }> } {
  const geom = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: false,
  });
  const obj = segments ? new THREE.LineSegments(geom, mat) : new THREE.LineLoop(geom, mat);
  obj.renderOrder = 0.5;
  obj.frustumCulled = false;
  return { obj, disposables: [geom, mat] };
}

/** 宫名小标签（canvas 文本 Sprite，金色低透明）。 */
function makeZodiacSprite(text: string): {
  sprite: THREE.Sprite;
  disposables: Array<{ dispose(): void }>;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 48;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '500 26px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(217,185,110,0.95)';
  ctx.fillText(text, 64, 26);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(mat);
  const h = 17;
  sprite.scale.set(h * (128 / 48), h, 1);
  sprite.renderOrder = 0.5;
  return { sprite, disposables: [tex, mat] };
}

interface BuiltGroup {
  group: THREE.Group;
  disposables: Array<{ dispose(): void }>;
}

/** 黄道组：大圆（128 段）+ 十二宫刻度（24 顶点）+ 宫名 Sprite ×12。 */
function buildEclipticGroup(): BuiltGroup {
  const group = new THREE.Group();
  const disposables: Array<{ dispose(): void }> = [];

  // 大圆：β=0，λ 每 2.8125°（128 段）
  const circle: THREE.Vector3[] = [];
  for (let i = 0; i < 128; i++) circle.push(eclipticToVector3((i * 360) / 128, 0, LINE_RADIUS));
  const line = makeLine(circle, '#d9b96e', 0.35);
  group.add(line.obj);
  disposables.push(...line.disposables);

  // 十二宫刻度：λ=0,30,…330 处沿黄纬 ±1.2° 的短线段
  const ticks: THREE.Vector3[] = [];
  for (let i = 0; i < 12; i++) {
    const lambda = i * 30;
    ticks.push(eclipticToVector3(lambda, -1.2, LINE_RADIUS), eclipticToVector3(lambda, 1.2, LINE_RADIUS));
  }
  const tickLine = makeLine(ticks, '#d9b96e', 0.5, true);
  group.add(tickLine.obj);
  disposables.push(...tickLine.disposables);

  // 宫名：置于每宫中点（λ+15°）、黄纬 +3°
  ZODIAC_ZH.forEach((name, i) => {
    const { sprite, disposables: d } = makeZodiacSprite(name);
    sprite.position.copy(eclipticToVector3(i * 30 + 15, 3, LINE_RADIUS));
    group.add(sprite);
    disposables.push(...d);
  });

  return { group, disposables };
}

/** 赤道网格组：天赤道大圆 + RA 线 12 条 / Dec 圈 4 条合并单 LineSegments。 */
function buildEquatorGridGroup(): BuiltGroup {
  const group = new THREE.Group();
  const disposables: Array<{ dispose(): void }> = [];

  // 天赤道：dec=0 大圆（128 段），比网格醒目的青色
  const equator: THREE.Vector3[] = [];
  for (let i = 0; i < 128; i++) equator.push(eqVec((i * 360) / 128, 0));
  const eqLine = makeLine(equator, '#6fd6d6', 0.3);
  group.add(eqLine.obj);
  disposables.push(...eqLine.disposables);

  // RA/Dec 网格合并为单个 LineSegments（≈1800 顶点，1 draw）
  const seg: THREE.Vector3[] = [];
  // RA 线 12 条（每 2h=30°），dec 从 -84° 到 +84° 每 4° 一段
  for (let raH = 0; raH < 24; raH += 2) {
    const raDeg = raH * 15;
    for (let dec = -84; dec < 84; dec += 4) {
      seg.push(eqVec(raDeg, dec), eqVec(raDeg, dec + 4));
    }
  }
  // Dec 圈 4 条（±30°、±60°），各 96 段
  for (const dec of [-60, -30, 30, 60]) {
    for (let i = 0; i < 96; i++) {
      seg.push(eqVec((i * 360) / 96, dec), eqVec(((i + 1) * 360) / 96, dec));
    }
  }
  const gridLine = makeLine(seg, '#8fa3c8', 0.06, true);
  group.add(gridLine.obj);
  disposables.push(...gridLine.disposables);

  return { group, disposables };
}

export function GridLayer() {
  const showEcliptic = useUniverse((s) => s.showEcliptic);
  const showEquatorGrid = useUniverse((s) => s.showEquatorGrid);

  // 懒构建 + 缓存：首次开启才建，关闭只摘除不销毁（重开零重建）
  const eclipticRef = useRef<BuiltGroup | null>(null);
  const equatorRef = useRef<BuiltGroup | null>(null);
  if (showEcliptic && !eclipticRef.current) eclipticRef.current = buildEclipticGroup();
  if (showEquatorGrid && !equatorRef.current) equatorRef.current = buildEquatorGridGroup();

  // 卸载时统一释放
  useEffect(() => {
    return () => {
      for (const built of [eclipticRef.current, equatorRef.current]) {
        if (built) for (const d of built.disposables) d.dispose();
      }
    };
  }, []);

  return (
    <>
      {showEcliptic && eclipticRef.current && <primitive object={eclipticRef.current.group} />}
      {showEquatorGrid && equatorRef.current && <primitive object={equatorRef.current.group} />}
    </>
  );
}
