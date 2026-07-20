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
        // 签名直传:PUT 签名的 URL 不能用 HEAD 复核(会 403),直接等 onload 判定;
        // 仅不签名的公共直传才用 HEAD 轮询兜底 onload 不回的场景。
        if (percent >= 100 && !ticket.signed) startConfirmTimer()
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

// ---- 分片并行直传 OSS(大文件/视频提速的关键,对标成熟做法)----
const MULTIPART_THRESHOLD = 5 * 1024 * 1024   // >5MB 用分片
const PART_SIZE = 5 * 1024 * 1024
const PART_CONCURRENCY = 4                     // 并行分片数,吃满带宽
const PART_TIMEOUT_MS = 120000

async function initiateMultipart(objectUrl, contentType) {
  const r = await fetch(`${objectUrl}?uploads`, {
    method: 'POST', headers: { 'Content-Type': contentType },
  })
  if (!r.ok) throw new Error(`分片初始化失败: ${r.status}`)
  const text = await r.text()
  const m = text.match(/<UploadId>(.*?)<\/UploadId>/)
  if (!m) throw new Error('分片初始化未返回 UploadId')
  return m[1]
}

function uploadPart(objectUrl, uploadId, partNumber, blob, onLoaded) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', `${objectUrl}?partNumber=${partNumber}&uploadId=${uploadId}`)
    xhr.timeout = PART_TIMEOUT_MS
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onLoaded(e.loaded) }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag')
        if (!etag) reject(new Error(`分片 ${partNumber} 未返回 ETag`))
        else resolve(etag)
      } else reject(new Error(`分片 ${partNumber} 失败: ${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error(`分片 ${partNumber} 网络错误`))
    xhr.ontimeout = () => reject(new Error(`分片 ${partNumber} 超时`))
    xhr.send(blob)
  })
}

async function completeMultipart(objectUrl, uploadId, parts) {
  const body = '<CompleteMultipartUpload>'
    + parts.slice().sort((a, b) => a.partNumber - b.partNumber)
        .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`).join('')
    + '</CompleteMultipartUpload>'
  const r = await fetch(`${objectUrl}?uploadId=${uploadId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/xml' }, body,
  })
  if (!r.ok) throw new Error(`分片合并失败: ${r.status}`)
}

async function multipartUploadToOss(objectUrl, file, contentType, onProgress) {
  const uploadId = await initiateMultipart(objectUrl, contentType)
  const total = file.size
  const partCount = Math.ceil(total / PART_SIZE)
  const loaded = new Array(partCount).fill(0)
  const report = () => {
    const sum = loaded.reduce((a, b) => a + b, 0)
    onProgress?.(Math.min(99, Math.round((sum / total) * 100)), 'uploading')
  }
  const parts = []
  let nextIndex = 0
  async function worker() {
    while (nextIndex < partCount) {
      const i = nextIndex++
      const start = i * PART_SIZE
      const blob = file.slice(start, Math.min(start + PART_SIZE, total))
      let etag
      try {
        etag = await uploadPart(objectUrl, uploadId, i + 1, blob, (l) => { loaded[i] = l; report() })
      } catch (e) {
        // 单片失败重试一次
        etag = await uploadPart(objectUrl, uploadId, i + 1, blob, (l) => { loaded[i] = l; report() })
      }
      loaded[i] = blob.size
      report()
      parts.push({ partNumber: i + 1, etag })
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, partCount) }, worker))
    await completeMultipart(objectUrl, uploadId, parts)
    onProgress?.(100, 'confirming')
  } catch (e) {
    try { await fetch(`${objectUrl}?uploadId=${uploadId}`, { method: 'DELETE' }) } catch { /* CORS 可能不允许 DELETE,忽略 */ }
    throw e
  }
}

// ---- 签名分片直传:init/complete 走后端(小请求、不暴露 AK),分片本体浏览器凭签名 URL 直传 ----
function putSignedPart(url, blob, onLoaded) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.timeout = PART_TIMEOUT_MS
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onLoaded(e.loaded) }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag')
        // 读不到 ETag 通常是 OSS CORS 未 ExposeHeader: ETag
        if (!etag) reject(new Error('分片未返回 ETag(请检查 OSS 跨域规则的 ExposeHeader 含 ETag)'))
        else resolve(etag)
      } else reject(new Error(`分片失败: ${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error('分片网络错误'))
    xhr.ontimeout = () => reject(new Error('分片超时'))
    xhr.send(blob)
  })
}

async function multipartSignedUpload(api, ticket, file, onProgress) {
  const partSize = ticket.part_size || PART_SIZE
  const total = file.size
  const partCount = Math.ceil(total / partSize)
  const init = await api.post('/api/upload/multipart/init',
    { key: ticket.key, parts: partCount }, { skipBadgeRefresh: true })
  const uploadId = init.upload_id
  const partUrls = init.parts   // [{part_number, url}],按 part_number 升序
  const loaded = new Array(partCount).fill(0)
  const report = () => {
    const sum = loaded.reduce((a, b) => a + b, 0)
    onProgress?.(Math.min(99, Math.round((sum / total) * 100)), 'uploading')
  }
  const done = new Array(partCount)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < partCount) {
      const i = nextIndex++
      const { part_number: pn, url } = partUrls[i]
      const start = i * partSize
      const blob = file.slice(start, Math.min(start + partSize, total))
      let etag
      try {
        etag = await putSignedPart(url, blob, (l) => { loaded[i] = l; report() })
      } catch (e) {
        etag = await putSignedPart(url, blob, (l) => { loaded[i] = l; report() }) // 单片失败重试一次
      }
      loaded[i] = blob.size
      report()
      done[i] = { part_number: pn, etag }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, partCount) }, worker))
    await api.post('/api/upload/multipart/complete',
      { key: ticket.key, upload_id: uploadId, parts: done }, { skipBadgeRefresh: true })
    onProgress?.(100, 'confirming')
  } catch (e) {
    try {
      await api.post('/api/upload/multipart/abort',
        { key: ticket.key, upload_id: uploadId }, { skipBadgeRefresh: true })
    } catch { /* 取消尽力而为,残留分片由 OSS 生命周期规则回收 */ }
    throw e
  }
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
        const contentType = ticket.content_type || file.type || 'application/octet-stream'
        if (ticket.signed) {
          // 签名直传(支持私有 bucket):大文件走服务端编排的分片,小文件单次签名 PUT
          if (file.size > MULTIPART_THRESHOLD) await multipartSignedUpload(api, ticket, file, onProgress)
          else await putFileToOss(ticket, file, onProgress)
        } else if (file.size > MULTIPART_THRESHOLD) {
          await multipartUploadToOss(ticket.upload_url, file, contentType, onProgress)  // 匿名公共 bucket:并行分片
        } else {
          await putFileToOss(ticket, file, onProgress)                                   // 匿名公共 bucket:单次 PUT
        }
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
