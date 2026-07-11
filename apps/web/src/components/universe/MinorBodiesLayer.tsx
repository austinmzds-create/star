'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { minor, recomputeMinorBodies } from '@/lib/minorRegistry';
import { registerDynamicEntry, unregisterEntry } from '@/lib/pickRegistry';
import { useUniverse } from '@/lib/store';

/**
 * 小天体层（Phase 6B 目标 8）：谷神星/灶神星/智神星/哈雷彗星。
 *
 * React.lazy 挂载（同 SatellitesLayer），默认关。
 * 位置更新纪律与 PlanetsLayer 相同：effect 订阅 observeTime（低频）→
 * recomputeMinorBodies；useFrame 只比较 version（O(1)）搬坐标——
 * 小天体日运动角分级，绝不逐帧计算。
 *
 * 渲染 1 draw：单 THREE.Points（4 点，菱形点形纹理区分于恒星圆点）。
 * 不加常驻标签——hover tooltip + 搜索 + 信息卡足够（与卫星层一致）。
 */

/** 菱形点纹理（区分于恒星圆点）。 */
function makeDiamondTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(32, 32);
  ctx.rotate(Math.PI / 4);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 22);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-16, -16, 32, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function MinorBodiesLayer() {
  const observeTime = useUniverse((s) => s.observeTime);
  const versionRef = useRef(-1);
  const pendingFocusRef = useRef(true);

  const built = useMemo(() => {
    const states = [...minor.states.values()];
    const n = states.length;
    const tex = makeDiamondTexture();
    const geom = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    states.forEach((st, i) => {
      const c = new THREE.Color(st.colorHex);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    });
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      map: tex,
      size: 9,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geom, mat);
    points.renderOrder = 8;
    points.frustumCulled = false;
    return { states, points, geom, pos, mat, tex };
  }, []);

  useEffect(() => {
    return () => {
      built.geom.dispose();
      built.mat.dispose();
      built.tex.dispose();
    };
  }, [built]);

  // observeTime（低频）驱动重算；挂载即算一遍保证首帧有效
  useEffect(() => {
    recomputeMinorBodies(observeTime ?? Date.now());
  }, [observeTime]);

  // 拾取注册 + 搜索联动补飞（recompute 在上面的 effect 同步完成，坐标已新鲜）
  useEffect(() => {
    for (const st of minor.states.values()) registerDynamicEntry(st.uid, 'minor', st.vec);
    const s = useUniverse.getState();
    if (pendingFocusRef.current && s.selectedUid?.startsWith('MB-')) {
      s.focusStar(s.selectedUid);
    }
    pendingFocusRef.current = false;
    return () => {
      for (const st of minor.states.values()) unregisterEntry(st.uid);
      // 防幽灵信息卡：层关闭时若选中的是小天体，取消选中
      const cur = useUniverse.getState();
      if (cur.selectedUid?.startsWith('MB-')) cur.selectStar(null);
    };
  }, []);

  useFrame(() => {
    built.points.visible = minor.version > 0;
    if (versionRef.current === minor.version) return;
    versionRef.current = minor.version;
    built.states.forEach((st, i) => {
      built.pos[i * 3] = st.vec.x;
      built.pos[i * 3 + 1] = st.vec.y;
      built.pos[i * 3 + 2] = st.vec.z;
    });
    built.geom.attributes.position!.needsUpdate = true;
  });

  return <primitive object={built.points} />;
}
