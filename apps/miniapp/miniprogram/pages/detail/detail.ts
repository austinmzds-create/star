import {
  getPublicMemorial,
  COMPLIANCE_NOTICE,
  type MemorialView,
} from '../../lib/api';
import { raDecText, magnitudeText, dateZh } from '../../lib/format';

type IAppOption = { globalData: { currentMemorial: MemorialView | null } };

/**
 * 详情页：展示纪念星信息 + 祝福 + 宇宙来信。
 * 加载成功后把视图缓存到 globalData，供 find/share 复用，避免重复请求。
 */
Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'demo' | 'error',
    mode: 'live' as 'live' | 'demo',
    view: null as MemorialView | null,
    radecText: '',
    magText: '',
    dateText: '',
    dotSize: 40,
    compliance: COMPLIANCE_NOTICE,
  },

  async onLoad(options: Record<string, string | undefined>) {
    const slug = options.slug;
    const no = options.no;
    const result = await getPublicMemorial({ slug, no });
    const view = result.view;

    const app = getApp<IAppOption>();
    app.globalData.currentMemorial = view;

    // 星等 → 光点尺寸（越亮越大，范围约 28–72rpx）
    const dotSize = Math.round(Math.max(28, Math.min(72, 52 - view.star.magnitude * 8)));

    this.setData({
      state: result.mode === 'demo' ? 'demo' : 'ready',
      mode: result.mode,
      view,
      radecText: raDecText(view.star.raDeg, view.star.decDeg),
      magText: magnitudeText(view.star.magnitude),
      dateText: dateZh(view.memorialDate),
      dotSize,
    });

    if (result.mode === 'demo' && slug) {
      wx.showToast({ title: '未找到，进入示例', icon: 'none' });
    }
  },

  goFind() {
    const view = this.data.view;
    if (!view) return;
    wx.navigateTo({ url: `/pages/find/find?slug=${encodeURIComponent(view.publicSlug)}` });
  },

  goShare() {
    const view = this.data.view;
    if (!view) return;
    wx.navigateTo({ url: `/pages/share/share?slug=${encodeURIComponent(view.publicSlug)}` });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const view = this.data.view;
    if (!view) {
      return { title: '星辰纪念 · 扫码找到属于你的那颗星' };
    }
    return {
      title: `我在${view.star.constellationZh}为「${view.memorialName}」留了一颗星`,
      path: `/pages/detail/detail?slug=${encodeURIComponent(view.publicSlug)}`,
    };
  },

  onShareTimeline(): WechatMiniprogram.Page.ICustomTimelineContent {
    const view = this.data.view;
    return {
      title: view
        ? `我为「${view.memorialName}」留了一颗星`
        : '星辰纪念 · 扫码找星',
      query: view ? `slug=${encodeURIComponent(view.publicSlug)}` : '',
    };
  },
});
