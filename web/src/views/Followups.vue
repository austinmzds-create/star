<template>
  <div>
    <div class="toolbar">
      <el-radio-group v-model="status" @change="load">
        <el-radio-button value="open">待处理</el-radio-button>
        <el-radio-button value="done">已处理</el-radio-button>
      </el-radio-group>
      <el-button v-if="isAdmin" @click="scan">立即扫描</el-button>
    </div>

    <el-table :data="rows" v-loading="loading">
      <el-table-column prop="influencer_nickname" label="达人" />
      <el-table-column prop="note" label="待办" />
      <el-table-column label="生成时间" width="200">
        <template #default="{ row }">{{ ft(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="140">
        <template #default="{ row }">
          <el-button v-if="row.status === 'open'" size="small" type="primary" @click="done(row)">
            标记已跟进
          </el-button>
          <span v-else style="color: #909399">已处理</span>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!rows.length" description="暂无催拍待办" />
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { onMounted, ref } from 'vue'
import api from '../api'
import { formatTime as ft } from '../utils/time'

const user = JSON.parse(localStorage.getItem('user') || '{}')
const isAdmin = user.role === 'admin'
const status = ref('open')
const rows = ref([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    rows.value = await api.get('/api/followups', { params: { status: status.value } })
  } finally {
    loading.value = false
  }
}

async function done(row) {
  await api.post(`/api/followups/${row.id}/done`)
  ElMessage.success('已标记')
  load()
}

async function scan() {
  const r = await api.post('/api/followups/scan')
  ElMessage.success(`扫描完成,新增 ${r.created} 条催拍待办`)
  load()
}

onMounted(load)
</script>

<style scoped>
.toolbar { display: flex; gap: 12px; margin-bottom: 16px; }
</style>
