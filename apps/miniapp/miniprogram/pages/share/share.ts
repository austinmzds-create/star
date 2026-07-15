import {
  getPublicMemorial,
  COMPLIANCE_NOTICE,
  type MemorialView,
} from '../../lib/api';
import { drawPoster, POSTER_W, POSTER_H, type Ctx2D } from '../../lib/poster';

type IAppOption = { globalData: { currentMemorial: MemorialView | null } };

/**
 * 分享页：程序化绘制星空海报（Canvas 2D 新接口）→ 可保存/转发。
 * 画布取节点失败/超时则降级为纯文字分享，绝不阻断分享路径。
 */
Page({
  data: {
    state: 'drawing' as 'drawing' | 'ready' | 'fallback',
    view: null as MemorialView | null,
    posterTempPath: '',
    compliance: COMPLIANCE_NOTICE,
  },

  async onLoad(options: Record<string, string | undefined>) {
    const app = getApp<IAppOption>();
    let view = app.globalData.currentMemorial;
    if (!view) {
      const result = await getPublicMemorial({ slug: options.slug, no: options.no });
      view = result.view;
      app.globalData.currentMemorial = view;
    }
    this.setData({ view });
    // 等一帧布局完成再取画布节点
    setTimeout(() => this.renderPoster(), 120);
  },

  /** 取 2d 画布节点，绘制并导出临时文件。 */
  renderPoster() {
    const view = this.data.view;
    if (!view) {
      this.setData({ state: 'fallback' });
      return;
    }

    wx.createSelectorQuery()
      .select('#poster')
      .fields({ node: true, size: true })
      .exec((res) => {
        const node = res && res[0] && (res[0].node as WechatMiniprogram.Canvas | undefined);
        if (!node) {
          this.setData({ state: 'fallback' });
          return;
        }
        try {
          const dpr = wx.getWindowInfo().pixelRatio || 2;
          node.width = POSTER_W * dpr;
          node.height = POSTER_H * dpr;
          const ctx = node.getContext('2d') as unknown as Ctx2D;
          ctx.scale(dpr, dpr);
          drawPoster(ctx, view);

          wx.canvasToTempFilePath({
            canvas: node,
            success: (r) => {
              this.setData({ posterTempPath: r.tempFilePath, state: 'ready' });
            },
            fail: () => {
              this.setData({ state: 'fallback' });
            },
          });
        } catch {
          this.setData({ state: 'fallback' });
        }
      });
  },

  /** 保存到相册（先申请授权，拒绝则引导去设置）。 */
  onSave() {
    const path = this.data.posterTempPath;
    if (!path) return;
    const doSave = () => {
      wx.saveImageToPhotosAlbum({
        filePath: path,
        success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
        fail: () => wx.showToast({ title: '保存失败', icon: 'none' }),
      });
    };
    wx.getSetting({
      success: (res) => {
        if (res.authSetting['scope.writePhotosAlbum'] === false) {
          wx.openSetting({
            success: (s) => {
              if (s.authSetting['scope.writePhotosAlbum']) doSave();
            },
          });
        } else {
          doSave();
        }
      },
      fail: doSave,
    });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const view = this.data.view;
    const base: WechatMiniprogram.Page.ICustomShareContent = {
      title: view
        ? `我在${view.star.constellationZh}为「${view.memorialName}」留了一颗星`
        : '星辰纪念 · 扫码找星',
      path: view
        ? `/pages/detail/detail?slug=${encodeURIComponent(view.publicSlug)}`
        : '/pages/index/index',
    };
    if (this.data.posterTempPath) {
      base.imageUrl = this.data.posterTempPath;
    }
    return base;
  },
});
