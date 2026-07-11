import { COMPLIANCE_NOTICE } from '../../lib/api';
import { extractSlug, resolveEntry, type EntryId } from '../../lib/scene';

/**
 * 入口页：扫码 / 输入编号进入。
 * 冷启动若从二维码/小程序码带入标识，直接 redirect 到详情页（扫码即进核心流）。
 */
Page({
  data: {
    manualInput: '',
    hint: '',
    compliance: COMPLIANCE_NOTICE,
  },

  onLoad(options: Record<string, string | undefined>) {
    const id = resolveEntry(options);
    if (id.slug || id.no) {
      this.goDetail(id);
    }
  },

  onInput(e: WechatMiniprogram.Input) {
    this.setData({ manualInput: e.detail.value, hint: '' });
  },

  /** 扫码：从证书二维码内容抽取 slug/编号后进入详情。 */
  onScan() {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode'],
      success: (res) => {
        const id = extractSlug(res.result);
        if (id.slug || id.no) {
          this.goDetail(id);
        } else {
          this.setData({ hint: '未能识别这张二维码，试试手动输入编号' });
        }
      },
      fail: () => {
        this.setData({ hint: '扫码已取消' });
      },
    });
  },

  /** 手动输入：可为编号、slug 或纪念页链接。 */
  onManualSubmit() {
    const raw = this.data.manualInput.trim();
    if (!raw) {
      this.setData({ hint: '请输入登记编号或纪念页链接' });
      return;
    }
    const id = extractSlug(raw);
    if (id.slug || id.no) {
      this.goDetail(id);
    } else {
      this.setData({ hint: '格式无法识别，请检查后重试' });
    }
  },

  goDetail(id: EntryId) {
    const q = id.slug
      ? `slug=${encodeURIComponent(id.slug)}`
      : `no=${encodeURIComponent(id.no ?? '')}`;
    wx.redirectTo({ url: `/pages/detail/detail?${q}` });
  },
});
