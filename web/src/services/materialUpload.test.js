// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

import { uploadAndCreateMaterial } from './materialUpload'

describe('uploadAndCreateMaterial', () => {
  it('uploads a file and immediately creates its material record', async () => {
    const api = {
      post: vi.fn()
        .mockResolvedValueOnce({ enabled: false })
        .mockResolvedValueOnce({ key: 'materials/a.mp4', url: '/signed/a.mp4' })
        .mockResolvedValueOnce({ id: 9 }),
    }
    const file = new File(['video'], '带货视频.mp4', { type: 'video/mp4' })

    await uploadAndCreateMaterial(api, {
      productId: 3,
      type: 'video_ai',
      file,
      title: '',
      reportId: '',
    })

    expect(api.post.mock.calls[0][0]).toBe('/api/upload/direct-ticket')
    expect(api.post.mock.calls[1][0]).toBe('/api/upload')
    expect(api.post.mock.calls[1][1].get('file')).toBe(file)
    expect(api.post.mock.calls[2]).toEqual([
      '/api/products/3/materials',
      { type: 'video_ai', title: '带货视频.mp4', oss_key: 'materials/a.mp4' },
    ])
  })

  it('includes report id for an uploaded PDF', async () => {
    const api = {
      post: vi.fn()
        .mockResolvedValueOnce({ enabled: false })
        .mockResolvedValueOnce({ key: 'materials/a.pdf', url: '/signed/a.pdf' })
        .mockResolvedValueOnce({ id: 10 }),
    }

    await uploadAndCreateMaterial(api, {
      productId: 3,
      type: 'pdf',
      file: new File(['pdf'], '报告.pdf'),
      title: '质检报告',
      reportId: 'REPORT-1',
    })

    expect(api.post.mock.calls[2][1]).toEqual({
      type: 'pdf',
      title: '质检报告',
      oss_key: 'materials/a.pdf',
      report_id: 'REPORT-1',
    })
  })

  it('marks upload failures as upload stage errors', async () => {
    const api = {
      post: vi.fn()
        .mockResolvedValueOnce({ enabled: false })
        .mockRejectedValueOnce(new Error('upload failed')),
    }

    await expect(uploadAndCreateMaterial(api, {
      productId: 3,
      type: 'image',
      file: new File(['image'], 'a.jpg'),
    })).rejects.toMatchObject({ materialStage: 'upload' })
  })

  it('marks material creation failures separately from upload failures', async () => {
    const api = {
      post: vi.fn()
        .mockResolvedValueOnce({ enabled: false })
        .mockResolvedValueOnce({ key: 'materials/a.jpg', url: '/signed/a.jpg' })
        .mockRejectedValueOnce(new Error('create failed')),
    }

    await expect(uploadAndCreateMaterial(api, {
      productId: 3,
      type: 'image',
      file: new File(['image'], 'a.jpg'),
    })).rejects.toMatchObject({ materialStage: 'create' })
  })
})
