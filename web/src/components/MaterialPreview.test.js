// @vitest-environment jsdom
import ElementPlus from 'element-plus'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import MaterialPreview from './MaterialPreview.vue'

const mountPreview = (material) => mount(MaterialPreview, {
  props: { material },
  global: { plugins: [ElementPlus] },
})

describe('MaterialPreview', () => {
  it('renders uploaded video inline', () => {
    const wrapper = mountPreview({ type: 'video_ai', url: '/signed/video.mp4' })

    expect(wrapper.get('video').attributes('src')).toBe('/signed/video.mp4')
    expect(wrapper.get('video').attributes('controls')).toBeDefined()
  })

  it('does not auto-load force-download OSS videos before preview is requested', async () => {
    const wrapper = mountPreview({
      type: 'video_ai',
      url: 'https://bucket.oss/materials/video.mp4',
      preview_url: '/api/files/materials/video.mp4?e=1&s=test',
      inline_preview: false,
    })

    expect(wrapper.find('video').exists()).toBe(false)
    expect(wrapper.text()).toContain('视频文件已上传')

    await wrapper.get('.file-actions button').trigger('click')
    expect(wrapper.get('video').attributes('src')).toBe('/api/files/materials/video.mp4?e=1&s=test')
  })

  it('renders an image with a preview source list', () => {
    const wrapper = mountPreview({ type: 'image', url: '/signed/image.jpg' })
    const image = wrapper.getComponent({ name: 'ElImage' })

    expect(image.props('src')).toBe('/signed/image.jpg')
    expect(image.props('previewSrcList')).toEqual(['/signed/image.jpg'])
  })

  it('shows description text under uploaded media', () => {
    const wrapper = mountPreview({
      type: 'image',
      url: '/signed/image.jpg',
      parsed_text: '这张图用于展示使用前后对比',
    })

    expect(wrapper.text()).toContain('说明文案')
    expect(wrapper.text()).toContain('这张图用于展示使用前后对比')
  })

  it('offers a retry with a cache-busting URL after an image error', async () => {
    const wrapper = mountPreview({ type: 'image', url: '/signed/image.jpg?e=1&s=test' })
    const image = wrapper.getComponent({ name: 'ElImage' })

    await image.vm.$emit('error', new Event('error'))

    expect(wrapper.text()).toContain('图片暂未加载成功')
    await wrapper.get('.image-error button').trigger('click')
    expect(wrapper.getComponent({ name: 'ElImage' }).props('src')).toContain('_preview_retry=1')
  })

  it('embeds a PDF and provides a fallback link', () => {
    const wrapper = mountPreview({ type: 'pdf', url: '/signed/report.pdf' })

    expect(wrapper.get('iframe').attributes('src')).toBe('/signed/report.pdf')
    expect(wrapper.get('a').attributes('href')).toBe('/signed/report.pdf')
  })

  it('does not auto-load force-download OSS PDFs before preview is requested', async () => {
    const wrapper = mountPreview({
      type: 'pdf',
      url: 'https://bucket.oss/materials/report.pdf',
      preview_url: '/api/files/materials/report.pdf?e=1&s=test',
      inline_preview: false,
    })

    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.text()).toContain('报告文件已上传')

    await wrapper.get('.file-actions button').trigger('click')
    expect(wrapper.get('iframe').attributes('src')).toBe('/api/files/materials/report.pdf?e=1&s=test')
  })

  it('shows copy text directly', () => {
    const wrapper = mountPreview({ type: 'copy', parsed_text: '直接展示的文案' })

    expect(wrapper.text()).toContain('直接展示的文案')
  })

  it('keeps an external hot-video link when no uploaded file exists', () => {
    const wrapper = mountPreview({ type: 'video_hot', source_link: 'https://example.com/hot' })

    expect(wrapper.get('a').attributes('href')).toBe('https://example.com/hot')
    expect(wrapper.text()).toContain('打开原链接')
  })
})
