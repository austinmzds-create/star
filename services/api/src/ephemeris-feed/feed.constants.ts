/**
 * 星历订阅（ephemeris-feed）配置常量。
 *
 * 上游礼仪（约束，勿放宽）：
 * - JPL SBDB：文档无硬 rate limit，礼貌频率每日一次（cron 04:00）；
 * - Celestrak：官方 usage policy 源数据每 2h 更新一次、「同一数据每次更新只下载一次」，
 *   超限返回 403、屡犯封 IP —— 服务端集中拉取间隔硬编码 ≥6h + If-Modified-Since。
 */

/** BullMQ 队列名（有 Redis 时的 repeatable job 载体）。 */
export const FEED_QUEUE = 'ephemeris-feed';
/** 任务名：每日彗星/小行星根数刷新。 */
export const JOB_REFRESH_MINOR_BODIES = 'refresh-minor-bodies';
/** 任务名：TLE 刷新。 */
export const JOB_REFRESH_TLE = 'refresh-tle';

/** 彗星刷新 cron：每日 04:00（服务器本地时区）。 */
export const MINOR_BODIES_CRON = '0 4 * * *';
/** 无 Redis 退化模式下的彗星刷新间隔（24h，不保证 04:00 对齐，仅保证每日一次）。 */
export const MINOR_BODIES_INTERVAL_MS = 24 * 3600 * 1000;
/** TLE 刷新间隔（硬编码 ≥6h，尊重 Celestrak 2h 更新节奏）。 */
export const TLE_INTERVAL_MS = 6 * 3600 * 1000;

/** 现役亮彗星过滤：总星等参数 M1 上限。 */
export const COMET_M1_MAX = 12;
/** 现役亮彗星过滤：|tp − now| 窗口（天，±2 儒略年）。 */
export const COMET_TP_WINDOW_DAYS = 730.5;
/** 永久保留白名单（按周期彗星编号）：哈雷/恩克/庞斯-布鲁克斯——现有产品叙事天体。 */
export const COMET_WHITELIST: readonly string[] = ['1P', '2P', '12P'];

/**
 * JPL SBDB 批量彗星查询（全部彗星一次 JSON 返回，full-prec 全精度）。
 * fields 顺序与解析器无耦合：解析器按 fields 数组动态定位列。
 */
export const SBDB_QUERY_URL =
  'https://ssd-api.jpl.nasa.gov/sbdb_query.api?sb-kind=c&full-prec=true&fields=full_name,e,q,a,i,om,w,tp,ma,epoch,M1,M2';

/** JPL SBDB 单体接口（Ceres/Pallas/Vesta 沿用现有单体口径）。 */
export const sbdbSingleUrl = (sstr: string): string =>
  `https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=${encodeURIComponent(sstr)}&full-prec=true`;

/** 保留的小行星单体目标（与 @star/astro-ephem 内置三大主带小行星一致）。 */
export const ASTEROID_TARGETS: readonly { sstr: string; id: string; nameZh: string }[] = [
  { sstr: '1', id: 'ceres', nameZh: '谷神星' },
  { sstr: '2', id: 'pallas', nameZh: '智神星' },
  { sstr: '4', id: 'vesta', nameZh: '灶神星' },
];

/** Celestrak GP API（按 NORAD 目录号取 TLE）。 */
export const celestrakGpUrl = (noradId: number): string =>
  `https://celestrak.org/NORAD/elements/gp.php?CATNR=${noradId}&FORMAT=TLE`;

/**
 * Celestrak GP API（按预定义组名取整组 TLE，一次返回数千颗）。
 * 与逐颗 CATNR 拉取同域名同礼仪：并入同一 6h 节流锚点，绝不高频重复拉。
 */
export const celestrakGroupUrl = (group: string): string =>
  `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=TLE`;

/** 星链组名（Celestrak 组标识）。 */
export const STARLINK_GROUP = 'starlink';
/**
 * 星链服务端择优截断硬上限：整组数千颗按 TLE 历元最新排序取前 N。
 * 与前端性能预算（deviceTier）对齐——high 全取、mid 再降半、low 不挂层。
 */
export const STARLINK_MAX = 120;

/** TLE 目标组（NORAD id 与 web 卫星 uid 对齐）。 */
export const TLE_TARGETS: readonly { id: string; noradId: number; nameZh: string }[] = [
  { id: 'SAT-ISS', noradId: 25544, nameZh: '国际空间站' },
  { id: 'SAT-TIANGONG', noradId: 48274, nameZh: '天宫空间站' },
  { id: 'SAT-HST', noradId: 20580, nameZh: '哈勃空间望远镜' },
];

/**
 * 已收录公认中文名的彗星（键 = 编号/临时编号 designation）。
 * 数据纪律：只登记有公认中文译名的天体，其余省略 nameZh，绝不机器编造。
 */
export const COMET_NAME_ZH: Readonly<Record<string, string>> = {
  '1P': '哈雷彗星',
  '2P': '恩克彗星',
  '12P': '庞斯-布鲁克斯彗星',
  'C/2023 A3': '紫金山-阿特拉斯彗星',
};

/** 上游请求超时（ms）。 */
export const FETCH_TIMEOUT_MS = 60_000;
/** 重试退避间隔（ms）：共 1 + N 次尝试。测试可注入覆盖。 */
export const RETRY_DELAYS_MS: readonly number[] = [1_000, 5_000];
