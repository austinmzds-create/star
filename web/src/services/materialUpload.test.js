// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { uploadAndCreateMaterial, uploadMaterialFile } from './materialUpload'

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

describe('uploadAndCreateMaterial', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uploads a file and immediately creates its material record', async () => {
    mockDirectUpload()
    const api = {
      post: vi.fn()
        .mockResolvedValueOnce({
          enabled: true,
          key: 'materials/a.mp4',
          upload_url: 'https://bucket.oss/materials/a.mp4',
          content_type: 'video/mp4',
          url: 'https://bucket.oss/materials/a.mp4',
        })
        .mockResolvedValueOnce({ id: 9 }),
    }
    const file = new File(['video'], '带货视频.mp4', { type: 'video/mp4' })

    await uploadAndCreateMaterial(api, {
      productId: 3,
      type: 'video_ai',
      file,
      title: '',
      parsedText: '这条视频用来给达人参考开头节奏',
      reportId: '',
    })

    expect(api.post.mock.calls[0][0]).toBe('/api/upload/direct-ticket')
    expect(sentFiles).toEqual([file])
    expect(sentHeaders[0]).toMatchObject({
      'Content-Type': 'video/mp4',
    })
    expect(sentHeaders[0]).not.toHaveProperty('Content-Disposition')
    expect(api.post).not.toHaveBeenCalledWith('/api/upload', expect.anything(), expect.anything())
    expect(api.post.mock.calls[1]).toEqual([
      '/api/products/3/materials',
      {
        type: 'video_ai',
        title: '带货视频.mp4',
        oss_key: 'materials/a.mp4',
        parsed_text: '这条视频用来给达人参考开头节奏',
      },
    ])
  })

  it('includes report id for an uploaded PDF', async () => {
    mockDirectUpload()
    const api = {
      post: vi.fn()
        .mockResolvedValueOnce({
          enabled: true,
          key: 'materials/a.pdf',
          upload_url: 'https://bucket.oss/materials/a.pdf',
          content_type: 'application/pdf',
          url: 'https://bucket.oss/materials/a.pdf',
        })
        .mockResolvedValueOnce({ id: 10 }),
    }

    await uploadAndCreateMaterial(api, {
      productId: 3,
      type: 'pdf',
      file: new File(['pdf'], '报告.pdf'),
      title: '质检报告',
      parsedText: '达人可引用这份质检报告里的成分和检测结论',
      reportId: 'REPORT-1',
    })

    expect(api.post.mock.calls[1][1]).toEqual({
      type: 'pdf',
      title: '质检报告',
      oss_key: 'materials/a.pdf',
      parsed_text: '达人可引用这份质检报告里的成分和检测结论',
      report_id: 'REPORT-1',
    })
  })

  it('marks upload failures as upload stage errors', async () => {
    const api = {
      post: vi.fn()
        .mockResolvedValueOnce({ enabled: true, key: 'materials/a.jpg' }),
    }

    await expect(uploadAndCreateMaterial(api, {
      productId: 3,
      type: 'image',
      file: new File(['image'], 'a.jpg'),
    })).rejects.toMatchObject({ materialStage: 'upload' })
  })

  it('marks material creation failures separately from upload failures', async () => {
    mockDirectUpload()
    const api = {
      post: vi.fn()
        .mockResolvedValueOnce({
          enabled: true,
          key: 'materials/a.jpg',
          upload_url: 'https://bucket.oss/materials/a.jpg',
          content_type: 'image/jpeg',
          url: 'https://bucket.oss/materials/a.jpg',
        })
        .mockRejectedValueOnce(new Error('create failed')),
    }

    await expect(uploadAndCreateMaterial(api, {
      productId: 3,
      type: 'image',
      file: new File(['image'], 'a.jpg'),
    })).rejects.toMatchObject({ materialStage: 'create' })
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
    expect(api.post.mock.calls.some((call) => String(call[0]).includes('/multipart/'))).toBe(false)
    expect(api.post.mock.calls.some((call) => String(call[0]).startsWith('/api/upload?'))).toBe(false)
    expect(sentFiles).toEqual([file])
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
})
