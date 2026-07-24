<template>
  <div v-if="visible" class="test-role-switcher">
    <el-dropdown trigger="click" :disabled="loading" @command="switchRole">
      <el-button size="small" type="warning" plain>
        测试身份：{{ roleLabel }} ▾
      </el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="admin">管理员</el-dropdown-item>
          <el-dropdown-item command="bd">商务</el-dropdown-item>
          <el-dropdown-item command="influencer">达人</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import api from '../api'
import { applyRoleSession } from '../test-role-session'

const TEST_STAFF_TOKEN_KEY = 'test_staff_token'
const loading = ref(false)
const user = ref(JSON.parse(localStorage.getItem('user') || 'null'))
const visible = ref(false)
const roleLabel = computed(() => (
  { admin: '管理员', bd: '商务', influencer: '达人' }[user.value?.role] || '未登录'
))

function rememberStaffToken() {
  const token = localStorage.getItem('token')
  if (user.value?.role === 'admin' && token) {
    localStorage.setItem(TEST_STAFF_TOKEN_KEY, token)
  }
}

function refreshVisibility() {
  visible.value = Boolean(
    localStorage.getItem('token')
    && (user.value?.role === 'admin' || localStorage.getItem(TEST_STAFF_TOKEN_KEY))
  )
}

function sync() {
  user.value = JSON.parse(localStorage.getItem('user') || 'null')
  rememberStaffToken()
  refreshVisibility()
}

async function switchRole(role) {
  loading.value = true
  try {
    rememberStaffToken()
    const staffToken = localStorage.getItem(TEST_STAFF_TOKEN_KEY)
    const data = await api.post('/api/auth/dev-switch', { role }, {
      headers: staffToken ? { Authorization: `Bearer ${staffToken}` } : undefined,
    })
    const destination = applyRoleSession(data)
    location.href = destination
  } catch (error) {
    ElMessage.error(error.response?.data?.detail || '切换失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  sync()
  window.addEventListener('role-session-changed', sync)
})
onBeforeUnmount(() => window.removeEventListener('role-session-changed', sync))
</script>

<style scoped>
.test-role-switcher {
  position: fixed;
  top: 12px;
  right: 104px;
  z-index: 3000;
}

@media (max-width: 600px) {
  .test-role-switcher { top: auto; right: 12px; bottom: 12px; }
}
</style>
