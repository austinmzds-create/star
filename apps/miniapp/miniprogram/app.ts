import type { MemorialView } from './lib/api';

/**
 * 应用入口。
 * - globalData 缓存最近一次加载的纪念视图，供 detail → find/share 复用，避免重复网络请求；
 * - 不在启动时申请任何隐私权限：定位权限在用户进入「找星」页时才惰性申请（纪念场景，克制打扰）。
 */
App<{ globalData: { currentMemorial: MemorialView | null } }>({
  globalData: {
    currentMemorial: null,
  },
  onLaunch() {
    // 无副作用启动。真正的数据加载与权限申请都发生在具体页面。
  },
});
