/**
 * 找星纯逻辑：角差、状态判定、引导文案。无 wx / DOM 依赖，便于 typecheck 与将来单测。
 * 方位/高度的天文计算复用 @star/astro-core（单一真源，多端一致）。
 */

/**
 * 最短有符号角差，落在 (-180, 180]。
 * 正值 = 目标在当前朝向的顺时针（右）方向；负值 = 逆时针（左）。
 */
export function shortestAngleDiff(targetDeg: number, currentDeg: number): number {
  return ((((targetDeg - currentDeg) % 360) + 540) % 360) - 180;
}

export type FindStatus =
  | 'loading' // 拉取纪念星 / 等定位
  | 'permissionDenied' // 拒绝定位授权
  | 'noCompass' // 无罗盘 / 精度差
  | 'belowHorizon' // 此刻在地平线下（含 neverRises）
  | 'searching' // 引导中
  | 'aligned'; // 已对准 / 找到

export interface Guidance {
  status: FindStatus;
  /** 需要转动的有符号角度（正=右，负=左），取整后的绝对值用于文案。 */
  deltaAz: number;
  turn: 'left' | 'right' | 'none';
  targetAltDeg: number;
  /** 有设备俯仰数据时的高度差（正=需抬高）。 */
  deltaAlt?: number;
  tiltHint: 'up' | 'down' | 'none';
  /** 主引导文案，如「向右转 42°」。 */
  headlineZh: string;
  /** 副提示，如「抬高手机至 25° 天空」。 */
  subHintZh: string;
  /** 目标方位中文，如「西南偏西」。 */
  directionZh: string;
}

/** 方位对准阈值（度）。 */
export const ALIGN_AZ_DEG = 5;
/** 高度对准阈值（度，仅在有设备俯仰数据时判定）。 */
export const ALIGN_ALT_DEG = 8;

export interface GuidanceInput {
  /** 目标方位角（0–360，正北起向东为正）。 */
  targetAz: number;
  /** 目标高度角（度）。 */
  targetAlt: number;
  /** 当前设备朝向（罗盘 direction，0–360）。 */
  heading: number;
  /** 当前设备俯仰（度，可选；无则不做实时高度对比）。 */
  currentPitch?: number;
  isAboveHorizon: boolean;
  neverRises: boolean;
  /** 目标方位中文（来自 astro-core direction.zh）。 */
  directionZh: string;
  /** 纪念名，用于对准文案。 */
  memorialName: string;
  /** 若在地平线下，可传最佳观测提示补充到副文案。 */
  belowHorizonHintZh?: string;
}

/**
 * 组装引导。判定优先级：
 * neverRises → belowHorizon；!isAboveHorizon → belowHorizon；
 * 对准 → aligned；否则 searching。
 */
export function computeGuidance(input: GuidanceInput): Guidance {
  const {
    targetAz,
    targetAlt,
    heading,
    currentPitch,
    isAboveHorizon,
    neverRises,
    directionZh,
    memorialName,
    belowHorizonHintZh,
  } = input;

  const deltaAz = shortestAngleDiff(targetAz, heading);
  const hasPitch = typeof currentPitch === 'number';
  const deltaAlt = hasPitch ? targetAlt - (currentPitch as number) : undefined;

  const base = {
    deltaAz,
    targetAltDeg: targetAlt,
    directionZh,
    ...(deltaAlt !== undefined ? { deltaAlt } : {}),
  };

  // 1. 永不升起
  if (neverRises) {
    return {
      ...base,
      status: 'belowHorizon',
      turn: 'none',
      tiltHint: 'none',
      headlineZh: '这颗星此刻在地平线以下',
      subHintZh:
        belowHorizonHintZh ??
        '在你所在的纬度当前季节它不会升起，换个时间或地点再来找它',
    };
  }

  // 2. 当前在地平线下
  if (!isAboveHorizon) {
    return {
      ...base,
      status: 'belowHorizon',
      turn: 'none',
      tiltHint: 'none',
      headlineZh: '这颗星此刻在地平线以下',
      subHintZh: belowHorizonHintZh ?? '换个时间再来，它会升起',
    };
  }

  const azAligned = Math.abs(deltaAz) <= ALIGN_AZ_DEG;
  const altAligned =
    deltaAlt === undefined ? true : Math.abs(deltaAlt) <= ALIGN_ALT_DEG;

  // 3. 已对准
  if (azAligned && altAligned) {
    return {
      ...base,
      status: 'aligned',
      turn: 'none',
      tiltHint: 'none',
      headlineZh: '就是这里！',
      subHintZh: `「${memorialName}」正对着你`,
    };
  }

  // 4. 引导中
  const turn: 'left' | 'right' = deltaAz > 0 ? 'right' : 'left';
  const turnZh = turn === 'right' ? '右' : '左';
  const headlineZh = azAligned
    ? '方向已对准'
    : `向${turnZh}转 ${Math.abs(Math.round(deltaAz))}°`;

  let tiltHint: 'up' | 'down' | 'none' = 'none';
  let subHintZh = `目标在${directionZh}，高度 ${Math.round(targetAlt)}°`;
  if (deltaAlt !== undefined && !altAligned) {
    tiltHint = deltaAlt > 0 ? 'up' : 'down';
    subHintZh = `${tiltHint === 'up' ? '抬高' : '降低'}手机至 ${Math.round(
      targetAlt,
    )}° 天空`;
  } else if (deltaAlt === undefined) {
    subHintZh = `抬头至约 ${Math.round(targetAlt)}° 高度的天空`;
  }

  return {
    ...base,
    status: 'searching',
    turn,
    tiltHint,
    headlineZh,
    subHintZh,
  };
}
