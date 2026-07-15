/**
 * 内置兜底快照 —— DB 空且上游不可用时端点的最后防线（产品优雅降级）。
 *
 * 小天体：直接复用 @star/astro-ephem 的内置根数常量（JPL SBDB 抓取值，
 * 抓取命令与日期见 packages/astro-ephem/src/minorBodies.ts 的 sourceNote），
 * 单一事实源、零复制漂移。
 *
 * TLE：从 apps/web/src/lib/satellites/tles.ts 的快照原样搬来做 server 兜底
 * （Celestrak 抓取 2026-07-11，`curl 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE'`
 * 同法 48274 / 20580，两行原样粘贴，校验和均通过，绝非手编）。
 * ⚠ TLE 会过期（SGP4 数周后发散）——本快照仅兜底，运行时刷新为常态。
 */
import { getMinorBodyElements, listBuiltinMinorBodies } from '@star/astro-ephem';
import type { MinorBodyDto, MinorBodiesResponse, TleResponse, TleSatDto } from './feed.types';

/**
 * astro-ephem 内置 id → 本服务稳定 id 的对齐：
 * 彗星统一用编号（与运行时 SBDB 批量抓取的 id 口径一致），小行星保持小写英文名。
 */
const EPHEM_ID_TO_FEED_ID: Readonly<Record<string, string>> = {
  halley: '1P',
  encke: '2P',
  ponsbrooks: '12P',
  ceres: 'ceres',
  pallas: 'pallas',
  vesta: 'vesta',
};

/**
 * 内置小天体兜底（6 体：3 主带小行星 + 3 周期彗星），根数来自 astro-ephem 常量。
 * 固定用 listBuiltinMinorBodies（编译期闭集）：9C 起 listMinorBodies 含运行时
 * 动态注册体，兜底快照必须是确定性的内置基线。
 */
export function builtinMinorBodies(): MinorBodyDto[] {
  return listBuiltinMinorBodies().map((meta) => {
    const el = getMinorBodyElements(meta.id);
    return {
      id: EPHEM_ID_TO_FEED_ID[meta.id] ?? meta.id,
      name: meta.nameEn,
      nameZh: meta.nameZh,
      kind: meta.kind,
      epochJd: el.epochJd,
      e: el.e,
      aAu: el.aAu,
      iDeg: el.iDeg,
      omDeg: el.omegaDeg,
      wDeg: el.wDeg,
      maDeg: el.m0Deg,
    };
  });
}

/** 内置小天体兜底响应（updatedAt = 根数常量最后一次抓取日 2026-07-15，见 sourceNote）。 */
export function builtinMinorBodiesResponse(): MinorBodiesResponse {
  return {
    updatedAt: '2026-07-15T00:00:00.000Z',
    source: 'jpl-sbdb',
    bodies: builtinMinorBodies(),
  };
}

/** 内置 TLE 兜底（Celestrak 快照 2026-07-11，与 web 侧 tles.ts 同一批次原样粘贴）。 */
export const BUILTIN_TLE_SATS: readonly TleSatDto[] = [
  {
    id: 'SAT-ISS',
    name: 'ISS (ZARYA)',
    nameZh: '国际空间站',
    l1: '1 25544U 98067A   26192.31485778  .00005525  00000+0  10843-3 0  9998',
    l2: '2 25544  51.6302 180.6822 0006688 282.4935  77.5305 15.48978902575497',
  },
  {
    id: 'SAT-TIANGONG',
    name: 'CSS (TIANHE)',
    nameZh: '天宫空间站',
    l1: '1 48274U 21035A   26192.36900667  .00001415  00000+0  22608-4 0  9995',
    l2: '2 48274  41.4687 175.0236 0002483 288.9992  71.0577 15.58018409296943',
  },
  {
    id: 'SAT-HST',
    name: 'Hubble Space Telescope',
    nameZh: '哈勃空间望远镜',
    l1: '1 20580U 90037B   26192.32864100  .00004115  00000+0  12587-3 0  9994',
    l2: '2 20580  28.4732 275.5444 0002064  68.2345 291.8470 15.31034980792276',
  },
];

/** 内置 TLE 兜底响应（updatedAt = 快照抓取日 2026-07-11）。 */
export function builtinTleResponse(): TleResponse {
  return {
    updatedAt: '2026-07-11T00:00:00.000Z',
    source: 'celestrak',
    sats: BUILTIN_TLE_SATS.map((s) => ({ ...s })),
  };
}
