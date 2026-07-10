<template>
  <el-container style="height: 100vh">
    <el-aside width="200px">
      <div class="logo">达人管理平台</div>
      <el-menu :default-active="$route.path" router>
        <el-menu-item index="/influencers">达人库</el-menu-item>
        <el-menu-item index="/samples">寄样管理</el-menu-item>
        <el-menu-item index="/products">产品中心</el-menu-item>
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
import { computed } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const user = JSON.parse(localStorage.getItem('user') || '{}')
const isAdmin = computed(() => user.role === 'admin')

function logout() {
  localStorage.clear()
  router.push('/login')
}
</script>

<style scoped>
.logo { padding: 16px; font-weight: bold; text-align: center; }
.header { display: flex; align-items: center; justify-content: flex-end; gap: 12px; background: #fff; }
</style>
