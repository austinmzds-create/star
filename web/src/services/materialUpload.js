const MIN_UPLOAD_TIMEOUT_MS = 45000
const MAX_UPLOAD_TIMEOUT_MS = 9 * 60 * 1000
const UPLOAD_TIMEOUT_GRACE_MS = 30000
const UPLOAD_TIMEOUT_BYTES_PER_SECOND = 256 * 1024
const BACKEND_FALLBACK_MAX_BYTES = 8 * 1024 * 1024

function resolveUploadTimeoutMs(file, options = {}) {
  const explicit = Number(options.timeoutMs)
  if (Number.isFinite(explicit) && explicit > 0) return Math.trunc(explicit)
  const estimated = UPLOAD_TIMEOUT_GRACE_MS + (file.size / UPLOAD_TIMEOUT_BYTES_PER_SECOND) * 1000
  return Math.max(MIN_UPLOAD_TIMEOUT_MS, Math.min(MAX_UPLOAD_TIMEOUT_MS, Math.ceil(estimated)))
}

function isVideoFile(file) {
  const type = (file.type || '').toLowerCase()
  const name = (file.name || '').toLowerCase()
  return type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/.test(name)
}

function putFileToOss(ticket, file, onProgress, options = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }
    xhr.open('PUT', ticket.upload_url)
    xhr.timeout = resolveUploadTimeoutMs(file, options)
    xhr.setRequestHeader('Content-Type', ticket.content_type || file.type || 'application/octet-stream')
    xhr.upload.onprogress = (event) => {
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
    xhr.ontimeout = () => finish(reject, new Error(`OSS 直传超时,请检查网络后重试(超过 ${Math.round(xhr.timeout / 1000)} 秒)`))
    xhr.onabort = () => {
      if (!settled) finish(reject, new Error('OSS 直传已取消'))
    }
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
  const prefix = options.prefix || 'materials'
  if (options.direct !== false) {
    let ticket
    try {
      ticket = await api.post('/api/upload/direct-ticket', {
        filename: file.name || 'file',
        prefix,
        content_type: file.type || undefined,
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

export async function uploadAndCreateMaterial(api, options) {
  const {
    productId,
    type,
    file,
    title = '',
    parsedText = '',
    reportId = '',
    onProgress,
  } = options
  let uploaded
  try {
    uploaded = await uploadMaterialFile(api, file, onProgress, { direct: true })
    if (!uploaded?.key) throw new Error('上传结果缺少文件 key')
  } catch (error) {
    error.materialStage = 'upload'
    throw error
  }

  const body = {
    type,
    title: title.trim() || file.name,
    oss_key: uploaded.key,
  }
  if (parsedText.trim()) body.parsed_text = parsedText.trim()
  if (type === 'pdf' && reportId) body.report_id = reportId

  try {
    return await api.post(`/api/products/${productId}/materials`, body)
  } catch (error) {
    error.materialStage = 'create'
    throw error
  }
}
