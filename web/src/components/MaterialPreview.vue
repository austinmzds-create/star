<template>
  <div class="material-preview">
    <video
      v-if="isVideo && shouldRenderPreview && previewUrl"
      :src="previewUrl"
      controls
      preload="metadata"
    />
    <div v-else-if="isVideo && material.url" class="file-preview-card">
      <span>视频文件已上传</span>
      <div class="file-actions">
        <el-button size="small" type="primary" plain @click="showPreview">预览</el-button>
        <a :href="material.download_url || material.url" target="_blank" rel="noopener">打开/下载</a>
      </div>
    </div>
    <el-image
      v-else-if="isImageLike && material.url"
      :key="imageUrl"
      :src="imageUrl"
      fit="contain"
      @error="imageFailed = true"
    />
    <div v-if="imageFailed" class="image-error">
      <span>图片暂未加载成功</span>
      <el-button size="small" text type="primary" @click="retryImage">重新加载</el-button>
      <a :href="material.url" target="_blank" rel="noopener">打开原图</a>
    </div>
    <div v-else-if="material.type === 'pdf' && !isImageLike && shouldRenderPreview && previewUrl" class="pdf-preview">
      <iframe :src="previewUrl" title="质检报告预览" />
      <a :href="material.url" target="_blank" rel="noopener">新窗口打开报告</a>
    </div>
    <div v-else-if="material.type === 'pdf' && !isImageLike && material.url" class="file-preview-card">
      <span>报告文件已上传</span>
      <div class="file-actions">
        <el-button size="small" type="primary" plain @click="showPreview">预览</el-button>
        <a :href="material.download_url || material.url" target="_blank" rel="noopener">打开/下载</a>
      </div>
    </div>
    <div v-else-if="material.type === 'copy' && material.parsed_text" class="copy-preview">
      <div class="copy-text">{{ material.parsed_text }}</div>
      <el-button size="small" @click="copy(material.parsed_text)">复制文案</el-button>
    </div>
    <a
      v-else-if="material.source_link"
      :href="material.source_link"
      target="_blank"
      rel="noopener"
      class="source-card"
    >
      打开原链接
    </a>
    <a v-else-if="material.url" :href="material.url" target="_blank" rel="noopener">
      打开文件
    </a>

    <div v-if="material.type !== 'copy' && material.parsed_text" class="material-caption">
      <div class="caption-title">说明文案</div>
      <div class="caption-text">{{ material.parsed_text }}</div>
      <el-button size="small" text type="primary" @click="copy(material.parsed_text)">复制文案</el-button>
    </div>

    <div v-if="material.report_id" class="report-id">
      报告ID: {{ material.report_id }}
      <el-button size="small" text @click="copy(material.report_id)">复制</el-button>
    </div>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { computed, ref, watch } from 'vue'

const props = defineProps({
  material: { type: Object, required: true },
})

const isVideo = computed(() => (
  ['video_ai', 'video_hot', 'video_output'].includes(props.material.type)
))
// 是否按图片预览:后端已按存储对象类型给出 is_image(质检报告传图片也为 true),
// 不再依赖前端拿 key/扩展名(前端只用域名+id)。
const isImageLike = computed(() => (
  props.material.is_image === true || props.material.type === 'image'
))
const manualPreview = ref(false)
const retryToken = ref(0)
const imageFailed = ref(false)
const previewUrl = computed(() => props.material.preview_url || props.material.url)
const shouldRenderPreview = computed(() => props.material.inline_preview !== false || manualPreview.value)
const imageUrl = computed(() => {
  if (!props.material.url || retryToken.value === 0) return props.material.url
  const joiner = props.material.url.includes('?') ? '&' : '?'
  return `${props.material.url}${joiner}_preview_retry=${retryToken.value}`
})

watch(() => [props.material.url, props.material.preview_url], () => {
  manualPreview.value = false
  retryToken.value = 0
  imageFailed.value = false
})

function showPreview() {
  manualPreview.value = true
}

function retryImage() {
  imageFailed.value = false
  retryToken.value += 1
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制')
  } catch {
    ElMessage.info('请手动复制')
  }
}
</script>

<style scoped>
.material-preview { width: 100%; margin-top: 10px; }
.material-preview video {
  display: block; width: 100%; max-height: 320px; background: #111; border-radius: 8px;
}
.material-preview :deep(.el-image) {
  width: 100%; max-height: 320px; border-radius: 8px; background: #f7f8fb;
}
.material-preview :deep(.el-image img) { max-height: 320px; }
.image-error {
  display: flex; align-items: center; gap: 8px; margin-top: 8px;
  color: #e6a23c; font-size: 12px;
}
.image-error a { color: #6254e8; text-decoration: none; }
.pdf-preview iframe {
  display: block; width: 100%; height: 360px; border: 1px solid #e5e7ed; border-radius: 8px;
}
.pdf-preview a, .source-card {
  display: inline-block; margin-top: 8px; color: #6254e8; text-decoration: none;
}
.file-preview-card {
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
  padding: 12px; border: 1px solid #eef0f5; border-radius: 8px; background: #f8f9fc;
  color: #4f566b;
}
.file-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.file-actions a { color: #6254e8; text-decoration: none; }
.copy-preview { padding: 12px; background: #f8f9fc; border-radius: 8px; }
.copy-text { margin-bottom: 8px; white-space: pre-wrap; color: #4f566b; }
.material-caption {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f8f9fc;
  border: 1px solid #eef0f5;
}
.caption-title { font-size: 12px; color: #8a93a6; margin-bottom: 4px; }
.caption-text { white-space: pre-wrap; color: #4f566b; line-height: 1.55; }
.report-id { margin-top: 8px; color: #8a93a6; font-size: 12px; }
</style>
