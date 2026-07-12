<template>
  <div class="material-preview">
    <video
      v-if="isVideo && material.url"
      :src="material.url"
      controls
      preload="metadata"
    />
    <el-image
      v-else-if="material.type === 'image' && material.url"
      :src="material.url"
      :preview-src-list="[material.url]"
      fit="contain"
    />
    <div v-else-if="material.type === 'pdf' && material.url" class="pdf-preview">
      <iframe :src="material.url" title="质检报告预览" />
      <a :href="material.url" target="_blank" rel="noopener">新窗口打开报告</a>
    </div>
    <div v-else-if="material.parsed_text" class="copy-preview">
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

    <div v-if="material.report_id" class="report-id">
      报告ID: {{ material.report_id }}
      <el-button size="small" text @click="copy(material.report_id)">复制</el-button>
    </div>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { computed } from 'vue'

const props = defineProps({
  material: { type: Object, required: true },
})

const isVideo = computed(() => (
  ['video_ai', 'video_hot', 'video_output'].includes(props.material.type)
))

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
.pdf-preview iframe {
  display: block; width: 100%; height: 360px; border: 1px solid #e5e7ed; border-radius: 8px;
}
.pdf-preview a, .source-card {
  display: inline-block; margin-top: 8px; color: #6254e8; text-decoration: none;
}
.copy-preview { padding: 12px; background: #f8f9fc; border-radius: 8px; }
.copy-text { margin-bottom: 8px; white-space: pre-wrap; color: #4f566b; }
.report-id { margin-top: 8px; color: #8a93a6; font-size: 12px; }
</style>
