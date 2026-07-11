<template>
  <div class="login-wrap">
    <div class="login-card">
      <div class="brand">
        <div class="logo">达</div>
        <h2>达人管理平台</h2>
        <p class="sub">手机号验证码登录</p>
      </div>
      <el-input v-model="phone" placeholder="手机号" size="large" maxlength="11" class="fld" />
      <div class="code-row">
        <el-input v-model="code" placeholder="验证码" size="large" maxlength="6" />
        <el-button size="large" :disabled="cd > 0" @click="send">
          {{ cd > 0 ? `${cd}s` : '获取验证码' }}
        </el-button>
      </div>
      <el-button type="primary" size="large" class="submit" :loading="loading" @click="login">
        登录
      </el-button>
      <p class="hint">管理员/商务/达人统一手机登录,身份自动识别</p>
    </div>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'

const phone = ref('')
const code = ref('')
const cd = ref(0)
const loading = ref(false)
const router = useRouter()

async function send() {
  if (phone.value.length !== 11) return ElMessage.warning('请输入11位手机号')
  try {
    await api.post('/api/auth/sms/send', { phone: phone.value })
    ElMessage.success('验证码已发送')
    cd.value = 60
    const t = setInterval(() => { if (--cd.value <= 0) clearInterval(t) }, 1000)
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '发送失败')
  }
}

async function login() {
  if (!phone.value || !code.value) return ElMessage.warning('请填写手机号和验证码')
  loading.value = true
  try {
    const data = await api.post('/api/auth/sms/login', { phone: phone.value, code: code.value })
    localStorage.setItem('token', data.token)
    localStorage.setItem('user', JSON.stringify(data.user))
    if (data.kind === 'influencer') {
      localStorage.setItem('h5_token', data.token)
      router.push('/h5')
    } else {
      router.push('/influencers')
    }
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '登录失败')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-wrap {
  display: flex; align-items: center; justify-content: center; height: 100vh;
  background: linear-gradient(135deg, #f5f7fb 0%, #eef1f8 100%);
}
.login-card {
  width: 360px; padding: 40px 32px; background: #fff; border-radius: 16px;
  box-shadow: 0 8px 40px rgba(20, 30, 60, 0.08);
}
.brand { text-align: center; margin-bottom: 28px; }
.logo {
  width: 52px; height: 52px; margin: 0 auto 12px; border-radius: 14px;
  background: linear-gradient(135deg, #4f6ef7, #7a5cf6); color: #fff;
  font-size: 26px; font-weight: 700; display: flex; align-items: center; justify-content: center;
}
.brand h2 { margin: 0; font-size: 20px; color: #1f2637; }
.sub { margin: 6px 0 0; color: #8a93a6; font-size: 13px; }
.fld { margin-bottom: 12px; }
.code-row { display: flex; gap: 8px; margin-bottom: 20px; }
.submit { width: 100%; }
.hint { margin: 16px 0 0; text-align: center; color: #a6adbd; font-size: 12px; }
</style>
