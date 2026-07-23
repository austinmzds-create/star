// 达人 H5 设备视图模式:手机(窄居中+底部 tab) / 电脑(宽屏+左侧导航)。
// 业务默认按手机端展示;用户可在左上角手动切换并持久化。
import { ref } from 'vue'

const KEY = 'h5_device_mode'

function detectDefault() {
  const stored = localStorage.getItem(KEY)
  if (stored === 'mobile' || stored === 'desktop') return stored
  return 'mobile'
}

// 单例:整个 H5 共享同一份模式状态
export const deviceMode = ref(detectDefault())

export function setDeviceMode(mode) {
  if (mode !== 'mobile' && mode !== 'desktop') return
  deviceMode.value = mode
  localStorage.setItem(KEY, mode)
}

export function toggleDeviceMode() {
  setDeviceMode(deviceMode.value === 'mobile' ? 'desktop' : 'mobile')
}
