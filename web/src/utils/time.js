// 统一时间格式化:ISO / 时间戳 → "YYYY-MM-DD HH:mm"
export function formatTime(v, withSeconds = false) {
  if (!v) return '—'
  const d = new Date(v)
  if (isNaN(d.getTime())) return v
  const p = (n) => String(n).padStart(2, '0')
  const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  return withSeconds ? `${base}:${p(d.getSeconds())}` : base
}

// 相对时间(几分钟前/几小时前),给列表用
export function fromNow(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (isNaN(d.getTime())) return v
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  if (diff < 2592000) return `${Math.floor(diff / 86400)}天前`
  return formatTime(v)
}
