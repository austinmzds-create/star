<template>
  <div class="h5-wrap">
    <h2>拍摄前必读</h2>
    <p class="sub">以下为近期卡审/违规案例,加星为高频重点,拍摄前请逐条规避。</p>

    <el-empty v-if="rows.length === 0" description="暂无卡审记录" />

    <el-card v-for="r in rows" :key="r.id" class="item" :class="{ star: r.starred }">
      <div class="head">
        <el-tag v-if="r.starred" size="small" type="warning" effect="dark">重点</el-tag>
        <el-tag v-if="r.tag" size="small" type="danger">{{ r.tag }}</el-tag>
        <span class="date">{{ fmt(r.happened_at) }}</span>
      </div>
      <div v-if="r.text" class="text">{{ r.text }}</div>
      <el-image v-if="r.screenshot_url" :src="r.screenshot_url" :preview-src-list="[r.screenshot_url]"
                fit="cover" class="shot" />
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import api from '../api'

const rows = ref([])

function fmt(s) { return s ? String(s).replace('T', ' ').slice(0, 10) : '' }

onMounted(async () => {
  rows.value = await api.get('/api/h5/notice')
})
</script>

<style scoped>
.h5-wrap { max-width: 480px; margin: 0 auto; padding: 24px 16px; }
.sub { color: #999; font-size: 13px; margin: 4px 0 16px; }
.item { margin-top: 10px; }
.item.star { border: 1px solid #e6a23c; background: #fdf6ec; }
.head { display: flex; align-items: center; gap: 6px; }
.head .date { color: #999; font-size: 12px; margin-left: auto; }
.text { margin: 8px 0; line-height: 1.5; white-space: pre-wrap; }
.shot { width: 100%; border-radius: 6px; }
</style>
