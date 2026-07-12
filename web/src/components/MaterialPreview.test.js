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

  it('renders an image with a preview source list', () => {
    const wrapper = mountPreview({ type: 'image', url: '/signed/image.jpg' })
    const image = wrapper.getComponent({ name: 'ElImage' })

    expect(image.props('src')).toBe('/signed/image.jpg')
    expect(image.props('previewSrcList')).toEqual(['/signed/image.jpg'])
  })

  it('embeds a PDF and provides a fallback link', () => {
    const wrapper = mountPreview({ type: 'pdf', url: '/signed/report.pdf' })

    expect(wrapper.get('iframe').attributes('src')).toBe('/signed/report.pdf')
    expect(wrapper.get('a').attributes('href')).toBe('/signed/report.pdf')
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
