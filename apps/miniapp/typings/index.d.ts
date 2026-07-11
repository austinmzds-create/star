/// <reference path="../node_modules/miniprogram-api-typings/index.d.ts" />

/**
 * 小程序全局类型补充。
 * miniprogram-api-typings 提供全部 wx.* API 类型；此处补应用级类型。
 */

import type { MemorialView } from '../miniprogram/lib/api';

/** App 实例上的自定义结构（供各页 getApp<IAppOption>() 取用）。 */
export interface IAppOption {
  globalData: {
    /** 最近一次加载成功的纪念视图，供 detail → find/share 复用，避免重复请求。 */
    currentMemorial: MemorialView | null;
  };
}

declare global {
  /** 兜底：某些第三方声明需要 IAnyObject（键值任意对象）。 */
  interface IAnyObject {
    [key: string]: unknown;
  }
}

export {};
