const MAX_UPLOAD_BYTES = 200 * 1024 * 1024
const BACKEND_FALLBACK_MAX_BYTES = 8 * 1024 * 1024
// 直传采用「停顿看门狗」而非固定超时:只要还在往上传字节就一直续命,
// 只有连续 STALL_TIMEOUT_MS 没有任何进展(网络真的断了)才判定失败。
// 固定超时会把「慢但在传」的上传误杀——例如 1.2Mbps 上行传 9MB 需 ~60s,
// 却被按 2Mbps 估算的 66s 阈值卡掉(线上真实事故),停顿看门狗从根上避免这点。
const STALL_TIMEOUT_MS = 60000
// 兜底硬上限:即便进度回调因浏览器异常不触发,也不至于永久挂起。
const HARD_CAP_MS = 30 * 60 * 1000

// 分片并行直传:大视频提速的关键。单条 TCP 直传到上海 OSS 常吃不满上行带宽
//(受 RTT/丢包限制),多个分片并行才能把管道打满——这正是「验签直传很快」的做法。
const PART_SIZE = 5 * 1024 * 1024
const PART_CONCURRENCY = 4

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

// 通用的「带停顿看门狗的 PUT」:body 可为整文件或单个分片 blob。
// onProgress(loadedBytes) 汇报本次请求已上传字节;setContentType 决定是否发送 Content-Type 头。
function putWithWatchdog({ url, body, contentType, onLoaded, options = {} }) {
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
    const armStall = () => {
      if (stallTimer) clearTimeout(stallTimer)
      stallTimer = setTimeout(() => {
        finish(reject, new Error(`OSS 直传中断:${Math.round(stallMs / 1000)} 秒内无数据传输,请检查网络后重试`))
        try { xhr.abort() } catch { /* 已中断,忽略 */ }
      }, stallMs)
    }
    xhr.open('PUT', url)
    // 单文件签名 PUT 把 Content-Type 计入签名,必须发送且一致;分片签名不含 Content-Type,不能发。
    if (contentType) xhr.setRequestHeader('Content-Type', contentType)
    xhr.upload.onprogress = (event) => {
      armStall()
      if (event.lengthComputable) onLoaded?.(event.loaded, event.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        finish(resolve, xhr)
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
    xhr.send(body)
  })
}

// 单次签名 PUT:整文件一把传(小文件,或分片不可用时的兜底)。
async function putFileToOss(ticket, file, onProgress, options = {}) {
  await putWithWatchdog({
    url: ticket.upload_url,
    body: file,
    contentType: ticket.content_type || file.type || 'application/octet-stream',
    options,
    onLoaded: (loaded, total) => {
      const t = total || file.size
      const percent = t > 0 ? Math.min(100, Math.round((loaded / t) * 100)) : 0
      onProgress?.(percent, percent >= 100 ? 'confirming' : 'oss')
    },
  })
  onProgress?.(100, 'confirming')
}

// 单个分片:失败自动重试一次;返回 ETag(需 OSS CORS 暴露 ETag)。
async function putSignedPart(url, blob, onLoaded, options = {}) {
  const send = () => putWithWatchdog({ url, body: blob, contentType: null, onLoaded, options })
  let xhr
  try {
    xhr = await send()
  } catch {
    xhr = await send()   // 单片失败重试一次(抖动/瞬断)
  }
  const etag = xhr.getResponseHeader('ETag')
  if (!etag) throw new Error('分片未返回 ETag(请检查 OSS 跨域规则 ExposeHeader 含 ETag)')
  return etag
}

// 分片并行签名直传:init/complete 走后端(小请求、不暴露 AK),分片本体浏览器并行直传 OSS。
async function multipartSignedUpload(api, ticket, file, onProgress, options = {}) {
  const partSize = Number(ticket.part_size) > 0 ? Number(ticket.part_size) : PART_SIZE
  const total = file.size
  const partCount = Math.ceil(total / partSize)
  const init = await api.post('/api/upload/multipart/init',
    { key: ticket.key, parts: partCount }, { skipBadgeRefresh: true })
  const uploadId = init.upload_id
  const partUrls = init.parts   // [{part_number, url}],按 part_number 升序
  if (!Array.isArray(partUrls) || partUrls.length !== partCount) {
    throw new Error('分片初始化返回不完整')
  }
  const loaded = new Array(partCount).fill(0)
  const report = () => {
    const sum = loaded.reduce((a, b) => a + b, 0)
    onProgress?.(Math.min(99, Math.round((sum / total) * 100)), 'oss')
  }
  const done = new Array(partCount)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < partCount) {
      const i = nextIndex++
      const { part_number: pn, url } = partUrls[i]
      const start = i * partSize
      const blob = file.slice(start, Math.min(start + partSize, total))
      const etag = await putSignedPart(url, blob, (l) => { loaded[i] = l; report() }, options)
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
    // 取消尽力而为,残留分片由 OSS 生命周期规则回收
    try {
      await api.post('/api/upload/multipart/abort',
        { key: ticket.key, upload_id: uploadId }, { skipBadgeRefresh: true })
    } catch { /* noop */ }
    throw e
  }
}

// 大文件优先分片并行,失败则回退单次签名 PUT——保证「不劣于现状」,可用时更快。
async function uploadSignedToOss(api, ticket, file, onProgress, options = {}) {
  const partSize = Number(ticket.part_size) > 0 ? Number(ticket.part_size) : PART_SIZE
  if (file.size > partSize) {
    try {
      await multipartSignedUpload(api, ticket, file, onProgress, options)
      return
    } catch (e) {
      // 分片不可用(如 CORS 未暴露 ETag)或中途失败 → 回退整文件单次 PUT,慢但可用。
      onProgress?.(0, 'oss')
    }
  }
  await putFileToOss(ticket, file, onProgress, options)
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
        if (ticket.signed) {
          // 签名直传(私有 bucket 也可):大文件分片并行、小文件单次 PUT。
          await uploadSignedToOss(api, ticket, file, onProgress, options)
        } else {
          // 匿名公共 bucket:保持单次 PUT(分片需签名编排,这里不适用)。
          await putFileToOss(ticket, file, onProgress, options)
        }
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
