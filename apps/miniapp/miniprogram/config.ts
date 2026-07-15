/**
 * 运行期配置。
 * 小程序不读 .env，此处以常量承载；接后端时改 BASE_URL 或用微信开发者工具的自定义编译注入。
 * 与 web 端 isApiConfigured 同语义：空串 = 演示模式（无后端，全程内置示例星降级）。
 */

/** 后端 API 基址。占位空串；接后端填 https://api.example.com（务必含协议、无尾斜杠）。 */
export const BASE_URL = '';

/** 请求超时（毫秒）。纪念场景宁可快速回退演示也不让用户干等。 */
export const REQUEST_TIMEOUT_MS = 8000;

/** 定位/罗盘首帧等待上限（毫秒）。 */
export const LOCATE_TIMEOUT_MS = 8000;
export const COMPASS_FIRST_FRAME_MS = 3000;

/** 是否已配置后端。 */
export function isApiConfigured(): boolean {
  return BASE_URL.trim().length > 0;
}

/** 无定位授权时的示例观测点（北京），仅供参考展示，不代表真实位置。 */
export const FALLBACK_OBSERVER = {
  latitudeDeg: 39.9042,
  longitudeDeg: 116.4074,
  labelZh: '示例位置（北京）',
} as const;
