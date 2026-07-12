export async function uploadAndCreateMaterial(api, options) {
  const {
    productId,
    type,
    file,
    title = '',
    reportId = '',
    onProgress,
  } = options
  const formData = new FormData()
  formData.append('file', file)

  let uploaded
  try {
    uploaded = await api.post('/api/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (event) => {
        if (event.total && onProgress) {
          onProgress(Math.round((event.loaded / event.total) * 100))
        }
      },
    })
  } catch (error) {
    error.materialStage = 'upload'
    throw error
  }

  const body = {
    type,
    title: title.trim() || file.name,
    oss_key: uploaded.key,
  }
  if (type === 'pdf' && reportId) body.report_id = reportId

  try {
    return await api.post(`/api/products/${productId}/materials`, body)
  } catch (error) {
    error.materialStage = 'create'
    throw error
  }
}
