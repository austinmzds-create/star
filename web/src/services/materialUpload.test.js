// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { uploadAndCreateMaterial } from './materialUpload'

const sentFiles = []
const sentHeaders = []

class FakeXMLHttpRequest {
  constructor() {
    this.headers = {}
    this.upload = {}
    this.status = 200
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

function mockDirectUpload() {
  sentFiles.length = 0
  sentHeaders.length = 0
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
      'Content-Disposition': 'inline',
    })
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
})
