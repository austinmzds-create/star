// 达人 H5 设备视图模式:手机(窄居中+底部 tab) / 电脑(宽屏+左侧导航)。
// 业务默认始终按手机端展示;左上角切换只影响当前 SPA 会话,避免旧浏览器缓存把达人端打开成电脑版。
import { ref } from 'vue'

const KEY = 'h5_device_mode'

function detectDefault() {
  localStorage.removeItem(KEY)
  return 'mobile'
}

// 单例:整个 H5 共享同一份模式状态
export const deviceMode = ref(detectDefault())

export function setDeviceMode(mode) {
  if (mode !== 'mobile' && mode !== 'desktop') return
  deviceMode.value = mode
}

export function toggleDeviceMode() {
  setDeviceMode(deviceMode.value === 'mobile' ? 'desktop' : 'mobile')
}
