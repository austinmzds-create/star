// @vitest-environment jsdom
// 回归:商品图抽屉里 MultiUpload 通过 v-model 绑定在 detail.product_images_keys 上。
// 用户连续上传多张后点「保存」,saveInfo 读取的正是 detail.product_images_keys——
// 必须累积保留所有 key(含已存在的旧图 key),不能只剩第一张。
// 复现历史事故:上传后保存,商品图回退成只剩旧的「失效」图。
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import MultiUpload from './MultiUpload.vue'

const mocks = vi.hoisted(() => ({ post: vi.fn(), success: vi.fn() }))
vi.mock('../api', () => ({ default: { post: mocks.post } }))
vi.mock('element-plus', () => ({ ElMessage: { success: mocks.success, error: vi.fn() } }))

// 复刻抽屉「商品信息」页对 MultiUpload 的绑定方式:
// v-model="detail.product_images_keys" + :initial-previews="imgPreviewMap"
const Drawer = defineComponent({
  components: { MultiUpload },
  setup(_, { expose }) {
    // 起始:一张已存在的旧图(可能是 0 字节失效图)
    const detail = ref({
      product_images_keys: ['product/old.jpg'],
      product_images: ['/api/thumbs/160/product/old.jpg?e=1&s=old'],
    })
    // saveInfo 提交时用的就是这个数组
    const savedPayload = ref(null)
    function saveInfo() {
      savedPayload.value = detail.value.product_images_keys || []
    }
    expose({ detail, savedPayload, saveInfo })
    return () => h(MultiUpload, {
      modelValue: detail.value.product_images_keys,
      max: 6,
      prefix: 'product',
      initialPreviews: Object.fromEntries(
        (detail.value.product_images_keys || []).map((k, i) => [k, detail.value.product_images?.[i]]),
      ),
      'onUpdate:modelValue': (keys) => { detail.value.product_images_keys = keys },
    })
  },
})

async function pickFile(wrapper, name) {
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', {
    value: [new File(['x'], name)], configurable: true,
  })
  await input.trigger('change')
  await flushPromises()
  await nextTick()
}

describe('MultiUpload 商品图持久化回归', () => {
  it('连续上传两张后,保存提交保留旧图+两张新图,不丢失', async () => {
    // uploadMaterialFile 每次上传会先打 direct-ticket(未启用 OSS→回退),再打 /api/upload。
    // 用 URL 感知的 mock 按上传文件名返回稳定 key,贴近真实后端兜底行为。
    let seq = 0
    mocks.post.mockImplementation((url) => {
      if (url.startsWith('/api/upload/direct-ticket')) return Promise.resolve({ enabled: false })
      seq += 1
      const key = `product/new${seq}.jpg`
      return Promise.resolve({ key, url: `/api/files/${key}?e=1&s=x` })
    })

    const wrapper = mount(Drawer, { global: { stubs: { ElIcon: true } } })
    const vm = wrapper.vm

    await pickFile(wrapper, 'new1.jpg')
    await pickFile(wrapper, 'new2.jpg')

    // 画廊渲染 3 个槽位(旧图 + 两张新图)
    expect(wrapper.findAll('.thumb')).toHaveLength(3)

    // 点保存:提交的数组必须完整
    vm.saveInfo()
    expect(vm.savedPayload).toEqual([
      'product/old.jpg', 'product/new1.jpg', 'product/new2.jpg',
    ])
  })
})
