<template>
  <div class="login-wrap">
    <el-card style="width: 360px">
      <h2 style="text-align: center">达人管理平台</h2>
      <el-form @submit.prevent="submit">
        <el-form-item>
          <el-input v-model="username" placeholder="用户名" size="large" />
        </el-form-item>
        <el-form-item>
          <el-input v-model="password" type="password" placeholder="密码" size="large" show-password />
        </el-form-item>
        <el-button type="primary" size="large" style="width: 100%" @click="submit">登录</el-button>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'

const username = ref('')
const password = ref('')
const router = useRouter()

async function submit() {
  try {
    const data = await api.post('/api/auth/login', { username: username.value, password: password.value })
    localStorage.setItem('token', data.token)
    localStorage.setItem('user', JSON.stringify(data.user))
    router.push('/influencers')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '登录失败')
  }
}
</script>

<style scoped>
.login-wrap { display: flex; align-items: center; justify-content: center; height: 100vh; }
</style>
