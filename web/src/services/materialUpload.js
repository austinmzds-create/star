const MAX_UPLOAD_BYTES = 200 * 1024 * 1024
const BACKEND_FALLBACK_MAX_BYTES = 8 * 1024 * 1024
// 直传采用「停顿看门狗」而非固定超时:只要还在往上传字节就一直续命,
// 只有连续 STALL_TIMEOUT_MS 没有任何进展(网络真的断了)才判定失败。
// 固定超时会把「慢但在传」的上传误杀——例如 1.2Mbps 上行传 9MB 需 ~60s,
// 却被按 2Mbps 估算的 66s 阈值卡掉(线上真实事故),停顿看门狗从根上避免这点。
const STALL_TIMEOUT_MS = 60000
// 兜底硬上限:即便进度回调因浏览器异常不触发,也不至于永久挂起。
const HARD_CAP_MS = 30 * 60 * 1000

function isVideoFile(file) {
  const type = (file.type || '').toLowerCase()
  const name = (file.name || '').toLowerCase()
  return type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/.test(name)
}

function assertUploadFile(file, options = {}) {
  if (!file) throw new Error('请先选择文件')
  if (!file.size) throw new Error('上传文件为空,请重新选择')
  const maxBytes = Number(options.maxBytes) || MAX_UPLOAD_BYTES
  if (file.size > maxBytes) {
    throw new Error(`文件超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限,请压缩后再传`)
  }
}

function putFileToOss(ticket, file, onProgress, options = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false
    let stallTimer = null
    let hardTimer = null
    const stallMs = Number(options.stallTimeoutMs) > 0 ? Math.trunc(options.stallTimeoutMs) : STALL_TIMEOUT_MS
    const clearTimers = () => {
      if (stallTimer) { clearTimeout(stallTimer); stallTimer = null }
      if (hardTimer) { clearTimeout(hardTimer); hardTimer = null }
    }
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimers()
      fn(value)
    }
    // 每次有字节进展就重置停顿计时;真正连续无进展才中断。
    const armStall = () => {
      if (stallTimer) clearTimeout(stallTimer)
      stallTimer = setTimeout(() => {
        finish(reject, new Error(`OSS 直传中断:${Math.round(stallMs / 1000)} 秒内无数据传输,请检查网络后重试`))
        try { xhr.abort() } catch { /* 已中断,忽略 */ }
      }, stallMs)
    }
    xhr.open('PUT', ticket.upload_url)
    // 签名 PUT 把 Content-Type 计入签名,必须与票据一致,否则 403 SignatureDoesNotMatch。
    xhr.setRequestHeader('Content-Type', ticket.content_type || file.type || 'application/octet-stream')
    xhr.upload.onprogress = (event) => {
      armStall()
      if (event.lengthComputable && onProgress) {
        const total = event.total || file.size
        const percent = total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0
        onProgress(percent, percent >= 100 ? 'confirming' : 'oss')
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100, 'confirming')
        finish(resolve)
      } else {
        const detail = xhr.responseText ? `: ${xhr.responseText.slice(0, 200)}` : ''
        finish(reject, new Error(`OSS 直传失败 ${xhr.status}${detail}`))
      }
    }
    xhr.onerror = () => finish(reject, new Error('OSS 直传网络异常'))
    xhr.onabort = () => { if (!settled) finish(reject, new Error('OSS 直传已取消')) }
    hardTimer = setTimeout(() => {
      finish(reject, new Error('OSS 直传超时,请重试'))
      try { xhr.abort() } catch { /* 已中断,忽略 */ }
    }, HARD_CAP_MS)
    armStall()
    xhr.send(file)
  })
}

async function uploadViaBackend(api, file, onProgress, prefix = 'materials') {
  const formData = new FormData()
  formData.append('file', file)
  return await api.post(`/api/upload?prefix=${encodeURIComponent(prefix)}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    skipBadgeRefresh: true,
    onUploadProgress: (event) => {
      if (event.total && onProgress) {
        const percent = Math.round((event.loaded / event.total) * 100)
        onProgress(percent, percent >= 100 ? 'backend_confirming' : 'backend')
      }
    },
  })
}

function canBackendFallback(file, options = {}) {
  if (options.allowBackendFallback !== true) return false
  if (isVideoFile(file)) return false
  const maxBytes = Number(options.backendFallbackMaxBytes) || BACKEND_FALLBACK_MAX_BYTES
  return file.size <= maxBytes
}

// 默认:后端只签名,文件本体浏览器直传 OSS;只有 OSS 未启用时才走本地/后端兜底。
export async function uploadMaterialFile(api, file, onProgress, options = {}) {
  assertUploadFile(file, options)
  const prefix = options.prefix || 'materials'
  if (options.direct !== false) {
    let ticket
    try {
      ticket = await api.post('/api/upload/direct-ticket', {
        filename: file.name || 'file',
        prefix,
        content_type: file.type || undefined,
        size_bytes: file.size,
      }, { skipBadgeRefresh: true })
    } catch (error) {
      if (canBackendFallback(file, options)) {
        onProgress?.(0, 'fallback')
        return await uploadViaBackend(api, file, onProgress, prefix)
      }
      throw error
    }

    if (ticket.enabled && ticket.upload_url && ticket.key) {
      try {
        await putFileToOss(ticket, file, onProgress, options)
      } catch (error) {
        if (canBackendFallback(file, options)) {
          onProgress?.(0, 'fallback')
          return await uploadViaBackend(api, file, onProgress, prefix)
        }
        throw error
      }
      // 回显用后端内联代理地址(preview_url = /api/files/...),OSS 默认域名会强制下载无法内联显示
      return { key: ticket.key, url: ticket.preview_url || ticket.url, direct: true, storage: 'oss' }
    }

    // OSS 未启用:开发/本地环境保留后端兜底;线上配置异常会在 direct-ticket 阶段明确报错。
    if (!ticket.enabled) {
      return await uploadViaBackend(api, file, onProgress, prefix)
    }
    throw new Error('上传地址返回不完整')
  }
  return await uploadViaBackend(api, file, onProgress, prefix)
}
