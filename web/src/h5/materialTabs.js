export const MATERIAL_TABS = [
  { key: 'detail', label: '商品详情' },
  { key: 'video_ai', label: 'AI视频', types: ['video_ai'] },
  { key: 'video_hot', label: '爆款参考', types: ['video_hot'] },
  { key: 'video_output', label: '达人成片', types: ['video_output'] },
  { key: 'image', label: '图片', types: ['image'] },
  { key: 'pdf', label: '质检报告', types: ['pdf'] },
  { key: 'copy', label: '文案', types: ['copy'] },
  { key: 'sample', label: '寄样物流' },
]

const MATERIAL_TAB_KEYS = new Set(MATERIAL_TABS.map((tab) => tab.key))

export function normalizeMaterialTab(value, fallback = 'detail') {
  const tab = Array.isArray(value) ? value[0] : value
  return MATERIAL_TAB_KEYS.has(tab) ? tab : fallback
}

export function materialTabQuery(tab, baseQuery = {}) {
  const query = { ...baseQuery }
  delete query.tab
  const normalized = normalizeMaterialTab(tab)
  if (normalized !== 'detail') query.tab = normalized
  return query
}
