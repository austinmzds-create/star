/**
 * @star/astro-ephem
 *
 * 太阳/月亮/八大行星实时星历（astronomy-engine，MIT）。
 * web / api 双端源码消费；小程序不依赖本包，astro-core 保持零依赖。
 *
 * 仅需元数据（名字/颜色/别名）时请走 '@star/astro-ephem/bodies' 子入口，
 * 避免把 astronomy-engine 拖进首包。
 */

export * from './bodies';
export * from './ephemeris';
export * from './events';
export * from './minorBodies';
