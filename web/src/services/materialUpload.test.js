// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { uploadMaterialFile } from './materialUpload'

const sentFiles = []
const sentHeaders = []

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
    sentFiles.push(file)
    sentHeaders.push({ ...this.headers })
    this.upload.onprogress?.({ lengthComputable: true, loaded: file.size, total: file.size })
    this.onload?.()
  }

  abort() {}
}
FakeXMLHttpRequest.nextStatus = 200
FakeXMLHttpRequest.nextResponseText = ''

function mockDirectUpload() {
  sentFiles.length = 0
  sentHeaders.length = 0
  FakeXMLHttpRequest.nextStatus = 200
  FakeXMLHttpRequest.nextResponseText = ''
  vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
}

describe('uploadMaterialFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses one signed OSS PUT for large videos without multipart orchestration', async () => {
    mockDirectUpload()
    const api = {
      post: vi.fn().mockResolvedValueOnce({
        enabled: true,
        signed: true,
        key: 'materials/big.mp4',
        upload_url: 'https://bucket.oss/materials/big.mp4?sig=put',
        content_type: 'video/mp4',
        preview_url: '/api/files/materials/big.mp4?e=1&s=x',
      }),
    }
    const file = new File([new Uint8Array(7 * 1024 * 1024)], 'big.mp4', { type: 'video/mp4' })
    const progress = vi.fn()

    const result = await uploadMaterialFile(api, file, progress, { allowBackendFallback: true })

    expect(result).toMatchObject({ key: 'materials/big.mp4', direct: true, storage: 'oss' })
    expect(api.post).toHaveBeenCalledTimes(1)
    expect(api.post.mock.calls[0][0]).toBe('/api/upload/direct-ticket')
    expect(api.post.mock.calls[0][1]).toMatchObject({
      filename: 'big.mp4',
      content_type: 'video/mp4',
      size_bytes: file.size,
    })
    expect(api.post.mock.calls.some((call) => String(call[0]).includes('/multipart/'))).toBe(false)
    expect(api.post.mock.calls.some((call) => String(call[0]).startsWith('/api/upload?'))).toBe(false)
    expect(sentFiles).toEqual([file])
    expect(sentHeaders[0]).toMatchObject({ 'Content-Type': 'video/mp4' })
    expect(sentHeaders[0]).not.toHaveProperty('Content-Disposition')
    expect(progress).toHaveBeenCalledWith(100, 'confirming')
  })

  it('does not push failed videos through the backend fallback path', async () => {
    mockDirectUpload()
    FakeXMLHttpRequest.nextStatus = 403
    FakeXMLHttpRequest.nextResponseText = 'SignatureDoesNotMatch'
    const api = {
      post: vi.fn().mockResolvedValueOnce({
        enabled: true,
        signed: true,
        key: 'materials/fail.mp4',
        upload_url: 'https://bucket.oss/materials/fail.mp4?sig=put',
        content_type: 'video/mp4',
      }),
    }
    const file = new File([new Uint8Array(9 * 1024 * 1024)], 'fail.mp4', { type: 'video/mp4' })

    await expect(uploadMaterialFile(api, file, vi.fn(), { allowBackendFallback: true }))
      .rejects.toThrow('OSS 直传失败 403')

    expect(api.post).toHaveBeenCalledTimes(1)
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
