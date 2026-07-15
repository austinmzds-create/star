/**
 * 入口参数解析：把「扫码 / 小程序码 / 普通链接二维码 / 直接 query」多种进入方式
 * 统一抽取成 { slug? , no? }。无 wx 依赖，纯函数，便于 typecheck 与将来单测。
 */

export interface EntryId {
  /** 公开纪念页 slug。 */
  slug?: string;
  /** 登记编号 STAR-YYYYMMDD-XXXX（无公开接口，仅用于提示/演示回退）。 */
  no?: string;
}

/** 登记编号形态：STAR-YYYYMMDD-XXXX。 */
const REG_NO_RE = /^STAR-\d{8}-[A-Za-z0-9]{4,}$/;
/** slug 允许字符：字母数字与连字符。 */
const SLUG_RE = /^[A-Za-z0-9_-]+$/;
/** 从 URL 中抽取 /m/<slug>。 */
const M_PATH_RE = /\/m\/([A-Za-z0-9_-]+)/;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * 从任意字符串抽取入口标识：
 * - `https://host/m/<slug>` → { slug }
 * - `STAR-YYYYMMDD-XXXX`    → { no }
 * - 形如 `s=<slug>` 或纯 `<slug>` → { slug }
 * 无法识别 → 空对象。
 */
export function extractId(raw: string | undefined | null): EntryId {
  if (!raw) return {};
  const text = safeDecode(String(raw).trim());
  if (!text) return {};

  // 1. 含 /m/<slug> 的 URL
  const m = text.match(M_PATH_RE);
  if (m && m[1]) return { slug: m[1] };

  // 2. 登记编号
  if (REG_NO_RE.test(text)) return { no: text };

  // 3. s=<slug> 形式（小程序码 scene 常见约定）
  if (text.startsWith('s=')) {
    const v = text.slice(2);
    if (SLUG_RE.test(v)) return { slug: v };
  }

  // 4. 纯 slug（不含协议/斜杠/等号/空格）
  if (SLUG_RE.test(text)) return { slug: text };

  return {};
}

/** 扫码结果（wx.scanCode 的 result 字段）→ 入口标识。 */
export function extractSlug(scanResult: string): EntryId {
  return extractId(scanResult);
}

/**
 * 冷启动/页面 onLoad 的 options 解析。支持：
 * - 小程序码：options.scene（需 decode，约定 s=<slug> 或纯 slug）
 * - 扫普通链接二维码打开小程序：options.q（被 encode 的原始 URL）
 * - 直接 query：options.slug / options.no
 */
export function resolveEntry(
  options: Record<string, string | undefined> | undefined,
): EntryId {
  if (!options) return {};

  if (options.slug) {
    const v = safeDecode(options.slug);
    if (SLUG_RE.test(v)) return { slug: v };
  }
  if (options.no) {
    const v = safeDecode(options.no);
    if (REG_NO_RE.test(v)) return { no: v };
  }
  if (options.q) {
    const fromQ = extractId(options.q);
    if (fromQ.slug || fromQ.no) return fromQ;
  }
  if (options.scene) {
    const fromScene = extractId(options.scene);
    if (fromScene.slug || fromScene.no) return fromScene;
  }
  return {};
}
