# 素材直显与上传即入库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复产品编辑追加商品图的签名预览覆盖问题，并让文件素材上传后自动入库、在管理员和达人两端直接预览。

**Architecture:** `MultiUpload` 只合并有效的签名预览 URL；素材文件上传与素材记录创建由独立服务函数串联，产品页只负责交互状态和刷新。新增共享 `MaterialPreview.vue` 统一视频、图片、PDF、文案和外链渲染，管理员端与达人 H5 复用该组件。

**Tech Stack:** Vue 3、Element Plus、Axios、Vitest、Vue Test Utils、FastAPI 现有素材接口

---

## 文件结构

- Create `web/src/components/MultiUpload.test.js`：复现编辑模式中新签名 URL 被空映射覆盖。
- Modify `web/src/components/MultiUpload.vue`：忽略空的历史预览 URL。
- Create `web/src/components/MaterialPreview.vue`：统一素材内容直显。
- Create `web/src/components/MaterialPreview.test.js`：验证各素材类型渲染。
- Create `web/src/services/materialUpload.js`：串联文件上传和素材记录创建。
- Create `web/src/services/materialUpload.test.js`：验证上传即入库、默认标题、报告 ID 和错误阶段。
- Modify `web/src/views/Products.vue`：上传后自动创建素材并使用共享预览组件。
- Modify `web/src/h5/Materials.vue`：达人端使用共享预览组件并保留下载操作。

### Task 1: 修复商品图追加时的签名预览覆盖

**Files:**
- Create: `web/src/components/MultiUpload.test.js`
- Modify: `web/src/components/MultiUpload.vue:35-49`

- [ ] **Step 1: 写失败测试复现截图场景**

创建测试，使用可触发 `httpRequest` 的 `ElUpload` stub；上传返回签名 URL后模拟父组件把新 key 加入历史映射但 URL 暂为空：

```js
// @vitest-environment jsdom
import { h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import MultiUpload from './MultiUpload.vue'

const { post } = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('../api', () => ({ default: { post } }))
vi.mock('element-plus', () => ({ ElMessage: { success: vi.fn() } }))

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
    post.mockResolvedValue({
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
        stubs: { ElUpload: ElUploadStub, ElIcon: true, Close: true, Plus: true },
      },
    })

    await wrapper.get('[data-testid="upload"]').trigger('click')
    await Promise.resolve()
    await nextTick()

    expect(wrapper.findAll('img').map((img) => img.attributes('src'))).toContain(
      '/api/files/product/new.jpg?e=1&s=signed',
    )
  })
})
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
cd web
npm test -- src/components/MultiUpload.test.js
```

Expected: FAIL，新图 `src` 变成不带查询参数的 `/api/files/product/new.jpg`。

- [ ] **Step 3: 只合并非空预览 URL**

在 `MultiUpload.vue` 增加并使用明确的合并函数：

```js
function mergePreviews(incoming = {}) {
  for (const [key, url] of Object.entries(incoming)) {
    if (url) previews[key] = url
  }
}

watch(() => props.initialPreviews, mergePreviews)
```

保留 `doUpload()` 中 `previews[r.key] = r.url` 的顺序，确保先保存签名 URL 再 emit 新 key。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `cd web && npm test -- src/components/MultiUpload.test.js`

Expected: 1 test passed，0 failed。

- [ ] **Step 5: 提交修复**

```bash
git add web/src/components/MultiUpload.vue web/src/components/MultiUpload.test.js
git commit -m "fix: preserve signed upload previews"
```

### Task 2: 建立共享素材直显组件

**Files:**
- Create: `web/src/components/MaterialPreview.vue`
- Create: `web/src/components/MaterialPreview.test.js`

- [ ] **Step 1: 写各类型渲染的失败测试**

测试视频、图片、PDF、文案和爆款外链：

```js
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
    expect(wrapper.get('img').attributes('src')).toBe('/signed/image.jpg')
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
```

- [ ] **Step 2: 运行测试并确认组件缺失**

Run: `cd web && npm test -- src/components/MaterialPreview.test.js`

Expected: FAIL，无法导入 `MaterialPreview.vue`。

- [ ] **Step 3: 实现共享预览组件**

组件按类型选择唯一主预览，文案和报告 ID 提供复制操作：

```vue
<template>
  <div class="material-preview">
    <video v-if="isVideo && material.url" :src="material.url" controls preload="metadata" />
    <el-image v-else-if="material.type === 'image' && material.url"
      :src="material.url" :preview-src-list="[material.url]" fit="contain" />
    <div v-else-if="material.type === 'pdf' && material.url" class="pdf-preview">
      <iframe :src="material.url" title="质检报告预览" />
      <a :href="material.url" target="_blank" rel="noopener">新窗口打开报告</a>
    </div>
    <div v-else-if="material.parsed_text" class="copy-preview">
      <div class="copy-text">{{ material.parsed_text }}</div>
      <el-button size="small" @click="copy(material.parsed_text)">复制文案</el-button>
    </div>
    <a v-else-if="material.source_link" :href="material.source_link"
      target="_blank" rel="noopener" class="source-card">打开原链接</a>
    <a v-else-if="material.url" :href="material.url" target="_blank" rel="noopener">打开文件</a>

    <div v-if="material.report_id" class="report-id">
      报告ID: {{ material.report_id }}
      <el-button size="small" text @click="copy(material.report_id)">复制</el-button>
    </div>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { computed } from 'vue'

const props = defineProps({ material: { type: Object, required: true } })
const isVideo = computed(() => ['video_ai', 'video_hot', 'video_output'].includes(props.material.type))

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制')
  } catch {
    ElMessage.info('请手动复制')
  }
}
</script>
```

组件样式使用：

```css
.material-preview { width: 100%; margin-top: 10px; }
.material-preview video { display: block; width: 100%; max-height: 320px; background: #111; border-radius: 8px; }
.material-preview :deep(.el-image) { width: 100%; max-height: 320px; border-radius: 8px; }
.material-preview :deep(.el-image img) { max-height: 320px; }
.pdf-preview iframe { display: block; width: 100%; height: 360px; border: 1px solid #e5e7ed; border-radius: 8px; }
.pdf-preview a, .source-card { display: inline-block; margin-top: 8px; color: #6254e8; }
.copy-preview { padding: 12px; background: #f8f9fc; border-radius: 8px; }
.copy-text { margin-bottom: 8px; white-space: pre-wrap; color: #4f566b; }
.report-id { margin-top: 8px; color: #8a93a6; font-size: 12px; }
```

- [ ] **Step 4: 运行组件测试**

Run: `cd web && npm test -- src/components/MaterialPreview.test.js`

Expected: 5 tests passed，0 failed。

- [ ] **Step 5: 提交共享组件**

```bash
git add web/src/components/MaterialPreview.vue web/src/components/MaterialPreview.test.js
git commit -m "feat: add inline material previews"
```

### Task 3: 实现素材上传即入库服务

**Files:**
- Create: `web/src/services/materialUpload.js`
- Create: `web/src/services/materialUpload.test.js`

- [ ] **Step 1: 写两阶段请求与失败阶段测试**

```js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { uploadAndCreateMaterial } from './materialUpload'

describe('uploadAndCreateMaterial', () => {
  it('uploads a file and immediately creates its material record', async () => {
    const api = { post: vi.fn()
      .mockResolvedValueOnce({ key: 'materials/a.mp4', url: '/signed/a.mp4' })
      .mockResolvedValueOnce({ id: 9 }) }
    const file = new File(['video'], '带货视频.mp4', { type: 'video/mp4' })

    await uploadAndCreateMaterial(api, {
      productId: 3, type: 'video_ai', file, title: '', reportId: '',
    })

    expect(api.post.mock.calls[0][0]).toBe('/api/upload')
    expect(api.post.mock.calls[0][1].get('file')).toBe(file)
    expect(api.post.mock.calls[1]).toEqual([
      '/api/products/3/materials',
      { type: 'video_ai', title: '带货视频.mp4', oss_key: 'materials/a.mp4' },
    ])
  })

  it('includes report id for an uploaded PDF', async () => {
    const api = { post: vi.fn()
      .mockResolvedValueOnce({ key: 'materials/a.pdf', url: '/signed/a.pdf' })
      .mockResolvedValueOnce({ id: 10 }) }
    await uploadAndCreateMaterial(api, {
      productId: 3, type: 'pdf', file: new File(['pdf'], '报告.pdf'),
      title: '质检报告', reportId: 'REPORT-1',
    })
    expect(api.post.mock.calls[1][1]).toEqual({
      type: 'pdf', title: '质检报告', oss_key: 'materials/a.pdf', report_id: 'REPORT-1',
    })
  })

  it('marks material creation failures separately from upload failures', async () => {
    const api = { post: vi.fn()
      .mockResolvedValueOnce({ key: 'materials/a.jpg', url: '/signed/a.jpg' })
      .mockRejectedValueOnce(new Error('create failed')) }
    await expect(uploadAndCreateMaterial(api, {
      productId: 3, type: 'image', file: new File(['image'], 'a.jpg'),
    })).rejects.toMatchObject({ materialStage: 'create' })
  })
})
```

- [ ] **Step 2: 运行测试并确认服务缺失**

Run: `cd web && npm test -- src/services/materialUpload.test.js`

Expected: FAIL，无法导入 `uploadAndCreateMaterial`。

- [ ] **Step 3: 实现上传与自动创建服务**

```js
export async function uploadAndCreateMaterial(api, options) {
  const { productId, type, file, title = '', reportId = '', onProgress } = options
  const formData = new FormData()
  formData.append('file', file)

  let uploaded
  try {
    uploaded = await api.post('/api/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (event) => {
        if (event.total && onProgress) onProgress(Math.round((event.loaded / event.total) * 100))
      },
    })
  } catch (error) {
    error.materialStage = 'upload'
    throw error
  }

  const body = { type, title: title.trim() || file.name, oss_key: uploaded.key }
  if (type === 'pdf' && reportId) body.report_id = reportId
  try {
    return await api.post(`/api/products/${productId}/materials`, body)
  } catch (error) {
    error.materialStage = 'create'
    throw error
  }
}
```

- [ ] **Step 4: 运行服务测试**

Run: `cd web && npm test -- src/services/materialUpload.test.js`

Expected: 3 tests passed，0 failed。

- [ ] **Step 5: 提交服务**

```bash
git add web/src/services/materialUpload.js web/src/services/materialUpload.test.js
git commit -m "feat: create materials immediately after upload"
```

### Task 4: 管理员产品中心上传即展示

**Files:**
- Modify: `web/src/views/Products.vue:108-148,246-265,350-365`

- [ ] **Step 1: 接入共享组件和上传服务**

增加导入与状态：

```js
import MaterialPreview from '../components/MaterialPreview.vue'
import { uploadAndCreateMaterial } from '../services/materialUpload'

const matUploading = ref(false)
const matProgress = ref(0)
```

- [ ] **Step 2: 改为上传后立即创建并刷新**

替换 `uploadMat`：

```js
async function uploadMat({ file, onProgress }) {
  matUploading.value = true
  matProgress.value = 0
  try {
    await uploadAndCreateMaterial(api, {
      productId: detail.value.id,
      type: mtype.value,
      file,
      title: matForm.title,
      reportId: matForm.report_id,
      onProgress: (percent) => {
        matProgress.value = percent
        onProgress?.({ percent })
      },
    })
    ElMessage.success('上传成功，素材已添加')
    Object.keys(matForm).forEach((key) => delete matForm[key])
    await refreshDetail()
    await load()
  } catch (error) {
    ElMessage.error(error.materialStage === 'create'
      ? '文件已上传，但素材创建失败，请重试'
      : (error.response?.data?.detail || '文件上传失败'))
  } finally {
    matUploading.value = false
  }
}
```

- [ ] **Step 3: 调整添加区交互**

AI 视频、达人成片、图片、PDF 只显示上传按钮、可选标题和 PDF 报告 ID，不显示“添加”按钮；爆款参考同时显示“上传视频”和外链输入，外链通过原 `addMaterial()` 添加；文案仍通过 `addMaterial()` 添加。上传按钮绑定 `:disabled="matUploading"`，旁边显示 `上传中 {{ matProgress }}%`。

模板使用以下条件控制按钮；文件类型 accept 规则为视频 `video/*`、图片 `image/*`、PDF `application/pdf`：

```vue
<el-upload v-if="mtype !== 'copy'" :show-file-list="false" :http-request="uploadMat"
  :accept="mtype === 'image' ? 'image/*' : mtype === 'pdf' ? 'application/pdf' : 'video/*'">
  <el-button size="small" :loading="matUploading">{{ mtype === 'video_hot' ? '上传视频' : '上传文件' }}</el-button>
</el-upload>
<el-input v-if="mtype === 'video_hot'" v-model="matForm.source_link" placeholder="爆款抖音链接" />
<el-input v-if="mtype === 'copy'" v-model="matForm.parsed_text" type="textarea" :rows="2" placeholder="文案内容" />
<el-input v-if="mtype !== 'copy'" v-model="matForm.title" placeholder="标题(可选，默认文件名)" />
<el-input v-if="mtype === 'pdf'" v-model="matForm.report_id" placeholder="报告ID(可选)" />
<span v-if="matUploading" class="muted">上传中 {{ matProgress }}%</span>
<el-button v-if="mtype === 'video_hot' || mtype === 'copy'" type="primary" size="small" @click="addMaterial">添加</el-button>
```

- [ ] **Step 4: 管理员素材列表直接渲染内容**

每条素材使用：

```vue
<div v-for="m in materialsOf(mtype)" :key="m.id" class="material-card">
  <div class="material-card-head">
    <strong>{{ m.title || MAT_TYPES.find((item) => item.v === m.type)?.l }}</strong>
    <div class="mat-ops">
      <el-icon class="op" @click="openEditMat(m)"><Edit /></el-icon>
      <el-icon class="del" @click="delMaterial(m)"><Delete /></el-icon>
    </div>
  </div>
  <MaterialPreview :material="m" />
</div>
```

删除原来只显示 `el-link` 标题的 `.mat-row` 渲染。

- [ ] **Step 5: 运行前端测试和构建**

Run:

```bash
cd web
npm test
npm run build
```

Expected: 全部测试 PASS；Vite build 退出码 0。

- [ ] **Step 6: 提交管理员端改造**

```bash
git add web/src/views/Products.vue
git commit -m "feat: show uploaded materials immediately"
```

### Task 5: 达人资料中心直接展示素材

**Files:**
- Modify: `web/src/h5/Materials.vue:49-72,79-90,115-130,164-180`

- [ ] **Step 1: 引入共享预览组件**

```js
import MaterialPreview from '../components/MaterialPreview.vue'
```

- [ ] **Step 2: 替换标题链接式素材卡片**

每张 H5 素材卡保留类型和标题头部，在其后直接加入：

```vue
<MaterialPreview :material="m" />
<div v-if="m.downloadable && m.url" class="mat-actions">
  <el-button size="small" type="primary" plain @click="download(m)">下载素材</el-button>
</div>
```

删除 H5 内重复的正文、报告 ID 和“下载 / 查看”链接渲染；复制能力由共享组件提供，下载仍调用原有 `/api/h5/materials/{id}/download` 留痕接口。

- [ ] **Step 3: 运行完整前端验证**

Run:

```bash
cd web
npm test
npm run build
```

Expected: 全部测试 PASS，构建成功，H5 模板无未定义引用。

- [ ] **Step 4: 提交达人端改造**

```bash
git add web/src/h5/Materials.vue
git commit -m "feat: show materials inline for influencers"
```

### Task 6: 浏览器端到端验收

**Files:**
- Verify: `web/src/views/Products.vue`
- Verify: `web/src/h5/Materials.vue`
- Verify: `web/src/components/MultiUpload.vue`
- Verify: `web/src/components/MaterialPreview.vue`

- [ ] **Step 1: 确认当前服务加载最新代码**

Run:

```bash
curl -sS http://127.0.0.1:8000/api/health
curl -sS -I http://127.0.0.1:5173/products
```

Expected: 后端 health 200，前端页面 200；如开发服务已退出，重新启动 Uvicorn 和 Vite。

- [ ] **Step 2: 验证已有商品图后追加新图**

管理员登录后打开产品详情“商品信息”，在已有图片后追加第二张图片。

Expected: 上传后立即显示；保存后仍显示；刷新并重新打开后仍显示。浏览器网络中所有 `/api/files/product/...` 请求都包含 `e`、`s` 参数且返回 200。

- [ ] **Step 3: 验证文件素材上传即入库与直显**

依次上传一个 MP4、JPG 和 PDF。

Expected: 不点击“添加”也分别出现视频播放器、图片预览和 PDF 内嵌预览；刷新产品详情后仍存在。视频、图片、PDF 请求均返回 200，无 403。

- [ ] **Step 4: 验证达人端一致展示**

使用已获得该产品授权的达人验证码登录，打开 `/h5/products/{product_id}`。

Expected: 管理员刚上传的三类素材直接展示；下载按钮仍调用下载留痕接口；未授权达人访问保持 403。

- [ ] **Step 5: 最终验证与状态检查**

```bash
cd web
npm test
npm run build
cd ..
git diff --check origin/claude/influencer-quality-assessment-6rd4lv...HEAD
git status --short --branch
```

Expected: 全部测试通过，构建成功，无空白错误；`server/_uploads/` 测试文件保持未提交。
