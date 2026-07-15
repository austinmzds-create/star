/** astro-core 公共类型。 */

/** 三维直角坐标（用于把星体投影到天球，供 three.js 渲染）。 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 赤道坐标（度）。ra: 赤经 0–360，dec: 赤纬 -90–90。 */
export interface EquatorialCoord {
  /** 赤经，单位度（0–360）。 */
  raDeg: number;
  /** 赤纬，单位度（-90–90）。 */
  decDeg: number;
}

/** 地平坐标（度）。 */
export interface HorizontalCoord {
  /** 地平高度角，单位度（-90–90）。>0 表示地平线以上。 */
  altitudeDeg: number;
  /** 方位角，从正北起、向东为正，单位度（0–360）。 */
  azimuthDeg: number;
}

/** 观测者位置。 */
export interface ObserverLocation {
  /** 纬度，单位度，北纬为正。 */
  latitudeDeg: number;
  /** 经度，单位度，东经为正。 */
  longitudeDeg: number;
}

/** 八方位描述。 */
export interface CompassDirection {
  /** 方位角，单位度（0–360）。 */
  azimuthDeg: number;
  /** 中文方位，如「西南」。 */
  zh: string;
  /** 英文缩写方位，如「SW」。 */
  en: string;
}

/** 某一时刻某地对某星体的可见性快照。 */
export interface VisibilitySnapshot {
  /** 该时刻星体的地平坐标。 */
  horizontal: HorizontalCoord;
  /** 是否在地平线以上（altitude > 0）。 */
  isAboveHorizon: boolean;
  /** 方位描述。 */
  direction: CompassDirection;
}

/** 某地对某星体一整晚的观测概况。 */
export interface ObservationSummary {
  /** 从给定时刻起，下一次上中天（过子午线、达最高点）的时间。 */
  nextTransit: Date;
  /** 上中天时的最大高度角，单位度。 */
  maxAltitudeDeg: number;
  /** 是否拱极（全天不落）。 */
  isCircumpolar: boolean;
  /** 是否在该纬度永不升起。 */
  neverRises: boolean;
}
