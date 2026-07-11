<template>
  <div class="h5-wrap" v-if="d">
    <h2>{{ d.name }}</h2>
    <el-card v-if="d.selling_points" header="卖点">{{ d.selling_points }}</el-card>
    <el-card v-if="d.shooting_notes" header="拍摄要求(拍摄前必读)" style="margin-top: 8px">
      {{ d.shooting_notes }}
    </el-card>

    <h3>素材</h3>
    <el-card v-for="m in d.materials" :key="m.id" class="mat">
      <div class="mat-head">
        <el-tag size="small">{{ TYPE_LABEL[m.type] || m.type }}</el-tag>
        <span v-if="m.title">{{ m.title }}</span>
      </div>
      <div v-if="m.parsed_text" class="copy-block">
        <div class="txt">{{ m.parsed_text }}</div>
        <el-button size="small" @click="copy(m.parsed_text)">复制文案</el-button>
      </div>
      <div v-if="m.report_id" class="muted" style="font-size:12px;margin-top:6px">报告ID: {{ m.report_id }}(发布视频时挂在下方)</div>
      <div style="margin-top:8px">
        <el-link v-if="m.source_link" :href="m.source_link" target="_blank" type="primary">查看爆款</el-link>
        <el-button v-else-if="m.downloadable && m.url" size="small" @click="download(m)">下载/查看</el-button>
      </div>
    </el-card>
    <el-empty v-if="!d.materials.length" description="暂无素材" :image-size="60" />
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import api from '../api'

const TYPE_LABEL = {
  video_ai: 'AI视频', video_hot: '爆款参考', video_output: '达人成片',
  image: '图片', pdf: '质检报告', copy: '文案',
}

const route = useRoute()
const d = ref(null)

async function copy(t) {
  try { await navigator.clipboard.writeText(t); ElMessage.success('已复制') } catch { ElMessage.info('请长按复制') }
}
async function download(m) {
  const { url } = await api.post(`/api/h5/materials/${m.id}/download`)
  window.open(url, '_blank')
}

onMounted(async () => {
  d.value = await api.get(`/api/h5/products/${route.params.id}/materials`)
})
</script>

<style scoped>
.h5-wrap { max-width: 480px; margin: 0 auto; padding: 24px 16px; }
.mat { margin-top: 8px; }
.mat-head { display: flex; align-items: center; gap: 8px; }
.copy-block { margin-top: 8px; background: #f8f9fc; border-radius: 8px; padding: 10px; }
.txt { color: #5a6072; font-size: 14px; margin-bottom: 8px; white-space: pre-wrap; }
.muted { color: #8a93a6; }
</style>
