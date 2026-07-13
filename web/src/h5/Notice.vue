<template>
  <div class="h5-wrap">
    <div class="topbar">
      <el-button size="small" type="primary" plain @click="$router.push('/h5')">← 返回产品列表</el-button>
    </div>
    <h2>拍摄前必读</h2>
    <p class="sub">以下为近期卡审/违规案例,加星为高频重点,拍摄前请逐条规避。</p>

    <el-empty v-if="rows.length === 0" description="暂无卡审记录" />

    <el-card v-for="r in rows" :key="r.id" class="item" :class="{ star: r.starred }">
      <div class="head">
        <el-tag v-if="r.starred" size="small" type="warning" effect="dark">重点</el-tag>
        <el-tag v-if="r.tag" size="small" type="danger">{{ r.tag }}</el-tag>
        <span class="date">{{ ft(r.happened_at) }}</span>
      </div>
      <div v-if="r.text" class="text">{{ r.text }}</div>
      <div v-if="r.screenshots?.length" class="shots">
        <el-image v-for="(u, i) in r.screenshots" :key="i" :src="u" :preview-src-list="r.screenshots"
                  :initial-index="i" fit="cover" class="shot" />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import api from '../api'
import { formatTime as ft } from '../utils/time'

const rows = ref([])

onMounted(async () => {
  rows.value = await api.get('/api/h5/notice')
})
</script>

<style scoped>
.h5-wrap { max-width: 480px; margin: 0 auto; padding: 24px 16px; }
.topbar { margin-bottom: 12px; }
.sub { color: #999; font-size: 13px; margin: 4px 0 16px; }
.item { margin-top: 10px; }
.item.star { border: 1px solid #e6a23c; background: #fdf6ec; }
.head { display: flex; align-items: center; gap: 6px; }
.head .date { color: #999; font-size: 12px; margin-left: auto; }
.text { margin: 8px 0; line-height: 1.5; white-space: pre-wrap; }
.shots { display: flex; flex-wrap: wrap; gap: 6px; }
.shot { width: 96px; height: 96px; border-radius: 6px; }
</style>
