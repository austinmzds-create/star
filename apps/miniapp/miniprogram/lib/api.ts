import { requestJson } from './request';

/**
 * 数据层：把后端「公开纪念页」契约（GET /api/memorial/public/:slug）
 * 转成小程序 UI 友好形状，并在无后端/失败时回退到内置示例星。
 * 线上契约以 services/api memorial.service.ts toPublicView + findPublicBySlug 为准。
 */

// ─────────────────────────── 合规文案（逐字与后端 common/compliance.ts 一致，不得改） ───────────────────────────
export const COMPLIANCE_NOTICE =
  '本服务为基于真实星体坐标的私人纪念命名登记，仅具纪念意义，不代表国际天文学联合会（IAU）或任何官方机构的命名，不构成对该星体的任何权属。';

// ─────────────────────────── 场景码表（与后端 OccasionType 枚举一致，同 web） ───────────────────────────
export type OccasionCode =
  | 'LOVE'
  | 'BIRTHDAY'
  | 'WEDDING'
  | 'GRADUATION'
  | 'NEWBORN'
  | 'PET_MEMORIAL'
  | 'IN_MEMORIAM'
  | 'OTHER';

const OCCASION_CODE_TO_LABEL: Record<OccasionCode, string> = {
  LOVE: '情侣纪念',
  BIRTHDAY: '生日',
  WEDDING: '婚礼',
  GRADUATION: '毕业',
  NEWBORN: '宝宝出生',
  PET_MEMORIAL: '宠物纪念',
  IN_MEMORIAM: '逝者纪念',
  OTHER: '其他',
};

/** 枚举码转中文标签；未知码原样返回（向前兼容后端新增场景）。 */
export function occasionCodeToLabel(code: string): string {
  return OCCASION_CODE_TO_LABEL[code as OccasionCode] ?? code;
}

// ─────────────────────────── 线上契约类型（镜像后端 body） ───────────────────────────

/** 登记时刻的星体快照子集（公开视图无 distanceLy）。 */
export interface StarSnapshot {
  objectUid: string;
  nameZh: string;
  nameEn: string;
  constellationZh: string;
  raDeg: number;
  decDeg: number;
  magnitude: number;
}

interface WireCertificate {
  status: 'READY';
  certUrl: string;
  starMapUrl: string;
}

interface WirePublicResponse {
  memorial: {
    registrationNo: string;
    memorialName: string;
    occasionType: string;
    memorialDate: string | null;
    blessingText: string | null;
    storyText: string | null;
    createdAt: string;
    star: StarSnapshot;
    certificate: WireCertificate | null;
  };
  compliance: string;
}

// ─────────────────────────── UI 形状 ───────────────────────────

export interface CertificateAssets {
  certUrl: string;
  starMapUrl: string;
}

/** 纪念视图（小程序各页统一消费的形状）。 */
export interface MemorialView {
  /** 用于回链与分享的公开 slug（后端 body 不含，由请求参数回填）。 */
  publicSlug: string;
  registrationNo: string;
  memorialName: string;
  /** 中文场景标签（已映射）。 */
  occasion: string;
  memorialDate: string | null;
  /** 祝福语。 */
  blessing: string | null;
  /** 故事/宇宙来信文本（本期详情页仅展示已落库文本）。 */
  story: string | null;
  createdAt: string;
  certificate: CertificateAssets | null;
  star: StarSnapshot;
  compliance: string;
}

/** 加载结果：live = 来自后端；demo = 内置示例回退。 */
export interface LoadResult {
  mode: 'live' | 'demo';
  view: MemorialView;
}

// ─────────────────────────── 内置示例星（无后端时降级；天狼星坐标真实，找星逻辑可跑） ───────────────────────────

const DEMO_VIEW: MemorialView = {
  publicSlug: 'demo',
  registrationNo: 'STAR-20260711-DEMO',
  memorialName: '我们的星',
  occasion: '情侣纪念',
  memorialDate: '2026-07-11',
  blessing: '愿这束光，年复一年照亮我们。',
  story: null,
  createdAt: '2026-07-11T00:00:00.000Z',
  certificate: null,
  star: {
    objectUid: 'hip-32349',
    nameZh: '天狼星',
    nameEn: 'Sirius',
    constellationZh: '大犬座',
    raDeg: 101.287,
    decDeg: -16.716,
    magnitude: -1.46,
  },
  compliance: COMPLIANCE_NOTICE,
};

/** 返回一份示例视图副本（避免调用方意外修改共享对象）。 */
export function demoView(): MemorialView {
  return { ...DEMO_VIEW, star: { ...DEMO_VIEW.star } };
}

// ─────────────────────────── 主查询 ───────────────────────────

function toView(slug: string, wire: WirePublicResponse): MemorialView {
  const m = wire.memorial;
  return {
    publicSlug: slug,
    registrationNo: m.registrationNo,
    memorialName: m.memorialName,
    occasion: occasionCodeToLabel(m.occasionType),
    memorialDate: m.memorialDate,
    blessing: m.blessingText,
    story: m.storyText,
    createdAt: m.createdAt,
    certificate: m.certificate
      ? { certUrl: m.certificate.certUrl, starMapUrl: m.certificate.starMapUrl }
      : null,
    star: m.star,
    // 后端 compliance 与本地常量逐字一致；优先用后端返回，缺失则兜底本地常量。
    compliance: wire.compliance || COMPLIANCE_NOTICE,
  };
}

/**
 * 加载公开纪念视图。
 * - 有 slug 且后端配置可用 → 尝试拉取，失败回退 demo；
 * - 仅有 no（登记编号）→ 无对应公开接口，直接 demo 回退；
 * - 无任何标识 → demo。
 */
export async function getPublicMemorial(params: {
  slug?: string;
  no?: string;
}): Promise<LoadResult> {
  const slug = params.slug?.trim();
  if (!slug) {
    // 仅有编号或无标识：公开接口以 slug 为键，无法直查 → 演示回退。
    return { mode: 'demo', view: demoView() };
  }

  const res = await requestJson<WirePublicResponse>(
    `/api/memorial/public/${encodeURIComponent(slug)}`,
  );
  if (res.ok && res.data && res.data.memorial) {
    return { mode: 'live', view: toView(slug, res.data) };
  }
  return { mode: 'demo', view: demoView() };
}
