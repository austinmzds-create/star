<template>
  <div class="h5-wrap" v-if="d">
    <h2>{{ d.name }}</h2>
    <el-card v-if="d.selling_points" header="卖点">{{ d.selling_points }}</el-card>
    <el-card v-if="d.shooting_notes" header="拍摄要求(拍摄前必读)" style="margin-top: 8px">
      {{ d.shooting_notes }}
    </el-card>

    <h3>素材</h3>
    <el-card v-for="m in d.materials" :key="m.id" class="mat">
      <div>
        <el-tag size="small">{{ TYPE_LABEL[m.type] || m.type }}</el-tag>
        {{ m.title }}
        <span v-if="m.report_id" style="color: #999">报告ID: {{ m.report_id }}(发布视频时挂在下方)</span>
      </div>
      <el-button v-if="m.downloadable" size="small" style="margin-top: 8px" @click="download(m)">
        下载
      </el-button>
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import api from '../api'

const TYPE_LABEL = {
  video_ai: 'AI视频', video_hot: '爆款参考', video_output: '达人成片',
  image: '图片', pdf: '质检报告', copy: '文案',
}

const route = useRoute()
const d = ref(null)

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
</style>
