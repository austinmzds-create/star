import {
  computeVisibility,
  computeObservationSummary,
} from '@star/astro-core';
import {
  getPublicMemorial,
  COMPLIANCE_NOTICE,
  type MemorialView,
} from '../../lib/api';
import { computeGuidance, type Guidance, type FindStatus } from '../../lib/find-star';
import { FALLBACK_OBSERVER, COMPASS_FIRST_FRAME_MS } from '../../config';
import { hhmm, degInt } from '../../lib/format';

type IAppOption = { globalData: { currentMemorial: MemorialView | null } };

interface Observer {
  latitudeDeg: number;
  longitudeDeg: number;
}

/**
 * 找星页（核心）：定位 + 罗盘引导。
 * 每帧用 @star/astro-core computeVisibility 求目标方位/高度，
 * 结合设备朝向/俯仰，经纯函数 computeGuidance 生成引导，UI 只渲染结果。
 * 任何权限/能力缺失都退到「静态方位 + 最佳时间」的最低可用信息，绝不白屏。
 */
Page({
  data: {
    status: 'loading' as FindStatus,
    view: null as MemorialView | null,
    // 引导展示字段
    arrowDeg: 0, // 箭头旋转角（= deltaAz，正=顺时针）
    headline: '正在准备…',
    subHint: '',
    directionZh: '',
    targetAz: 0,
    targetAlt: 0,
    usingFallbackLocation: false,
    fallbackLabel: FALLBACK_OBSERVER.labelZh,
    compliance: COMPLIANCE_NOTICE,
  },

  // ── 运行期状态（非渲染，放实例上） ──
  _observer: null as Observer | null,
  _heading: 0,
  _pitch: undefined as number | undefined,
  _hasCompass: false,
  _compassFirstFrameTimer: 0,
  _lastRender: 0,
  _compassHandler: null as WechatMiniprogram.OnCompassChangeCallback | null,
  _motionHandler: null as WechatMiniprogram.OnDeviceMotionChangeCallback | null,

  async onLoad(options: Record<string, string | undefined>) {
    const app = getApp<IAppOption>();
    let view = app.globalData.currentMemorial;
    if (!view) {
      const result = await getPublicMemorial({ slug: options.slug, no: options.no });
      view = result.view;
      app.globalData.currentMemorial = view;
    }
    this.setData({ view });
    await this.acquireLocation();
  },

  onShow() {
    // 页面重新可见时（从后台/返回）重启传感器
    if (this.data.view && this._observer) {
      this.startSensors();
    }
  },

  onHide() {
    this.stopSensors();
  },

  onUnload() {
    this.stopSensors();
  },

  /** 定位：申请授权 → getLocation；失败退到示例观测点。 */
  async acquireLocation() {
    try {
      const setting = await wxp<WechatMiniprogram.GetSettingSuccessCallbackResult>(wx.getSetting, {});
      const authorized = setting.authSetting['scope.userLocation'];
      if (authorized === false) {
        // 曾拒绝：进入 permissionDenied 态（提供去设置/示例位置）
        this.setData({ status: 'permissionDenied' });
        return;
      }
      if (authorized !== true) {
        await wxp(wx.authorize, { scope: 'scope.userLocation' });
      }
      const loc = await wxp<WechatMiniprogram.GetLocationSuccessCallbackResult>(wx.getLocation, {
        type: 'gcj02',
      });
      this._observer = { latitudeDeg: loc.latitude, longitudeDeg: loc.longitude };
      this.setData({ usingFallbackLocation: false, status: 'searching' });
      this.startSensors();
    } catch {
      // 授权被拒或定位失败：不强制，进入 permissionDenied 兜底卡片
      this.setData({ status: 'permissionDenied' });
    }
  },

  /** 用户在兜底卡片选择「仅看星图方向」→ 用示例观测点继续。 */
  useFallbackLocation() {
    this._observer = {
      latitudeDeg: FALLBACK_OBSERVER.latitudeDeg,
      longitudeDeg: FALLBACK_OBSERVER.longitudeDeg,
    };
    this.setData({ usingFallbackLocation: true, status: 'searching' });
    this.startSensors();
  },

  /** 引导用户去系统设置开启定位权限。 */
  openLocationSetting() {
    wx.openSetting({
      success: (res) => {
        if (res.authSetting['scope.userLocation']) {
          this.acquireLocation();
        }
      },
    });
  },

  /** 启动罗盘 + 设备方向监听。 */
  startSensors() {
    this.stopSensors();

    this._hasCompass = false;
    this._compassFirstFrameTimer = setTimeout(() => {
      if (!this._hasCompass) {
        // 长时间无罗盘首帧：判定无罗盘/精度差，仍显示静态方位数值
        this.setData({ status: 'noCompass' });
        this.renderStatic();
      }
    }, COMPASS_FIRST_FRAME_MS) as unknown as number;

    const compassHandler = (res: WechatMiniprogram.OnCompassChangeListenerResult) => {
      this._hasCompass = true;
      if (this._compassFirstFrameTimer) {
        clearTimeout(this._compassFirstFrameTimer);
        this._compassFirstFrameTimer = 0;
      }
      this._heading = res.direction;
      this.tick();
    };
    this._compassHandler = compassHandler;
    wx.onCompassChange(compassHandler);
    wx.startCompass({});

    // 设备俯仰（可选增强）：beta 近似手机俯仰
    const motionHandler = (res: WechatMiniprogram.OnDeviceMotionChangeListenerResult) => {
      // beta：绕 X 轴，手机竖直指天顶时约 90°。做近似映射到高度角。
      this._pitch = clampPitch(res.beta);
    };
    this._motionHandler = motionHandler;
    wx.startDeviceMotionListening({
      interval: 'game',
      success: () => wx.onDeviceMotionChange(motionHandler),
      fail: () => {
        // 无 motion：仅静态高度提示，不影响方位引导
        this._pitch = undefined;
      },
    });
  },

  /** 释放所有传感器监听，避免后台耗电。 */
  stopSensors() {
    if (this._compassFirstFrameTimer) {
      clearTimeout(this._compassFirstFrameTimer);
      this._compassFirstFrameTimer = 0;
    }
    wx.stopCompass({});
    if (this._compassHandler) {
      // off 回调签名声明为 GeneralCallbackResult；用同一引用注销，做类型桥接。
      wx.offCompassChange(
        this._compassHandler as unknown as WechatMiniprogram.OffCompassChangeCallback,
      );
      this._compassHandler = null;
    }
    if (this._motionHandler) {
      wx.offDeviceMotionChange(
        this._motionHandler as unknown as WechatMiniprogram.OffDeviceMotionChangeCallback,
      );
      this._motionHandler = null;
    }
    wx.stopDeviceMotionListening({});
  },

  /** 每帧（节流 ~10Hz）计算并渲染引导。 */
  tick() {
    const now = Date.now();
    if (now - this._lastRender < 100) return;
    this._lastRender = now;

    const view = this.data.view;
    const observer = this._observer;
    if (!view || !observer) return;

    const date = new Date();
    const equatorial = { raDeg: view.star.raDeg, decDeg: view.star.decDeg };
    const vis = computeVisibility(equatorial, observer, date);
    const targetAz = vis.horizontal.azimuthDeg;
    const targetAlt = vis.horizontal.altitudeDeg;

    const summary = computeObservationSummary(equatorial, observer, date);
    const belowHint = `今晚约 ${hhmm(summary.nextTransit)} 升到最高 ${degInt(
      summary.maxAltitudeDeg,
    )}°，那时最好找`;

    const g = computeGuidance({
      targetAz,
      targetAlt,
      heading: this._heading,
      currentPitch: this._pitch,
      isAboveHorizon: vis.isAboveHorizon,
      neverRises: summary.neverRises,
      directionZh: vis.direction.zh,
      memorialName: view.memorialName,
      belowHorizonHintZh: summary.neverRises
        ? '在你所在的纬度当前季节它不会升起，换个时间或地点再来找它'
        : belowHint,
    });

    if (g.status === 'aligned' && this.data.status !== 'aligned') {
      wx.vibrateShort({ type: 'medium' });
    }
    this.applyGuidance(g, targetAz, targetAlt);
  },

  /** 无罗盘时的一次性静态渲染（仅显示目标方位/高度数值）。 */
  renderStatic() {
    const view = this.data.view;
    const observer = this._observer;
    if (!view || !observer) return;
    const equatorial = { raDeg: view.star.raDeg, decDeg: view.star.decDeg };
    const vis = computeVisibility(equatorial, observer, new Date());
    this.setData({
      targetAz: degInt(vis.horizontal.azimuthDeg),
      targetAlt: degInt(vis.horizontal.altitudeDeg),
      directionZh: vis.direction.zh,
      headline: `目标在${vis.direction.zh}`,
      subHint: `方位角 ${degInt(vis.horizontal.azimuthDeg)}°，高度 ${degInt(
        vis.horizontal.altitudeDeg,
      )}°，请配合手机自带指南针对照`,
    });
  },

  applyGuidance(g: Guidance, targetAz: number, targetAlt: number) {
    this.setData({
      status: g.status,
      arrowDeg: g.deltaAz,
      headline: g.headlineZh,
      subHint: g.subHintZh,
      directionZh: g.directionZh,
      targetAz: degInt(targetAz),
      targetAlt: degInt(targetAlt),
    });
  },

  goShare() {
    const view = this.data.view;
    if (!view) return;
    wx.navigateTo({ url: `/pages/share/share?slug=${encodeURIComponent(view.publicSlug)}` });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const view = this.data.view;
    return {
      title: view
        ? `我在${view.star.constellationZh}为「${view.memorialName}」留了一颗星`
        : '星辰纪念 · 扫码找星',
      path: view ? `/pages/detail/detail?slug=${encodeURIComponent(view.publicSlug)}` : '/pages/index/index',
    };
  },
});

/** beta（-180~180）近似映射为「手机指向天空的高度角」0~90。 */
function clampPitch(beta: number): number {
  const p = Math.abs(beta);
  // beta≈90 表示竖直指天顶。取 min(p,180-p) 让 90 对应最高，0/180 对应水平。
  const pitch = 90 - Math.abs(90 - Math.min(p, 180 - p) * 1);
  return Math.max(0, Math.min(90, pitch));
}

/** 把回调式 wx API 包成 Promise（成功 resolve，失败 reject）。 */
function wxp<T>(
  fn: (opts: any) => void,
  opts: Record<string, unknown>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    fn({
      ...opts,
      success: (res: T) => resolve(res),
      fail: (err: unknown) => reject(err),
    });
  });
}
