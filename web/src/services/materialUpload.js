function putFileToOss(ticket, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', ticket.upload_url)
    xhr.timeout = 5 * 60 * 1000
    xhr.setRequestHeader('Content-Type', ticket.content_type || file.type || 'application/octet-stream')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`OSS upload failed: ${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error('OSS upload failed'))
    xhr.ontimeout = () => reject(new Error('OSS upload timeout'))
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
        onProgress(Math.round((event.loaded / event.total) * 100))
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
    } catch {
      // 直传可能被本地浏览器 CORS 拦住;自动回退后端中转,不打断业务录入。
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
