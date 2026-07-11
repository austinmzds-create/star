import { BASE_URL, REQUEST_TIMEOUT_MS, isApiConfigured } from '../config';

/**
 * wx.request 的 Promise 封装。
 *
 * 设计原则（对齐 apps/web api.ts「失败静默回退」）：
 * - 未配置基址、网络错误、超时、非 2xx，一律 resolve 成 { ok:false }，
 *   永不 reject —— UI 层不必写 try/catch，纪念场景体验必须温柔。
 */
export type RequestResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string };

/** 发起一个 GET JSON 请求。path 需以 / 开头（如 /api/memorial/public/xxx）。 */
export function requestJson<T>(path: string): Promise<RequestResult<T>> {
  return new Promise((resolve) => {
    if (!isApiConfigured()) {
      resolve({ ok: false, code: 'NOT_CONFIGURED' });
      return;
    }

    let settled = false;
    const finish = (r: RequestResult<T>): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    wx.request({
      url: `${BASE_URL}${path}`,
      method: 'GET',
      timeout: REQUEST_TIMEOUT_MS,
      header: { 'content-type': 'application/json' },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          finish({ ok: true, data: res.data as T });
        } else {
          finish({ ok: false, code: `HTTP_${res.statusCode}` });
        }
      },
      fail: () => {
        finish({ ok: false, code: 'NETWORK' });
      },
    });
  });
}
