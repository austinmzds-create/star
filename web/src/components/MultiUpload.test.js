// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { h, nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import MultiUpload from './MultiUpload.vue'

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  success: vi.fn(),
}))

vi.mock('../api', () => ({ default: { post: mocks.post } }))
vi.mock('element-plus', () => ({ ElMessage: { success: mocks.success } }))

const ElUploadStub = {
  props: ['httpRequest'],
  setup(props) {
    return () => h('button', {
      'data-testid': 'upload',
      onClick: () => props.httpRequest({ file: new File(['new'], 'new.jpg') }),
    }, '上传')
  },
}

describe('MultiUpload', () => {
  it('keeps a newly uploaded signed preview when the parent mapping has an empty URL', async () => {
    mocks.post.mockResolvedValue({
      key: 'product/new.jpg',
      url: '/api/files/product/new.jpg?e=1&s=signed',
    })
    let wrapper
    wrapper = mount(MultiUpload, {
      props: {
        modelValue: ['product/old.jpg'],
        initialPreviews: { 'product/old.jpg': '/api/files/product/old.jpg?e=1&s=old' },
        'onUpdate:modelValue': async (keys) => {
          await wrapper.setProps({
            modelValue: keys,
            initialPreviews: {
              'product/old.jpg': '/api/files/product/old.jpg?e=1&s=old',
              'product/new.jpg': undefined,
            },
          })
        },
      },
      global: {
        stubs: { ElUpload: ElUploadStub, ElIcon: true },
      },
    })

    await wrapper.get('[data-testid="upload"]').trigger('click')
    await flushPromises()
    await nextTick()

    expect(wrapper.findAll('img').map((img) => img.attributes('src'))).toContain(
      '/api/files/product/new.jpg?e=1&s=signed',
    )
  })
})
