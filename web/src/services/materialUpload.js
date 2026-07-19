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

function putFileToOss(ticket, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false
    let confirmTimer = null
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      if (confirmTimer) clearInterval(confirmTimer)
      fn(value)
    }
    const startConfirmTimer = () => {
      if (confirmTimer) return
      onProgress?.(100, 'confirming')
      confirmTimer = setInterval(async () => {
        if (settled) return
        if (await verifyDirectObject(ticket)) {
          finish(resolve)
          xhr.abort()
        }
      }, DIRECT_CONFIRM_INTERVAL_MS)
    }
    xhr.open('PUT', ticket.upload_url)
    xhr.timeout = 5 * 60 * 1000
    xhr.setRequestHeader('Content-Type', ticket.content_type || file.type || 'application/octet-stream')
    xhr.setRequestHeader('Content-Disposition', 'inline')
    xhr.upload.onprogress = (event) => {
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

async function uploadViaBackend(api, file, onProgress) {
  const formData = new FormData()
  formData.append('file', file)
  return await api.post('/api/upload', formData, {
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

export async function uploadMaterialFile(api, file, onProgress, options = {}) {
  if (options.direct) {
    try {
      const ticket = await api.post('/api/upload/direct-ticket', {
        filename: file.name || 'file',
        prefix: 'materials',
        content_type: file.type || undefined,
      }, { skipBadgeRefresh: true })
      if (ticket.enabled && ticket.upload_url && ticket.key) {
        await putFileToOss(ticket, file, onProgress)
        return { key: ticket.key, url: ticket.url, direct: true }
      }
      if (options.allowBackendFallback) {
        return await uploadViaBackend(api, file, onProgress)
      }
      throw new Error('OSS 直传未启用,请检查存储配置')
    } catch (error) {
      if (options.allowBackendFallback) {
        onProgress?.(0, 'fallback')
        return await uploadViaBackend(api, file, onProgress)
      }
      throw error
    }
  }
  return await uploadViaBackend(api, file, onProgress)
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
