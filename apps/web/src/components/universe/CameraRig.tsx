'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { damp } from 'maath/easing';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { playChime } from '@/lib/audioEngine';
import { getExternalPose, releaseCamera } from '@/lib/cameraBus';
import { getConstellationRenderData, pickConstellationAt } from '@/lib/constellation-render';
import { isCoarsePointer } from '@/lib/device';
import { getHover, setHover } from '@/lib/hoverBus';
import { ensureStaticEntries, pickEntries, resolveObjectPosition } from '@/lib/pickRegistry';
import { useUniverse } from '@/lib/store';
import { SPHERE_RADIUS } from '@/lib/universe';
import { triggerArrivalPulse } from './TargetHighlight';

const PITCH_LIMIT = THREE.MathUtils.degToRad(85);
/** FOV 允许区间（滚轮 / 捏合 / 飞行统一钳制，与旧版 22–72 一致）。 */
const FOV_MIN = 22;
const FOV_MAX = 72;
/** 惯性衰减率 λ（1/s）：v·e^(−λt)，≈0.14s 减半、~1.5s 自然停稳（审计 §2.1）。 */
const INERTIA_DECAY = 5;
/** 惯性静止阈值（rad/s）：合角速度低于此值即判定停稳。 */
const INERTIA_STOP = 0.0004;
/** 抬指前静止判定（ms）：拖拽中指尖停住超过此时长再松手 → 不给惯性（速度已过期）。 */
const INERTIA_STALE_MS = 80;
/** 交互静止后自动旋转延迟缓入的等待时长（ms）——避免「刹停后突然又转」。 */
const AUTO_RESUME_DELAY_MS = 2000;
/** 自动旋转角速度（rad/s，≈1°/s，与旧版一致）。 */
const AUTO_ROTATE_SPEED = 0.018;
/**
 * 悬停拾取节流（ms）：点积预筛后单次拾取实测 0.086ms（低端折算 ≤0.7ms），
 * 40ms 间隔占帧预算 <2%，光标手型与名牌跟随明显更跟手（审计 §2.6，原 70ms）。
 */
const HOVER_THROTTLE_MS = 40;

// ── 模块级 scratch（事件/帧路径零分配纪律，与各渲染层同规） ──
const pickV = new THREE.Vector3();
const camDirV = new THREE.Vector3();
const anchorV = new THREE.Vector3();
const flyDirV = new THREE.Vector3();

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** 单位方向 → yaw/pitch（与 lib/universe.directionToYawPitch 同约定的免分配版）。 */
function dirToYaw(v: THREE.Vector3): number {
  return Math.atan2(-v.x, -v.z);
}
function dirToPitch(v: THREE.Vector3): number {
  return Math.asin(THREE.MathUtils.clamp(v.y, -1, 1));
}

/** yaw/pitch → 单位方向（dirToYaw/dirToPitch 的逆变换），写入 out。 */
function yawPitchToDir(yawV: number, pitchV: number, out: THREE.Vector3): THREE.Vector3 {
  const c = Math.cos(pitchV);
  return out.set(-Math.sin(yawV) * c, Math.sin(pitchV), -Math.cos(yawV) * c);
}

/**
 * 球面插值（大圆路径）：a/b 需单位向量，结果写入 out。
 * 大角度飞行不再走 yaw/pitch 独立 lerp 的「先仰后俯」畸变弧（审计 §1.1-④），
 * 且天然免除 yaw 绕圈归一。近共线/对跖（sinθ→0）退化取端点，避免除零。
 */
function slerpDir(a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  const theta = Math.acos(dot);
  const s = Math.sin(theta);
  if (s < 1e-6) return out.copy(t < 0.5 ? a : b);
  const wa = Math.sin((1 - t) * theta) / s;
  const wb = Math.sin(t * theta) / s;
  return out.set(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb).normalize();
}

interface FlyState {
  active: boolean;
  /** 起点/终点单位方向：每帧 slerp 走大圆（预分配，飞行间复用）。 */
  fromDir: THREE.Vector3;
  toDir: THREE.Vector3;
  /**
   * 追踪目标 uid：飞行每帧重读 resolveObjectPosition 刷新 toDir——
   * 行星/卫星的 vec 是注册表同一引用，重读零成本，落点永远居中（审计 §2.5-4）。
   */
  targetUid: string | null;
  t: number;
  dur: number;
  fromFov: number;
  toFov: number;
  /** zoom-out-in 弧线峰值（度）：fov(e)=lerp+bump·sin(πe)；小角度飞行为 0。 */
  bumpDeg: number;
}

/**
 * 相机位于天球中心，向外环视。负责：
 * 拖拽环视（带惯性滑行）、滚轮/触控板平滑缩放、移动端双指捏合缩放、
 * 缩放锚点跟随光标、自动缓慢旋转（交互后延迟缓入）、点击拾取天体、
 * 以及镜头飞向目标（角距自适应时长 + 大圆路径 + zoom-out-in 弧线 + 到达反馈）。
 *
 * 拾取与飞行统一走 lib/pickRegistry：恒星 + 深空天体 + 行星日月一张表，
 * 行星坐标是星历注册表的同一 Vector3 引用——点击/飞行时刻读到的一定是
 * 当前 observeTime 的位置，无需现算。
 *
 * 手势纪律：事件里只写 ref/目标值，逐帧逼近全部在 useFrame 内完成；
 * 拖拽保持 1:1 直写（跟手优先），惯性/缩放/自动旋转才做平滑。
 */
export function CameraRig() {
  const { camera, gl } = useThree();
  // R3F 交互期降载：拖拽/滚轮/捏合时调 regress()，配合 AdaptiveDpr 临时降 DPR
  const regress = useThree((s) => s.performance.regress);
  const selectedUid = useUniverse((s) => s.selectedUid);
  const focusNonce = useUniverse((s) => s.focusNonce);
  const resetNonce = useUniverse((s) => s.resetNonce);
  const autoRotate = useUniverse((s) => s.autoRotate);
  const selectStar = useUniverse((s) => s.selectStar);
  const constellationFocusNonce = useUniverse((s) => s.constellationFocusNonce);
  const clearPinnedConstellation = useUniverse((s) => s.clearPinnedConstellation);

  const yaw = useRef(0.7);
  const pitch = useRef(0.12);
  const dragging = useRef(false);
  const moved = useRef(false);
  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;
  /** 悬停拾取节流时间戳。 */
  const lastHoverPick = useRef(0);

  // ── 拖拽/惯性状态：movementX/Y 是规范外字段（iOS 触摸恒 0、Chrome 高 DPI
  // 以物理像素报告），改为自记 lastX/lastY 求差（审计 §1.1-①） ──
  const lastX = useRef(0);
  const lastY = useRef(0);
  /** 上次拖拽移动的时间戳（ms）：角速度采样分母 + 抬指静止判定。 */
  const lastMoveMs = useRef(0);
  /** 低通累计角速度（rad/s，α≈0.3）：抬指后作为惯性初速。 */
  const velYaw = useRef(0);
  const velPitch = useRef(0);
  /** 惯性滑行进行中（pointerdown/飞行/陀螺仪即打断）。 */
  const inertia = useRef(false);
  /** 最近一次交互/惯性停稳时刻（ms）：自动旋转延迟 2s 后 damp 缓入。 */
  const idleSince = useRef(0);
  /** 自动旋转当前角速度（damp 缓入/缓出的载体，maath 直接写 .v）。 */
  const autoSpin = useRef({ v: 0 });

  // ── 缩放状态：事件只写 targetFov，useFrame 里 damp 指数逼近（审计 §2.2） ──
  const targetFov = useRef(60);
  /** 缩放锚点（NDC）：滚轮取光标、捏合取两指中点；fov 变化帧做角度补偿。 */
  const anchor = useRef({ has: false, x: 0, y: 0 });

  // ── 双指捏合（审计 §2.3，移动端功能缺口 P0） ──
  /** 按下中的指针表：两指进 pinch 态，单指剩余回拖拽态。 */
  const activePointers = useRef(new Map<number, { x: number; y: number }>());
  const pinching = useRef(false);
  const pinchStart = useRef({ dist: 0, fov: 60 });

  const fly = useRef<FlyState>({
    active: false,
    fromDir: new THREE.Vector3(0, 0, -1),
    toDir: new THREE.Vector3(0, 0, -1),
    targetUid: null,
    t: 0,
    dur: 1.25,
    fromFov: 60,
    toFov: 60,
    bumpDeg: 0,
  });

  // 初始化相机 + 拾取表（幂等）
  useEffect(() => {
    ensureStaticEntries();
    const cam = camera as THREE.PerspectiveCamera;
    cam.rotation.order = 'YXZ';
    cam.position.set(0, 0, 0);
    cam.fov = 60;
    cam.near = 0.1;
    cam.far = 4000;
    cam.updateProjectionMatrix();
    targetFov.current = 60;
  }, [camera]);

  /**
   * 启动一次飞行（审计 §2.5「三件套」）：
   * - 时长角距自适应：dur = clamp(0.6 + 0.9·√(ang/π), 0.6, 2.2)——2° 微调
   *   ~0.65s、跨天球 ~2.1s，角速度峰值压到 <120°/s（旧版固定 1.25s 两头翻车）；
   * - zoom-out-in 弧线：bump = min(14°, angDeg·0.12)，ang<15° 不加（微调不呼吸）；
   * - toFov：点星大角度飞行至少回到 40°（深缩放跨天球不再「哐」地平移），
   *   邻近微调维持现 FOV；星座搜索沿用 <45° → 60° 看全貌的旧规则。
   */
  const beginFly = (targetVec: THREE.Vector3, targetUid: string | null, kind: 'object' | 'constellation'): void => {
    const cam = camera as THREE.PerspectiveCamera;
    const f = fly.current;
    yawPitchToDir(yaw.current, pitch.current, f.fromDir);
    f.toDir.copy(targetVec).normalize();
    const angRad = Math.acos(THREE.MathUtils.clamp(f.fromDir.dot(f.toDir), -1, 1));
    const angDeg = THREE.MathUtils.radToDeg(angRad);
    f.targetUid = targetUid;
    f.t = 0;
    f.dur = THREE.MathUtils.clamp(0.6 + 0.9 * Math.sqrt(angRad / Math.PI), 0.6, 2.2);
    f.bumpDeg = angDeg < 15 ? 0 : Math.min(14, angDeg * 0.12);
    f.fromFov = cam.fov;
    const rawToFov =
      kind === 'constellation'
        ? cam.fov < 45
          ? 60
          : cam.fov
        : angDeg >= 15
          ? Math.max(cam.fov, 40)
          : cam.fov;
    f.toFov = THREE.MathUtils.clamp(rawToFov, FOV_MIN, FOV_MAX);
    f.active = true;
    // 飞行打断惯性；到达前自动旋转也不缓入
    inertia.current = false;
    velYaw.current = 0;
    velPitch.current = 0;
    autoSpin.current.v = 0;
    setHover(null); // 镜头飞行期间屏幕投影失效，清掉悬停名牌
  };

  // 触发镜头飞行到选中天体（行星/卫星取星历实时坐标，飞行中每帧追踪）
  useEffect(() => {
    if (!selectedUid) return;
    const vec = resolveObjectPosition(selectedUid);
    if (!vec) return;
    releaseCamera(); // 镜头飞行优先：抢占陀螺仪等外部驱动
    beginFly(vec, selectedUid, 'object');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce, selectedUid]);

  // 搜索星座 → 镜头飞向星座质心；FOV 缩得很小时同步缓回 60° 看全貌
  useEffect(() => {
    if (constellationFocusNonce === 0) return;
    const abbr = useUniverse.getState().activeConstellation;
    if (!abbr) return;
    const info = getConstellationRenderData().byAbbr.get(abbr);
    if (!info) return;
    releaseCamera(); // 搜索星座飞行同样抢占外部驱动
    beginFly(info.centroid, null, 'constellation');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [constellationFocusNonce]);

  // 回到全景：复位 FOV，停止飞行/惯性（顺带退出陀螺仪等外部驱动）
  useEffect(() => {
    if (resetNonce === 0) return;
    releaseCamera();
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = 60;
    cam.updateProjectionMatrix();
    targetFov.current = 60;
    fly.current.active = false;
    inertia.current = false;
    velYaw.current = 0;
    velPitch.current = 0;
    pitch.current = 0.12;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce]);

  // 指针与滚轮交互
  useEffect(() => {
    const el = gl.domElement;
    const cam = camera as THREE.PerspectiveCamera;
    const sens = () => 0.0023 * (cam.fov / 60);
    // 触屏（粗指针）设备：整条 hover 管线不启用（无悬停语义，省电省算）
    const coarse = isCoarsePointer();
    const pointers = activePointers.current;

    /**
     * 统一拾取（渲染设计 §2.3 + 审计 §2.6）：遍历 pickEntries 投影到屏幕，
     * 命中半径内 score = 像素距离 - 类型 bias（行星 > 著名 DSO > DSO >
     * 亮星 > 暗星），取最小者。开头做相机前向点积预筛（实测 6.6×，
     * 0.57→0.086ms）：对角半 FOV + 3° 余量之外的条目直接跳过，免去矩阵投影；
     * 阈值按最小条目半径 0.99R 取保守值（卫星/小天体在 0.99R 球面），
     * 只会少筛不会误杀。radiusScale：点击 1.0；悬停 0.75（减少擦边误报）。
     */
    const pickAt = (clientX: number, clientY: number, radiusScale: number): string | null => {
      const rect = el.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      camDirV.set(0, 0, -1).applyQuaternion(cam.quaternion);
      const tanDiag =
        Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * Math.sqrt(1 + cam.aspect * cam.aspect);
      const cosLimit = Math.cos(Math.atan(tanDiag) + THREE.MathUtils.degToRad(3));
      // FOV 22–72 下 cosLimit 恒为正；防御性兜底（极端宽幅时退化为不预筛）
      const dotLimit = cosLimit > 0 ? cosLimit * SPHERE_RADIUS * 0.99 : -Infinity;
      let bestUid: string | null = null;
      let bestScore = Infinity;
      for (const entry of pickEntries) {
        const ev = entry.vec;
        if (ev.x * camDirV.x + ev.y * camDirV.y + ev.z * camDirV.z < dotLimit) continue;
        pickV.copy(ev).project(cam);
        if (pickV.z > 1) continue; // 背面剔除
        const sx = (pickV.x * 0.5 + 0.5) * rect.width;
        const sy = (-pickV.y * 0.5 + 0.5) * rect.height;
        const d = Math.hypot(sx - px, sy - py);
        if (d >= entry.radiusPx * radiusScale) continue;
        const score = d - entry.bias;
        if (score < bestScore) {
          bestScore = score;
          bestUid = entry.uid;
        }
      }
      return bestUid;
    };

    /** 清空悬停名牌并复原光标。 */
    const clearHover = () => {
      setHover(null);
      el.style.cursor = '';
    };

    /** 记录缩放锚点（NDC）：fov damp 帧内做角度补偿，光标/两指中点所指保持不动。 */
    const setAnchorNdc = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      anchor.current.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      anchor.current.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
      anchor.current.has = true;
    };

    /** 手动缩放/拖拽打断飞行：目标 FOV 从当前值接管，不回弹。 */
    const interruptFly = () => {
      if (!fly.current.active) return;
      fly.current.active = false;
      targetFov.current = cam.fov;
    };

    const onDown = (e: PointerEvent) => {
      releaseCamera(); // 手势互斥：用户一摸屏幕即退出陀螺仪指星，相机停留当前朝向
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // pointerdown 打断惯性滑行（审计 §2.1：任何按下即接管）
      inertia.current = false;
      velYaw.current = 0;
      velPitch.current = 0;
      autoSpin.current.v = 0;
      idleSince.current = performance.now();
      clearHover(); // 开始拖拽/点击即收起名牌
      el.setPointerCapture(e.pointerId);
      if (pointers.size === 2) {
        // ── 两指落下 → 进入捏合态（退出拖拽/惯性；本手势抬指不触发点选） ──
        interruptFly();
        dragging.current = false;
        pinching.current = true;
        moved.current = true;
        let p1: { x: number; y: number } | undefined;
        let p2: { x: number; y: number } | undefined;
        for (const p of pointers.values()) {
          if (!p1) p1 = p;
          else if (!p2) p2 = p;
        }
        if (p1 && p2) {
          pinchStart.current.dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
          pinchStart.current.fov = targetFov.current;
        }
      } else if (pointers.size === 1) {
        dragging.current = true;
        moved.current = false;
        lastX.current = e.clientX;
        lastY.current = e.clientY;
        lastMoveMs.current = performance.now();
      }
      // 第三指及以上：忽略（保持捏合态，以先落的两指为准）
    };

    const onMove = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (p) {
        p.x = e.clientX;
        p.y = e.clientY;
      }
      if (pinching.current) {
        // ── 双指捏合缩放（审计 §2.3）：距离比例 → 目标 FOV，锚点取两指中点 ──
        let p1: { x: number; y: number } | undefined;
        let p2: { x: number; y: number } | undefined;
        for (const q of pointers.values()) {
          if (!p1) p1 = q;
          else if (!p2) p2 = q;
        }
        if (!p1 || !p2) return;
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (dist > 1 && pinchStart.current.dist > 1) {
          targetFov.current = THREE.MathUtils.clamp(
            (pinchStart.current.fov * pinchStart.current.dist) / dist,
            FOV_MIN,
            FOV_MAX,
          );
        }
        setAnchorNdc((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
        idleSince.current = performance.now();
        regress(); // 交互期降载（配合 AdaptiveDpr）
        return;
      }
      if (!dragging.current) {
        // ── 悬停识别：40ms 节流拾取；节流间隙只挪坐标保持跟手 ──
        if (coarse) return;
        const now = performance.now();
        if (now - lastHoverPick.current >= HOVER_THROTTLE_MS && !fly.current.active) {
          lastHoverPick.current = now;
          const uid = pickAt(e.clientX, e.clientY, 0.75);
          // 命中当前选中天体时不显示名牌（信息卡已在展示）
          const sel = useUniverse.getState().selectedUid;
          const shown = uid && uid !== sel ? uid : null;
          setHover(shown, e.clientX, e.clientY);
          el.style.cursor = uid ? 'pointer' : '';
        } else if (getHover().uid) {
          setHover(getHover().uid, e.clientX, e.clientY);
        }
        return;
      }
      // ── 单指/鼠标拖拽：自记 lastX/lastY 求差（movementX 在 iOS 触摸恒 0、
      // Chrome 高 DPI 报物理像素，弃用），保持 1:1 直写跟手 ──
      const dx = e.clientX - lastX.current;
      const dy = e.clientY - lastY.current;
      lastX.current = e.clientX;
      lastY.current = e.clientY;
      if (!moved.current && Math.abs(dx) + Math.abs(dy) > 2) {
        moved.current = true;
        // 用户一拖动即解除星座钉住态，注视判定重新接管。
        clearPinnedConstellation();
      }
      interruptFly();
      const s = sens();
      const dYaw = -dx * s;
      const dPitch = -dy * s;
      yaw.current += dYaw;
      pitch.current = THREE.MathUtils.clamp(pitch.current + dPitch, -PITCH_LIMIT, PITCH_LIMIT);
      // 角速度低通采样（α≈0.3，审计 §2.1）：抬指后作为惯性初速；
      // dt 钳制防止事件间隔异常（首个事件/标签页切走再回）放大速度
      const now = performance.now();
      const dt = (now - lastMoveMs.current) / 1000;
      lastMoveMs.current = now;
      if (dt > 0.001 && dt < 0.25) {
        const alpha = 0.3;
        velYaw.current += alpha * (dYaw / dt - velYaw.current);
        velPitch.current += alpha * (dPitch / dt - velPitch.current);
      }
      idleSince.current = now;
      regress(); // 交互期降载（配合 AdaptiveDpr）
    };

    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      if (pinching.current) {
        if (pointers.size >= 2) return; // 三指场景收指：仍有两指，捏合继续
        pinching.current = false;
        let rest: { x: number; y: number } | undefined;
        for (const q of pointers.values()) rest = q;
        if (rest) {
          // 剩一指 → 回拖拽态（以剩余指当前位置为差值基准，避免视角跳变）
          dragging.current = true;
          lastX.current = rest.x;
          lastY.current = rest.y;
          lastMoveMs.current = performance.now();
          velYaw.current = 0;
          velPitch.current = 0;
        } else {
          dragging.current = false;
          idleSince.current = performance.now();
        }
        return;
      }
      if (dragging.current && !moved.current && e.type !== 'pointercancel') {
        const uid = pickAt(e.clientX, e.clientY, 1);
        if (uid) {
          selectStar(uid);
          playChime('select'); // 选中提示音（音频未由用户手势启动过则静默）
        } else {
          // 未命中任何天体 → 星座就近判定（屏幕空间点到连线段/质心距离，
          // 见 constellation-render.pickConstellationAt；仅星座层开启时）。
          const state = useUniverse.getState();
          const rect = el.getBoundingClientRect();
          const abbr = state.showConstellations
            ? pickConstellationAt(e.clientX - rect.left, e.clientY - rect.top, cam, rect)
            : null;
          if (abbr) state.selectConstellation(abbr);
          else selectStar(null); // 真点空处：沿用原语义（取消选中/解除钉住）
        }
      } else if (dragging.current && moved.current) {
        // ── 抬指进入惯性滑行：指尖停住 >80ms 再松（速度过期）或速度过低则直接静止 ──
        const stale = performance.now() - lastMoveMs.current > INERTIA_STALE_MS;
        const speed = Math.hypot(velYaw.current, velPitch.current);
        if (!stale && speed >= INERTIA_STOP && !getExternalPose().active) {
          inertia.current = true;
        } else {
          velYaw.current = 0;
          velPitch.current = 0;
          idleSince.current = performance.now();
        }
      }
      dragging.current = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // deltaMode 归一（审计 §2.2）：Firefox 行模式 deltaY≈3 → ×16 对齐像素模式；
      // ctrlKey 是触控板捏合手势的到达形态（deltaY 很小），×3 补灵敏度
      let dy = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      if (e.ctrlKey) dy *= 3;
      interruptFly(); // 手动缩放打断飞行（用户接管）
      targetFov.current = THREE.MathUtils.clamp(targetFov.current + dy * 0.03, FOV_MIN, FOV_MAX);
      // zoom-to-cursor（审计 §2.4）：锚点取光标；悬停清理挪到 fov 实际变化帧
      setAnchorNdc(e.clientX, e.clientY);
      idleSince.current = performance.now();
      // 交互期降载（配合 AdaptiveDpr）：仅真实用户输入。序曲的 fov 缓推走
      // 合成 WheelEvent（isTrusted=false，lib/overture.ts），若也 regress 会让
      // AdaptiveDpr 在开场镜头内反复闪变分辨率——观赏期画质优先。
      if (e.isTrusted) regress();
    };
    const onLeave = () => clearHover();

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('wheel', onWheel);
      pointers.clear();
      clearHover();
    };
  }, [gl, camera, selectStar, clearPinnedConstellation, regress]);

  useFrame((_, delta) => {
    const cam = camera as THREE.PerspectiveCamera;
    const f = fly.current;
    if (f.active) {
      // ── 飞行：大圆 slerp + 角距自适应时长 + zoom-out-in FOV 弧线 ──
      f.t += delta / f.dur;
      const e = easeInOutCubic(Math.min(f.t, 1));
      if (f.targetUid) {
        // 运动目标追踪：注册表同一 Vector3 引用，每帧重读零成本
        const vec = resolveObjectPosition(f.targetUid);
        if (vec) f.toDir.copy(vec).normalize();
      }
      slerpDir(f.fromDir, f.toDir, e, flyDirV);
      // yaw 展开到当前值 ±π 内：atan2 断线跨越时不绕远
      let ny = dirToYaw(flyDirV);
      while (ny - yaw.current > Math.PI) ny -= Math.PI * 2;
      while (ny - yaw.current < -Math.PI) ny += Math.PI * 2;
      yaw.current = ny;
      pitch.current = dirToPitch(flyDirV);
      const fov = lerp(f.fromFov, f.toFov, e) + f.bumpDeg * Math.sin(Math.PI * e);
      if (fov !== cam.fov) {
        cam.fov = fov;
        cam.updateProjectionMatrix();
      }
      if (f.t >= 1) {
        f.active = false;
        targetFov.current = f.toFov; // 滚轮目标与到达 FOV 对齐，下次缩放不跳变
        idleSince.current = performance.now();
        triggerArrivalPulse(); // 着陆脉冲（TargetHighlight 无选中目标时自然无感）
        playChime('arrive');
      }
    } else {
      // ── 平滑缩放：targetFov 指数逼近；变化帧内做锚点角度补偿 + 清悬停 ──
      const fovBefore = cam.fov;
      const needAnchor = anchor.current.has && Math.abs(targetFov.current - cam.fov) > 1e-3;
      let a0Yaw = 0;
      let a0Pitch = 0;
      if (needAnchor) {
        // 旧 fov 反投影锚点方向（必须在 damp 改 fov 前取，投影逆矩阵还是旧的）
        anchorV.set(anchor.current.x, anchor.current.y, 0.5).unproject(cam).normalize();
        a0Yaw = dirToYaw(anchorV);
        a0Pitch = dirToPitch(anchorV);
      }
      damp(cam, 'fov', targetFov.current, 0.16, delta);
      if (cam.fov !== fovBefore) {
        cam.updateProjectionMatrix();
        if (needAnchor) {
          // 新 fov 再反投影：两次角度差就是需要补偿的姿态量——光标所指保持在光标下
          anchorV.set(anchor.current.x, anchor.current.y, 0.5).unproject(cam).normalize();
          let dYaw = a0Yaw - dirToYaw(anchorV);
          if (dYaw > Math.PI) dYaw -= Math.PI * 2;
          else if (dYaw < -Math.PI) dYaw += Math.PI * 2;
          yaw.current += dYaw;
          pitch.current += a0Pitch - dirToPitch(anchorV);
        }
        // FOV 变化帧内旧屏幕投影失效 → 清悬停（滚轮/捏合两条路径统一在此）
        if (getHover().uid) {
          setHover(null);
          gl.domElement.style.cursor = '';
        }
      }
      if (getExternalPose().active) {
        // 陀螺仪等外部驱动（gyro 模块已做低通平滑，直写）
        const ext = getExternalPose();
        yaw.current = ext.yaw;
        pitch.current = ext.pitch;
      } else if (!dragging.current && !pinching.current) {
        if (inertia.current) {
          // ── 惯性滑行：v 指数衰减（λ≈5/s），撞俯仰限位该轴清零 ──
          yaw.current += velYaw.current * delta;
          pitch.current += velPitch.current * delta;
          const decay = Math.exp(-INERTIA_DECAY * delta);
          velYaw.current *= decay;
          velPitch.current *= decay;
          if (pitch.current >= PITCH_LIMIT || pitch.current <= -PITCH_LIMIT) {
            velPitch.current = 0;
          }
          if (Math.hypot(velYaw.current, velPitch.current) < INERTIA_STOP) {
            inertia.current = false;
            idleSince.current = performance.now(); // 停稳起点：2s 后自动旋转缓入
          }
        } else if (autoRotateRef.current) {
          // ── 自动旋转：静止满 2s 才 damp 缓入角速度（缓出同理），不突兀 ──
          const idleMs = performance.now() - idleSince.current;
          damp(
            autoSpin.current,
            'v',
            idleMs >= AUTO_RESUME_DELAY_MS ? AUTO_ROTATE_SPEED : 0,
            0.9,
            delta,
          );
          yaw.current += autoSpin.current.v * delta;
        }
      }
    }
    pitch.current = THREE.MathUtils.clamp(pitch.current, -PITCH_LIMIT, PITCH_LIMIT);
    cam.rotation.set(pitch.current, yaw.current, 0);
  });

  return null;
}
