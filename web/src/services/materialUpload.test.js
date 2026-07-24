// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { uploadMaterialFile } from './materialUpload'

const sentFiles = []
const sentHeaders = []
const sentRequests = []

class FakeXMLHttpRequest {
  constructor() {
    this.headers = {}
    this.upload = {}
    this.status = FakeXMLHttpRequest.nextStatus
    this.responseText = FakeXMLHttpRequest.nextResponseText
    this.timeout = 0
  }

  open(method, url) {
    this.method = method
    this.url = url
  }

  setRequestHeader(key, value) {
    this.headers[key] = value
  }

  send(file) {
    sentRequests.push({ method: this.method, url: this.url })
    sentFiles.push(file)
    sentHeaders.push({ ...this.headers })
    this.upload.onprogress?.({ lengthComputable: true, loaded: file.size, total: file.size })
    this.onload?.()
  }

  getResponseHeader(key) {
    return FakeXMLHttpRequest.nextHeaders[key] || null
  }

  abort() {}
}
FakeXMLHttpRequest.nextStatus = 200
FakeXMLHttpRequest.nextResponseText = ''
FakeXMLHttpRequest.nextHeaders = { ETag: '"part-etag"' }

function mockDirectUpload() {
  sentFiles.length = 0
  sentHeaders.length = 0
  sentRequests.length = 0
  FakeXMLHttpRequest.nextStatus = 200
  FakeXMLHttpRequest.nextResponseText = ''
  FakeXMLHttpRequest.nextHeaders = { ETag: '"part-etag"' }
  vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
}

describe('uploadMaterialFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses signed multipart OSS upload for large videos without backend fallback', async () => {
    mockDirectUpload()
    const api = {
      post: vi.fn()
        .mockResolvedValueOnce({
          enabled: true,
          signed: true,
          key: 'materials/big.mp4',
          upload_url: 'https://bucket.oss/materials/big.mp4?sig=put',
          content_type: 'video/mp4',
          part_size: 5 * 1024 * 1024,
          preview_url: '/api/files/materials/big.mp4?e=1&s=x',
        })
        .mockResolvedValueOnce({
          upload_id: 'UP123',
          parts: [
            { part_number: 1, url: 'https://bucket.oss/materials/big.mp4?partNumber=1&uploadId=UP123&sig=p' },
            { part_number: 2, url: 'https://bucket.oss/materials/big.mp4?partNumber=2&uploadId=UP123&sig=p' },
          ],
        })
        .mockResolvedValueOnce({ ok: true }),
    }
    const file = new File([new Uint8Array(7 * 1024 * 1024)], 'big.mp4', { type: 'video/mp4' })
    const progress = vi.fn()

    const result = await uploadMaterialFile(api, file, progress, { allowBackendFallback: true })

    expect(result).toMatchObject({ key: 'materials/big.mp4', direct: true, storage: 'oss' })
    expect(api.post).toHaveBeenCalledTimes(3)
    expect(api.post.mock.calls[0][0]).toBe('/api/upload/direct-ticket')
    expect(api.post.mock.calls[0][1]).toMatchObject({
      filename: 'big.mp4',
      content_type: 'video/mp4',
      size_bytes: file.size,
    })
    expect(api.post.mock.calls[1][0]).toBe('/api/upload/multipart/init')
    expect(api.post.mock.calls[1][1]).toMatchObject({ key: 'materials/big.mp4', parts: 2 })
    expect(api.post.mock.calls[2][0]).toBe('/api/upload/multipart/complete')
    expect(api.post.mock.calls[2][1]).toMatchObject({ key: 'materials/big.mp4', upload_id: 'UP123' })
    expect(api.post.mock.calls[2][1].parts).toHaveLength(2)
    expect(api.post.mock.calls.some((call) => String(call[0]).startsWith('/api/upload?'))).toBe(false)
    expect(sentFiles.map((item) => item.size)).toEqual([5 * 1024 * 1024, 2 * 1024 * 1024])
    expect(sentRequests.map((item) => item.url)).toEqual([
      'https://bucket.oss/materials/big.mp4?partNumber=1&uploadId=UP123&sig=p',
      'https://bucket.oss/materials/big.mp4?partNumber=2&uploadId=UP123&sig=p',
    ])
    expect(sentHeaders[0]).not.toHaveProperty('Content-Disposition')
    expect(sentHeaders[0]).not.toHaveProperty('Content-Type')
    expect(progress).toHaveBeenCalledWith(100, 'confirming')
  })

  it('does not push failed videos through the backend fallback path', async () => {
    mockDirectUpload()
    FakeXMLHttpRequest.nextStatus = 403
    FakeXMLHttpRequest.nextResponseText = 'SignatureDoesNotMatch'
    const api = {
      post: vi.fn()
        .mockResolvedValueOnce({
          enabled: true,
          signed: true,
          key: 'materials/fail.mp4',
          upload_url: 'https://bucket.oss/materials/fail.mp4?sig=put',
          content_type: 'video/mp4',
          part_size: 5 * 1024 * 1024,
        })
        .mockResolvedValueOnce({
          upload_id: 'UP456',
          parts: [
            { part_number: 1, url: 'https://bucket.oss/materials/fail.mp4?partNumber=1&uploadId=UP456&sig=p' },
            { part_number: 2, url: 'https://bucket.oss/materials/fail.mp4?partNumber=2&uploadId=UP456&sig=p' },
          ],
        })
        .mockResolvedValueOnce({ ok: true }),
    }
    const file = new File([new Uint8Array(9 * 1024 * 1024)], 'fail.mp4', { type: 'video/mp4' })

    await expect(uploadMaterialFile(api, file, vi.fn(), { allowBackendFallback: true }))
      .rejects.toThrow('OSS 直传失败 403')

    expect(api.post.mock.calls.map((call) => call[0])).toEqual([
      '/api/upload/direct-ticket',
      '/api/upload/multipart/init',
      '/api/upload/multipart/abort',
    ])
    expect(api.post.mock.calls.some((call) => String(call[0]).startsWith('/api/upload?'))).toBe(false)
  })

  it('rejects empty and over-limit files before requesting an upload ticket', async () => {
    const api = { post: vi.fn() }
    await expect(uploadMaterialFile(api, new File([], 'empty.mp4', { type: 'video/mp4' })))
      .rejects.toThrow('上传文件为空')
    await expect(uploadMaterialFile(
      api,
      new File([new Uint8Array(2)], 'large.mp4', { type: 'video/mp4' }),
      vi.fn(),
      { maxBytes: 1 },
    )).rejects.toThrow('文件超过')
    expect(api.post).not.toHaveBeenCalled()
  })

  it('keeps local development fallback when OSS is disabled', async () => {
    const api = {
      post: vi.fn()
        .mockResolvedValueOnce({ enabled: false })
        .mockResolvedValueOnce({ key: 'materials/local.png', url: '/api/files/materials/local.png', use_oss: false }),
    }
    const file = new File(['image'], 'local.png', { type: 'image/png' })

    const result = await uploadMaterialFile(api, file, vi.fn())

    expect(result).toMatchObject({ key: 'materials/local.png' })
    expect(api.post.mock.calls[0][0]).toBe('/api/upload/direct-ticket')
    expect(api.post.mock.calls[1][0]).toBe('/api/upload?prefix=materials')
  })
})
