/**
 * API 客户端：apps/web 与 services/api 之间的唯一通信层。
 *
 * 设计原则：
 * 1. 「是否有后端」的判断全部收敛在本文件——未配置基址、网络错误、超时、
 *    非 2xx、JSON 解析失败，任何一种情况都优雅回退，
 *    绝不向 UI 抛出异常（纪念场景产品，体验必须温柔）。
 * 2. 本文件不依赖 React，可同时被服务端组件与客户端组件 import。
 * 3. 线上契约以 services/api 实际实现为准（见 docs/api-spec.md）：
 *    - 成功响应无信封，body 即资源对象（如 { registration, compliance }）；
 *    - 失败响应为 { code, message, details? }，HTTP 状态按错误码映射；
 *    - 纪念场景走 OccasionType 英文枚举码，中文标签仅为展示层映射（见下方码表）。
 *    本文件负责「UI 友好形状 ↔ 线上契约形状」的双向转换，UI 层不感知枚举码。
 */

/** 请求超时（毫秒）。纪念登记是情绪时刻，宁可快速回退演示模式也不让用户干等。 */
const REQUEST_TIMEOUT_MS = 8000;

// ─────────────────────────── 场景码表（与 services/api OccasionType 枚举一致） ───────────────────────────

/** 后端 OccasionType 枚举码（DB 存码，中文仅为展示层映射）。 */
export type OccasionCode =
  | 'LOVE'
  | 'BIRTHDAY'
  | 'WEDDING'
  | 'GRADUATION'
  | 'NEWBORN'
  | 'PET_MEMORIAL'
  | 'IN_MEMORIAM'
  | 'OTHER';

/** 中文标签 → 枚举码（与 MemorialModal 的 OCCASIONS 选项一一对应）。 */
const OCCASION_LABEL_TO_CODE: Record<string, OccasionCode> = {
  情侣纪念: 'LOVE',
  生日: 'BIRTHDAY',
  婚礼: 'WEDDING',
  毕业: 'GRADUATION',
  宝宝出生: 'NEWBORN',
  宠物纪念: 'PET_MEMORIAL',
  逝者纪念: 'IN_MEMORIAM',
  其他: 'OTHER',
};

/** 枚举码 → 中文标签（公开纪念页展示用）。 */
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

/** 中文场景标签转枚举码；未知标签兜底 OTHER（后端枚举校验拒绝任意自由文本）。 */
function occasionLabelToCode(label: string): OccasionCode {
  return OCCASION_LABEL_TO_CODE[label] ?? 'OTHER';
}

/** 枚举码转中文标签；未知码原样返回（向前兼容后端新增场景）。 */
function occasionCodeToLabel(code: string): string {
  return OCCASION_CODE_TO_LABEL[code as OccasionCode] ?? code;
}

// ─────────────────────────── UI 层类型（保持中文友好形状，UI 不感知枚举码） ───────────────────────────

/** 创建纪念登记的输入（UI 形状）。star 快照由后端根据 objectUid 从目录回填，前端只传 uid。 */
export interface CreateMemorialRegistrationInput {
  /** 星体唯一标识，来自 @star/astro-data 的 CelestialObject.objectUid */
  objectUid: string;
  /** 纪念场景中文标签（情侣纪念/生日/...），发送前会映射为 OccasionType 枚举码 */
  occasion: string;
  /** 星星纪念名，1-40 字；调用方需保证非空（Modal 侧空串已用「{nameZh}的纪念星」兜底） */
  memorialName: string;
  /** 纪念日期，ISO 8601 日期（YYYY-MM-DD），可选 */
  memorialDate?: string;
  /** 祝福语，<= 140 字，可选 */
  blessing?: string;
}

/** 创建成功的响应（UI 形状）。 */
export interface MemorialRegistrationResult {
  /** 服务端生成的纪念编号，格式 STAR-YYYYMMDD-XXXX（与演示模式格式一致，便于回退无感） */
  registrationNo: string;
  /** 公开纪念页 slug，用于 /m/[slug] */
  publicSlug: string;
  /** 登记状态：ACTIVE 生效；PENDING_REVIEW 命中审核待复核（公开页暂不可见） */
  status: 'ACTIVE' | 'PENDING_REVIEW' | 'REJECTED';
  /** ISO 8601 创建时间 */
  createdAt: string;
}

/**
 * 证书 / 星图资产（UI 形状）。仅当后端证书已「就绪」时才出现，否则整体为 null。
 * URL 由后端存储层给出且为浏览器可直接加载的绝对地址：
 * 本地存储 = `http(s)://<host>/api/assets/...`；阿里云 OSS = 短时签名直链。
 * 因此前端无需再拼接 API 基址，直接用于 <img src> 与下载链接。
 */
export interface CertificateAssets {
  /** 纪念证书图（SVG 或 PNG，取决于后端是否有 sharp 栅格化环境） */
  certUrl: string;
  /** 局部天区星图 */
  starMapUrl: string;
}

/** 公开纪念页视图（UI 形状）。star 为登记时刻的目录快照（后端持久化，避免目录变更影响历史页面）。 */
export interface PublicMemorialView {
  registrationNo: string;
  publicSlug: string;
  memorialName: string;
  /** 纪念场景中文标签（已从枚举码映射） */
  occasion: string;
  memorialDate: string | null;
  blessing: string | null;
  createdAt: string;
  /** 证书/星图资产；未生成或未就绪时为 null（页面据此决定是否展示证书区块） */
  certificate: CertificateAssets | null;
  /** 登记时刻的星体快照子集 */
  star: {
    objectUid: string;
    nameZh: string;
    nameEn: string;
    constellationZh: string;
    raDeg: number;
    decDeg: number;
    magnitude: number | null;
    /** 快照不含距离；由前端本地目录按 objectUid 补充，仅用于展示 */
    distanceLy: number | null;
  };
}

// ─────────────────────────── 线上契约类型（与 services/api 响应逐字段对齐） ───────────────────────────

/** 失败响应 envelope（全局异常过滤器统一形状）。 */
interface WireErrorBody {
  code?: string;
  message?: string;
  details?: unknown;
}

/** 登记时刻的星体快照（MemorialService.StarSnapshot 的镜像）。 */
interface WireStarSnapshot {
  objectUid: string;
  nameZh: string;
  nameEn: string;
  constellationZh: string;
  raDeg: number;
  decDeg: number;
  magnitude: number;
}

/** POST /api/memorial/registrations 成功 body。 */
interface WireCreateResponse {
  registration: {
    registrationNo: string;
    publicSlug: string;
    status: 'ACTIVE' | 'PENDING_REVIEW' | 'REJECTED';
    memorialName: string;
    occasionType: string;
    memorialDate: string | null;
    blessingText: string | null;
    createdAt: string;
    star: WireStarSnapshot;
  };
  compliance: string;
}

/** 公开视图内嵌的证书资产（CertificateService.getPublicAssets 的镜像）。未就绪时后端返回 null。 */
interface WirePublicCertificate {
  status: 'READY';
  certUrl: string;
  starMapUrl: string;
}

/** GET /api/memorial/public/:slug 成功 body。 */
interface WirePublicResponse {
  memorial: {
    registrationNo: string;
    memorialName: string;
    occasionType: string;
    memorialDate: string | null;
    blessingText: string | null;
    storyText: string | null;
    createdAt: string;
    star: WireStarSnapshot;
    /** 已就绪的证书/星图；未生成或未就绪为 null（或旧后端不返回此字段 → undefined） */
    certificate?: WirePublicCertificate | null;
  };
  compliance: string;
}

// ─────────────────────────── 基址与配置 ───────────────────────────

/**
 * 取 API 基址；未配置（或为空串）视为纯前端演示模式。
 * 服务端优先内网地址 API_BASE_URL；NEXT_PUBLIC_ 前缀保证在客户端 bundle 里被内联。
 */
export function getApiBaseUrl(): string | null {
  const base =
    (typeof window === 'undefined' ? process.env.API_BASE_URL : undefined) ??
    process.env.NEXT_PUBLIC_API_BASE_URL;
  const trimmed = base?.trim();
  return trimmed ? trimmed.replace(/\/+$/, '') : null;
}

/** 是否已配置后端 API（false = 纯前端演示模式）。 */
export function isApiConfigured(): boolean {
  return getApiBaseUrl() !== null;
}

// ─────────────────────────── 低层请求封装 ───────────────────────────

/** API 错误归一：HTTP 非 2xx / 网络异常 / 解析失败，统一为此类型。 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Next.js 扩展了 RequestInit（fetch 缓存指令），本地收窄以通过 strict 检查。 */
interface NextFetchInit extends RequestInit {
  next?: { revalidate?: number };
}

/**
 * 低层请求：拼接基址、附带超时，任何异常统一抛 ApiError，由高层出口捕获转成回退。
 * 成功（2xx）时 body 即资源对象（后端无成功信封）；失败时尽力解析
 * { code, message } 错误 envelope 以保留错误码。调用前必须确认 isApiConfigured() 为 true。
 */
async function request<T>(path: string, init?: NextFetchInit): Promise<T> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new ApiError('NOT_CONFIGURED', '未配置 API 基址');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
    });
    if (!res.ok) {
      // 失败 body 为 { code, message, details? }；解析失败则退回 HTTP 状态码
      const errBody = (await res.json().catch(() => null)) as WireErrorBody | null;
      throw new ApiError(
        errBody?.code ?? `HTTP_${res.status}`,
        errBody?.message ?? `请求失败：${res.status}`,
      );
    }
    return (await res.json()) as T;
  } catch (err) {
    // 网络错误 / AbortError / JSON 解析失败等，全部归一为 ApiError
    if (err instanceof ApiError) throw err;
    throw new ApiError('NETWORK', err instanceof Error ? err.message : '网络异常');
  } finally {
    clearTimeout(timer);
  }
}

/** 生成幂等键：优先 crypto.randomUUID（浏览器安全上下文与 Node 22 原生支持），退化为时间戳随机串。 */
function makeIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─────────────────────────── 演示模式 ───────────────────────────

/**
 * 演示模式编号生成：与后端 registrationNo 同格式（STAR-YYYYMMDD-XXXX），
 * 保证回退时用户无感。从 MemorialModal 迁移至此，逻辑不变。
 */
export function makeDemoRegistrationNo(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .toUpperCase()
    .padStart(4, '0');
  return `STAR-${y}${m}${d}-${rand}`;
}

// ─────────────────────────── 高层出口（永不 throw） ───────────────────────────

/** 创建结果判别联合：live = 服务端真实登记；demo = 本地演示回退。 */
export type CreateRegistrationOutcome =
  | { mode: 'live'; data: MemorialRegistrationResult }
  | { mode: 'demo'; data: { registrationNo: string } };

/**
 * 创建纪念登记。
 * 未配置 API 基址、或请求失败（网络/超时/校验/服务端异常），一律优雅回退演示模式，
 * 保持既有纯前端行为。不做自动重试（避免重复登记），幂等键先埋好供后端选用。
 */
export async function createMemorialRegistration(
  input: CreateMemorialRegistrationInput,
): Promise<CreateRegistrationOutcome> {
  if (!isApiConfigured()) {
    return { mode: 'demo', data: { registrationNo: makeDemoRegistrationNo() } };
  }
  try {
    // UI 形状 → 后端 DTO 形状（CreateRegistrationDto）：字段名与枚举码在此转换
    const body = {
      starObjectUid: input.objectUid,
      memorialName: input.memorialName,
      occasionType: occasionLabelToCode(input.occasion),
      ...(input.memorialDate ? { memorialDate: input.memorialDate } : {}),
      ...(input.blessing ? { blessingText: input.blessing } : {}),
    };
    const res = await request<WireCreateResponse>('/api/memorial/registrations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': makeIdempotencyKey(),
      },
      body: JSON.stringify(body),
    });
    const reg = res.registration;
    return {
      mode: 'live',
      data: {
        registrationNo: reg.registrationNo,
        publicSlug: reg.publicSlug,
        status: reg.status,
        createdAt: reg.createdAt,
      },
    };
  } catch (err) {
    // 后端不可达 → 回退演示模式；仅开发环境提示，生产静默
    if (process.env.NODE_ENV === 'development') {
      console.warn('[api] 创建纪念登记失败，已回退演示模式：', err);
    }
    return { mode: 'demo', data: { registrationNo: makeDemoRegistrationNo() } };
  }
}

// ─────────────────────────── 宇宙来信（Agent Skill: cosmic-letter） ───────────────────────────

/** 生成宇宙来信的输入（UI 形状）。occasion 传中文标签，发送前映射为 OccasionType 枚举码。 */
export interface CosmicLetterInput {
  /** 星体中文名（CelestialObject.nameZh），1-40 字 */
  starNameZh: string;
  /** 星座中文名（CelestialObject.constellationZh） */
  constellationZh: string;
  /** 纪念场景中文标签（与 MemorialModal 的 OCCASIONS 一致） */
  occasion: string;
  /** 星星纪念名 / 命名，1-60 字 */
  memorialName: string;
  /** 纪念对象称呼，可选（如「亲爱的阿离」的「阿离」） */
  relationTo?: string;
  /** 期望语气，可选 */
  tone?: 'gentle' | 'warm' | 'solemn' | 'hopeful';
}

/** 宇宙来信结果。mode：llm=真实模型；template=后端模板降级；demo=前端本地模板（后端不可达）。 */
export interface CosmicLetterResult {
  letter: string;
  mode: 'llm' | 'template' | 'demo';
}

/** POST /api/agent/skills/cosmic-letter/run 成功 body。 */
interface WireCosmicLetterResponse {
  letter: string;
  mode: 'llm' | 'template';
  taskNo?: string;
}

/**
 * 前端本地来信模板（演示模式/后端不可达时回退）。
 * 与 services/api 的 cosmic-letter.skill.ts 分场景模板同构，措辞保持「登记/安放/纪念」，
 * 绝不出现「官方命名/IAU/购买星星/永久产权」。120–200 字，克制温柔。
 */
function renderCosmicLetterTemplate(input: CosmicLetterInput): string {
  const code = occasionLabelToCode(input.occasion);
  const star = input.starNameZh;
  const con = input.constellationZh;
  const name = input.memorialName;
  const to = input.relationTo?.trim();
  const templates: Record<OccasionCode, () => string> = {
    LOVE: () =>
      `致${to || '我心爱的人'}：\n` +
      `今夜，我在${con}为你寻到一颗星，把它以「${name}」的名义郑重登记、悄悄安放。` +
      `${star}离我们很远，却年复一年地亮着，像我从不曾说出口、却始终为你留着的那份心意。` +
      `往后每个想你的夜里，抬头就能找到它——那是属于我们的坐标，也是我愿意守望一生的方向。`,
    BIRTHDAY: () =>
      `亲爱的${to || '寿星'}：\n` +
      `生日快乐。我在${con}挑了${star}这颗星，以「${name}」的名义为你纪念这一天。` +
      `愿你如它一般，在属于自己的夜空里安静而坚定地发光。新的一岁，愿你所求皆有回响，所行皆有星光引路。`,
    WEDDING: () =>
      `致${name}：\n` +
      `在${con}，${star}被我们共同登记、安放为今日的见证。星辰不语，却把此刻的相守记进了漫长的时间里。` +
      `愿这段婚姻如星轨般恒久，纵有岁月流转，你们始终并肩、彼此照亮。`,
    GRADUATION: () =>
      `致${to || '即将启程的你'}：\n` +
      `以「${name}」的名义，我把${con}的${star}为你郑重纪念。四季寒暑终有尽，而你眼里的光才刚刚开始。` +
      `愿你带着这颗星前行，无论走多远，都记得自己曾如此闪耀，也终将抵达更辽阔的夜空。`,
    NEWBORN: () =>
      `致${name}：\n` +
      `你来到这个世界的时候，我们在${con}为你安放了${star}，把这份初见郑重登记下来。` +
      `它会一直亮着，像我们对你从不熄灭的祝福。愿你慢慢长大，眼里有光，心里有暖，一生被温柔以待。`,
    PET_MEMORIAL: () =>
      `致${to || '最想念的小家伙'}：\n` +
      `我在${con}为你留了一颗星，以「${name}」的名义静静安放、纪念。${star}会替我继续守着你曾撒欢的那片夜空。` +
      `谢谢你陪过我的那段时光，往后每次抬头，我都知道你在那里，安稳而快乐。`,
    IN_MEMORIAM: () =>
      `致${to || '深深怀念的你'}：\n` +
      `我把${con}的${star}以「${name}」的名义郑重纪念、安放。它离得很远，却始终亮着，像你从未真正离开，只是换了一种方式陪着我们。` +
      `想你的时候，我便抬头找它——那里有我说不完的话，和永远的思念。`,
    OTHER: () =>
      `致${name}：\n` +
      `我在${con}为这段心意寻到${star}，郑重登记、静静安放。星光穿越漫长的距离抵达此刻，也把这份纪念留在了时间里。` +
      `愿每次抬头，都能想起此刻的珍重与温柔。`,
  };
  return (templates[code] ?? templates.OTHER)();
}

/**
 * 生成一封「宇宙来信」。
 * 未配置 API 基址、或请求失败（网络/超时/校验/服务端异常），一律优雅回退本地模板（mode='demo'），
 * 绝不 throw——纪念场景，按钮永远给得出一段温柔的文字。
 */
export async function generateCosmicLetter(
  input: CosmicLetterInput,
): Promise<CosmicLetterResult> {
  if (!isApiConfigured()) {
    return { letter: renderCosmicLetterTemplate(input), mode: 'demo' };
  }
  try {
    const body = {
      starNameZh: input.starNameZh.slice(0, 40),
      constellationZh: input.constellationZh.slice(0, 40),
      occasion: occasionLabelToCode(input.occasion),
      memorialName: input.memorialName.slice(0, 60),
      ...(input.relationTo?.trim() ? { relationTo: input.relationTo.trim().slice(0, 40) } : {}),
      ...(input.tone ? { tone: input.tone } : {}),
    };
    const res = await request<WireCosmicLetterResponse>('/api/agent/skills/cosmic-letter/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const letter = res.letter?.trim();
    if (!letter) {
      // 后端返回空文本（异常）→ 本地模板兜底，仍不打断体验
      return { letter: renderCosmicLetterTemplate(input), mode: 'demo' };
    }
    return { letter, mode: res.mode === 'llm' ? 'llm' : 'template' };
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[api] 生成宇宙来信失败，已回退本地模板：', err);
    }
    return { letter: renderCosmicLetterTemplate(input), mode: 'demo' };
  }
}

// ─────────────────────────── 情侣双星（Couple Star） ───────────────────────────

/** 情侣对中的单颗星单元（UI 形状）。memorialName 可为空串，调用方负责兜底非空。 */
export interface CoupleUnitInput {
  /** 星体唯一标识 */
  objectUid: string;
  /** 该颗星的纪念名，1-40 字（空串由调用方补兜底名） */
  memorialName: string;
  /** 该颗星的祝福语，<=140 字，可选 */
  blessing?: string;
}

/** 创建情侣双星的输入（UI 形状）。occasion 传中文标签，发送前映射为枚举码。 */
export interface CreateCoupleInput {
  starA: CoupleUnitInput;
  starB: CoupleUnitInput;
  /** 纪念场景中文标签，缺省「情侣纪念」（LOVE） */
  occasion?: string;
  /** 关系/场景标签，如「恋人」「夫妻」，<=40 字，可选 */
  relationLabel?: string;
  /** 合并祝福语，<=140 字，可选 */
  coupleBlessing?: string;
  /** 纪念日期 YYYY-MM-DD，两颗星共享，可选 */
  memorialDate?: string;
}

/** 情侣对中单颗星的创建结果（UI 形状）。 */
export interface CoupleStarResult {
  role: 'A' | 'B';
  registrationNo: string;
  publicSlug: string;
  memorialName: string;
  star: {
    objectUid: string;
    nameZh: string;
    nameEn: string;
    constellationZh: string;
    raDeg: number;
    decDeg: number;
    magnitude: number | null;
  };
}

/** 情侣双星创建成功结果（UI 形状）。 */
export interface CoupleRegistrationResult {
  /** 对外情侣纪念页 slug，用于 /couple/[slug] */
  coupleSlug: string;
  /** 聚合状态：两颗皆 ACTIVE → ACTIVE，否则 PENDING_REVIEW */
  status: 'ACTIVE' | 'PENDING_REVIEW' | 'REJECTED';
  registrations: CoupleStarResult[];
}

/** 情侣双星创建判别联合：live=服务端真实登记；demo=本地演示回退。 */
export type CreateCoupleOutcome =
  | { mode: 'live'; data: CoupleRegistrationResult }
  | { mode: 'demo'; data: { registrationNoA: string; registrationNoB: string } };

/** POST /api/memorial/couple 成功 body（与 MemorialService.toCoupleCreateView 逐字段对齐）。 */
interface WireCoupleCreateResponse {
  couple: {
    coupleSlug: string;
    relationLabel: string | null;
    coupleBlessing: string | null;
    occasionType: string;
    memorialDate: string | null;
    status: 'ACTIVE' | 'PENDING_REVIEW' | 'REJECTED';
    createdAt: string;
    registrations: Array<{
      role: 'A' | 'B' | null;
      registrationNo: string;
      publicSlug: string;
      status: string;
      memorialName: string;
      blessingText: string | null;
      star: WireStarSnapshot;
    }>;
  };
  compliance: string;
}

/** GET /api/memorial/couple/public/:coupleSlug 成功 body。 */
interface WireCouplePublicResponse {
  couple: {
    coupleSlug: string;
    relationLabel: string | null;
    coupleBlessing: string | null;
    occasionType: string;
    memorialDate: string | null;
    createdAt: string;
    stars: Array<{
      role: 'A' | 'B' | null;
      registrationNo: string;
      memorialName: string;
      blessingText: string | null;
      star: WireStarSnapshot;
      certificate?: WirePublicCertificate | null;
    }>;
  };
  compliance: string;
}

/** 从 wire 快照 + 本地目录距离，装配 UI 星体子集。 */
function toUiStar(snap: WireStarSnapshot): CoupleStarResult['star'] {
  return {
    objectUid: snap.objectUid,
    nameZh: snap.nameZh,
    nameEn: snap.nameEn,
    constellationZh: snap.constellationZh,
    raDeg: snap.raDeg,
    decDeg: snap.decDeg,
    magnitude: snap.magnitude,
  };
}

/** wire role 兜底为 'A'/'B'（后端理论上恒返回，容错处理 null/异常值）。 */
function normalizeRole(role: 'A' | 'B' | null, index: number): 'A' | 'B' {
  if (role === 'A' || role === 'B') return role;
  return index === 0 ? 'A' : 'B';
}

/**
 * 创建情侣双星登记。
 * 与单星登记一致：任何失败（未配置/网络/超时/校验/两星相同/服务端异常）一律优雅回退演示模式，
 * 绝不 throw。演示模式下生成两个同格式编号，成功态仍可展示这一对星。
 */
export async function createCoupleRegistration(
  input: CreateCoupleInput,
): Promise<CreateCoupleOutcome> {
  if (!isApiConfigured()) {
    return {
      mode: 'demo',
      data: { registrationNoA: makeDemoRegistrationNo(), registrationNoB: makeDemoRegistrationNo() },
    };
  }
  try {
    const body = {
      starA: {
        starObjectUid: input.starA.objectUid,
        memorialName: input.starA.memorialName,
        ...(input.starA.blessing?.trim() ? { blessingText: input.starA.blessing.trim() } : {}),
      },
      starB: {
        starObjectUid: input.starB.objectUid,
        memorialName: input.starB.memorialName,
        ...(input.starB.blessing?.trim() ? { blessingText: input.starB.blessing.trim() } : {}),
      },
      occasionType: occasionLabelToCode(input.occasion ?? '情侣纪念'),
      ...(input.relationLabel?.trim() ? { relationLabel: input.relationLabel.trim() } : {}),
      ...(input.coupleBlessing?.trim() ? { coupleBlessing: input.coupleBlessing.trim() } : {}),
      ...(input.memorialDate ? { memorialDate: input.memorialDate } : {}),
    };
    const res = await request<WireCoupleCreateResponse>('/api/memorial/couple', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': makeIdempotencyKey(),
      },
      body: JSON.stringify(body),
    });
    const c = res.couple;
    return {
      mode: 'live',
      data: {
        coupleSlug: c.coupleSlug,
        status: c.status,
        registrations: c.registrations.map((r, i) => ({
          role: normalizeRole(r.role, i),
          registrationNo: r.registrationNo,
          publicSlug: r.publicSlug,
          memorialName: r.memorialName,
          star: toUiStar(r.star),
        })),
      },
    };
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[api] 创建情侣双星失败，已回退演示模式：', err);
    }
    return {
      mode: 'demo',
      data: { registrationNoA: makeDemoRegistrationNo(), registrationNoB: makeDemoRegistrationNo() },
    };
  }
}

/** 公开情侣纪念页内单颗星（UI 形状）。 */
export interface PublicCoupleStar {
  role: 'A' | 'B';
  registrationNo: string;
  memorialName: string;
  blessing: string | null;
  star: {
    objectUid: string;
    nameZh: string;
    nameEn: string;
    constellationZh: string;
    raDeg: number;
    decDeg: number;
    magnitude: number | null;
    distanceLy: number | null;
  };
  certificate: CertificateAssets | null;
}

/** 公开情侣纪念页视图（UI 形状）。 */
export interface PublicCoupleView {
  coupleSlug: string;
  relationLabel: string | null;
  coupleBlessing: string | null;
  /** 纪念场景中文标签（已从枚举码映射） */
  occasion: string;
  memorialDate: string | null;
  createdAt: string;
  stars: PublicCoupleStar[];
}

/**
 * 拉取公开情侣纪念页数据（仅服务端组件调用）。
 * 失败返回 null，由页面渲染优雅降级占位，绝不抛错。60 秒 ISR。
 */
export async function getPublicCouple(coupleSlug: string): Promise<PublicCoupleView | null> {
  if (!isApiConfigured()) return null;
  try {
    const res = await request<WireCouplePublicResponse>(
      `/api/memorial/couple/public/${encodeURIComponent(coupleSlug)}`,
      { next: { revalidate: 60 } },
    );
    const c = res.couple;
    const { getCelestialByUid } = await import('@star/astro-data');
    const stars: PublicCoupleStar[] = c.stars.map((s, i) => {
      const catalogStar = getCelestialByUid(s.star.objectUid);
      const cert = s.certificate;
      const certificate: CertificateAssets | null =
        cert && cert.status === 'READY' && cert.certUrl && cert.starMapUrl
          ? { certUrl: cert.certUrl, starMapUrl: cert.starMapUrl }
          : null;
      return {
        role: normalizeRole(s.role, i),
        registrationNo: s.registrationNo,
        memorialName: s.memorialName,
        blessing: s.blessingText,
        star: {
          ...toUiStar(s.star),
          distanceLy: catalogStar?.distanceLy ?? null,
        },
        certificate,
      };
    });
    return {
      coupleSlug: c.coupleSlug,
      relationLabel: c.relationLabel,
      coupleBlessing: c.coupleBlessing,
      occasion: occasionCodeToLabel(c.occasionType),
      memorialDate: c.memorialDate,
      createdAt: c.createdAt,
      stars,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────── 纪念册（Album） ───────────────────────────

/** 纪念册生成状态（镜像后端 CertificateStatus）。 */
export type AlbumStatus = 'PENDING' | 'GENERATING' | 'READY' | 'FAILED';

/** 纪念册单页资产（UI 形状）。 */
export interface AlbumPageAsset {
  /** 后端页名（cover/star-map/story/letter/astro/dedication） */
  name: string;
  /** 中文页名标签（展示用） */
  label: string;
  url: string;
}

/** 纪念册视图（UI 形状）。 */
export interface AlbumView {
  status: AlbumStatus;
  /** 合并长图 URL；仅 READY 时非空 */
  albumUrl: string | null;
  /** 分页资产；仅 READY 时非空 */
  pages: AlbumPageAsset[];
  /** 宇宙来信生成方式：llm/template/null */
  letterMode: string | null;
}

/**
 * 纪念册结果判别联合：
 * - live：后端可达，data 为真实状态（可能仍在生成中）；
 * - unavailable：未配置 API 或后端不可达 —— UI 据此展示「需连接服务后生成」降级提示。
 */
export type AlbumOutcome = { mode: 'live'; data: AlbumView } | { mode: 'unavailable' };

/** 后端页名 → 中文标签。未知页名原样返回（向前兼容后端新增页）。 */
const ALBUM_PAGE_LABELS: Record<string, string> = {
  cover: '封面',
  'star-map': '星图',
  story: '纪念寄语',
  letter: '宇宙来信',
  astro: '星象档案',
  dedication: '献词',
};

/** AlbumDto（后端）→ AlbumView（UI）。 */
interface WireAlbumResponse {
  registrationNo: string;
  status: AlbumStatus;
  albumUrl: string | null;
  pageUrls: Array<{ name: string; url: string }>;
  pageCount: number;
  letterMode: string | null;
}

/** 把 wire album dto 收敛为 UI 视图。 */
function toAlbumView(res: WireAlbumResponse): AlbumView {
  return {
    status: res.status,
    albumUrl: res.albumUrl,
    pages: (res.pageUrls ?? []).map((p) => ({
      name: p.name,
      label: ALBUM_PAGE_LABELS[p.name] ?? p.name,
      url: p.url,
    })),
    letterMode: res.letterMode,
  };
}

/**
 * 触发纪念册生成（幂等）。后端异步入队/同步降级/已就绪同走 202 响应形状。
 * 未配置 API 或失败 → mode='unavailable'，UI 展示降级提示，绝不 throw。
 */
export async function triggerAlbum(registrationNo: string): Promise<AlbumOutcome> {
  if (!isApiConfigured()) return { mode: 'unavailable' };
  try {
    const res = await request<WireAlbumResponse>(
      `/api/memorial/registrations/${encodeURIComponent(registrationNo)}/album`,
      { method: 'POST' },
    );
    return { mode: 'live', data: toAlbumView(res) };
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[api] 触发纪念册失败：', err);
    }
    return { mode: 'unavailable' };
  }
}

/**
 * 查询纪念册状态与资产 URL。
 * 未配置 API 或失败 → mode='unavailable'，绝不 throw。
 */
export async function getAlbum(registrationNo: string): Promise<AlbumOutcome> {
  if (!isApiConfigured()) return { mode: 'unavailable' };
  try {
    const res = await request<WireAlbumResponse>(
      `/api/memorial/registrations/${encodeURIComponent(registrationNo)}/album`,
    );
    return { mode: 'live', data: toAlbumView(res) };
  } catch {
    return { mode: 'unavailable' };
  }
}

/** 按编号查登记（预留给后续订单/证书页）。失败返回 null。 */
export async function getRegistration(
  registrationNo: string,
): Promise<MemorialRegistrationResult | null> {
  if (!isApiConfigured()) return null;
  try {
    const res = await request<WireCreateResponse>(
      `/api/memorial/registrations/${encodeURIComponent(registrationNo)}`,
    );
    const reg = res.registration;
    return {
      registrationNo: reg.registrationNo,
      publicSlug: reg.publicSlug,
      status: reg.status,
      createdAt: reg.createdAt,
    };
  } catch {
    return null;
  }
}

/**
 * 拉取公开纪念页数据（仅服务端组件调用）。
 * 失败返回 null，由页面渲染优雅降级占位，绝不抛错触发 Next error boundary。
 * 登记内容基本不变，60 秒 ISR 足够，同时减轻后端压力。
 */
export async function getPublicMemorial(slug: string): Promise<PublicMemorialView | null> {
  if (!isApiConfigured()) return null;
  try {
    const res = await request<WirePublicResponse>(
      `/api/memorial/public/${encodeURIComponent(slug)}`,
      { next: { revalidate: 60 } },
    );
    const m = res.memorial;
    // 快照不含 distanceLy：从共享目录按 uid 补充（仅展示用，找不到则显示「未知」）
    const { getCelestialByUid } = await import('@star/astro-data');
    const catalogStar = getCelestialByUid(m.star.objectUid);
    // 证书仅在后端明确 READY 且两 URL 齐备时展示；缺任一字段一律降级为不展示（维持现状）
    const cert = m.certificate;
    const certificate: CertificateAssets | null =
      cert && cert.status === 'READY' && cert.certUrl && cert.starMapUrl
        ? { certUrl: cert.certUrl, starMapUrl: cert.starMapUrl }
        : null;
    return {
      registrationNo: m.registrationNo,
      publicSlug: slug,
      memorialName: m.memorialName,
      occasion: occasionCodeToLabel(m.occasionType),
      memorialDate: m.memorialDate,
      blessing: m.blessingText,
      createdAt: m.createdAt,
      certificate,
      star: {
        objectUid: m.star.objectUid,
        nameZh: m.star.nameZh,
        nameEn: m.star.nameEn,
        constellationZh: m.star.constellationZh,
        raDeg: m.star.raDeg,
        decDeg: m.star.decDeg,
        magnitude: m.star.magnitude,
        distanceLy: catalogStar?.distanceLy ?? null,
      },
    };
  } catch {
    return null;
  }
}
