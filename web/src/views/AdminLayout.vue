<template>
  <el-container style="height: 100vh">
    <el-aside width="200px">
      <div class="logo">达人管理平台</div>
      <el-menu :default-active="$route.path" router>
        <el-menu-item index="/workbench">工作台</el-menu-item>
        <el-menu-item index="/influencers">达人库</el-menu-item>
        <el-menu-item index="/products">产品中心</el-menu-item>
        <el-menu-item index="/samples">
          <span class="menu-entry">
            <span>寄样管理</span>
            <el-badge v-if="samplesBadge" :value="samplesBadge" class="menu-badge" />
          </span>
        </el-menu-item>
        <el-menu-item index="/followups">
          <span class="menu-entry">
            <span>催拍待办</span>
            <el-badge v-if="followupCount" :value="followupCount" class="menu-badge" />
          </span>
        </el-menu-item>
        <el-menu-item index="/videos">
          <span class="menu-entry">
            <span>视频与投流</span>
            <el-badge v-if="videoBadge" :value="videoBadge" class="menu-badge" />
          </span>
        </el-menu-item>
        <el-menu-item index="/block-records">卡审知识库</el-menu-item>
        <el-menu-item v-if="isAdmin" index="/connections">
          <span class="menu-entry">
            <span>建联审核</span>
            <el-badge v-if="connectionCount" :value="connectionCount" class="menu-badge" />
          </span>
        </el-menu-item>
        <el-menu-item v-if="isAdmin" index="/dashboard">总览看板</el-menu-item>
        <el-menu-item v-if="isAdmin" index="/settings">配置中心</el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <span>{{ user.name }}({{ user.role === 'admin' ? '管理员' : '商务' }})</span>
        <el-button link @click="logout">退出</el-button>
      </el-header>
      <el-main><router-view /></el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'

const router = useRouter()
const user = JSON.parse(localStorage.getItem('user') || '{}')
const isAdmin = computed(() => user.role === 'admin')
const followupCount = ref(0)
const connectionCount = ref(0)
const todos = ref({})
let badgeTimer = null
let badgeDebounce = null
let refreshingBadges = false
let refreshAgain = false

const samplesBadge = computed(() => (
  Number(todos.value.pending_sample || 0) + Number(todos.value.to_ship || 0)
))
const videoBadge = computed(() => (
  Number(todos.value.pending_video || 0) + Number(todos.value.pending_promotion || 0)
))

function logout() {
  localStorage.clear()
  router.push('/login')
}

async function refreshBadges() {
  if (refreshingBadges) {
    refreshAgain = true
    return
  }
  refreshingBadges = true
  try {
    const [workbenchRes, connectionRes] = await Promise.allSettled([
      api.get('/api/dashboard/workbench'),
      isAdmin.value ? api.get('/api/connection-requests/pending-count') : Promise.resolve({ count: 0 }),
    ])
    if (workbenchRes.status === 'fulfilled') {
      todos.value = workbenchRes.value.todos || {}
      followupCount.value = Number(todos.value.followup || 0)
    }
    if (isAdmin.value && connectionRes.status === 'fulfilled') {
      connectionCount.value = Number(connectionRes.value.count || 0)
    }
  } catch (e) { /* ignore */ }
  refreshingBadges = false
  if (refreshAgain) {
    refreshAgain = false
    scheduleRefreshBadges()
  }
}

function scheduleRefreshBadges() {
  if (badgeDebounce) clearTimeout(badgeDebounce)
  badgeDebounce = setTimeout(refreshBadges, 250)
}

onMounted(async () => {
  await refreshBadges()
  window.addEventListener('nav-badge-refresh', scheduleRefreshBadges)
  badgeTimer = setInterval(refreshBadges, 30000)
})
onBeforeUnmount(() => {
  window.removeEventListener('nav-badge-refresh', scheduleRefreshBadges)
  if (badgeDebounce) clearTimeout(badgeDebounce)
  if (badgeTimer) clearInterval(badgeTimer)
})
</script>

<style scoped>
.logo { padding: 16px; font-weight: bold; text-align: center; }
.header { display: flex; align-items: center; justify-content: flex-end; gap: 12px; background: #fff; }
.menu-entry { display: inline-flex; align-items: center; gap: 8px; }
.menu-badge { display: inline-flex; align-items: center; }
.menu-badge :deep(.el-badge__content) {
  position: static;
  transform: none;
  line-height: 18px;
}
</style>
