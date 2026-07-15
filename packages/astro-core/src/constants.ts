/** 角度/弧度换算与天文常量。 */

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

/** J2000.0 历元对应的儒略日。 */
export const JD_J2000 = 2451545.0;

/** Unix 纪元（1970-01-01T00:00:00Z）对应的儒略日。 */
export const JD_UNIX_EPOCH = 2440587.5;

/** 一个儒略世纪的天数。 */
export const DAYS_PER_JULIAN_CENTURY = 36525.0;

/** 恒星时相对太阳时的推进速率（度/太阳小时）。 */
export const SIDEREAL_DEG_PER_HOUR = 360.98564736629 / 24;

/** 一天的毫秒数。 */
export const MS_PER_DAY = 86_400_000;

/** 一小时的毫秒数。 */
export const MS_PER_HOUR = 3_600_000;
