// 全站统一的金额/数字格式化。
// money(1234.5) -> "¥1,234.5" ; num(120000) -> "120,000"
export function money(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '¥0'
  return '¥' + v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

export function num(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0'
  return v.toLocaleString('zh-CN')
}
