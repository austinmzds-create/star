const DIRECT_CONFIRM_INTERVAL_MS = 10000

async function verifyDirectObject(ticket) {
  try {
    const resp = await fetch(ticket.upload_url, {
      method: 'HEAD',
      cache: 'no-store',
    })
    return resp.ok
  } catch {
    return false
  }
}

const STALL_MS = 20000  // 20s 内没有任何上传进度 → 判定卡住,快速失败去走兜底(而不是干等 5 分钟)

function putFileToOss(ticket, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false
    let confirmTimer = null
    let stallTimer = null
    let lastAt = Date.now()
    const cleanup = () => {
      if (confirmTimer) clearInterval(confirmTimer)
      if (stallTimer) clearInterval(stallTimer)
    }
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      cleanup()
      fn(value)
    }
    // 卡住看门狗:一直没进度就 abort,让上层回退后端中转
    stallTimer = setInterval(() => {
      if (settled) return
      if (Date.now() - lastAt > STALL_MS) {
        finish(reject, new Error('OSS 直传无响应(疑似跨域/网络问题)'))
        try { xhr.abort() } catch { /* noop */ }
      }
    }, 2000)
    const startConfirmTimer = () => {
      if (confirmTimer) return
      onProgress?.(100, 'confirming')
      confirmTimer = setInterval(async () => {
        if (settled) return
        if (await verifyDirectObject(ticket)) {
          finish(resolve)
          try { xhr.abort() } catch { /* noop */ }
        }
      }, DIRECT_CONFIRM_INTERVAL_MS)
    }
    xhr.open('PUT', ticket.upload_url)
    xhr.timeout = 5 * 60 * 1000
    xhr.setRequestHeader('Content-Type', ticket.content_type || file.type || 'application/octet-stream')
    xhr.upload.onprogress = (event) => {
      lastAt = Date.now()
      if (event.lengthComputable && onProgress) {
        const percent = Math.round((event.loaded / event.total) * 100)
        onProgress(percent, percent >= 100 ? 'confirming' : 'uploading')
        if (percent >= 100) startConfirmTimer()
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) finish(resolve)
      else finish(reject, new Error(`OSS upload failed: ${xhr.status}`))
    }
    xhr.onerror = () => finish(reject, new Error('OSS upload failed'))
    xhr.ontimeout = () => finish(reject, new Error('OSS upload timeout'))
    xhr.onabort = () => {
      if (!settled) finish(reject, new Error('OSS upload aborted'))
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

// 默认:优先浏览器直传 OSS(不经后端/nginx,大视频也顺畅);直传不可用或卡住则回退后端中转。
export async function uploadMaterialFile(api, file, onProgress, options = {}) {
  const prefix = options.prefix || 'materials'
  const allowBackendFallback = options.allowBackendFallback !== false  // 默认允许兜底
  if (options.direct !== false) {
    try {
      const ticket = await api.post('/api/upload/direct-ticket', {
        filename: file.name || 'file',
        prefix,
        content_type: file.type || undefined,
      }, { skipBadgeRefresh: true })
      if (ticket.enabled && ticket.upload_url && ticket.key) {
        await putFileToOss(ticket, file, onProgress)
        // 回显用后端内联代理地址(preview_url = /api/files/...),OSS 默认域名会强制下载无法内联显示
        return { key: ticket.key, url: ticket.preview_url || ticket.url, direct: true }
      }
      // OSS 未启用:直接走后端
      return await uploadViaBackend(api, file, onProgress, prefix)
    } catch (error) {
      if (allowBackendFallback) {
        onProgress?.(0, 'fallback')
        return await uploadViaBackend(api, file, onProgress, prefix)
      }
      throw error
    }
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
