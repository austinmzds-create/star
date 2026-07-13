<template>
  <div class="login-wrap">
    <div class="brand">
      <div class="logo">达</div>
      <h2>达人合作中心</h2>
      <p class="sub">手机号验证码进入</p>
    </div>
    <el-input v-model="phone" placeholder="手机号" size="large" maxlength="11" class="fld" @keyup.enter="verify" />
    <div class="row">
      <el-input v-model="code" placeholder="验证码" size="large" maxlength="6" @keyup.enter="verify" />
      <el-button size="large" :disabled="cd > 0 || sending" @click="send">{{ cd > 0 ? `${cd}s` : '获取验证码' }}</el-button>
    </div>
    <el-button type="primary" size="large" style="width: 100%" :loading="verifying" @click="verify">进入</el-button>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { onBeforeUnmount, ref } from 'vue'
import api from '../api'
import { applyRoleSession } from '../test-role-session'

const emit = defineEmits(['logged-in'])

const phone = ref('')
const code = ref('')
const cd = ref(0)
const sending = ref(false)
const verifying = ref(false)
let timer = null

async function send() {
  if (phone.value.length !== 11 || !phone.value.startsWith('1')) return ElMessage.warning('请输入正确的11位手机号')
  sending.value = true
  try {
    await api.post('/api/h5/sms/send', { phone: phone.value })
    ElMessage.success('验证码已发送')
    cd.value = 60
    timer = setInterval(() => { if (--cd.value <= 0) clearInterval(timer) }, 1000)
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '发送失败')
  } finally {
    sending.value = false
  }
}

async function verify() {
  if (phone.value.length !== 11) return ElMessage.warning('请输入手机号')
  if (!code.value) return ElMessage.warning('请输入验证码')
  verifying.value = true
  try {
    const data = await api.post('/api/h5/sms/verify', { phone: phone.value, code: code.value })
    applyRoleSession({ token: data.token, kind: 'influencer', user: { role: 'influencer', name: data.nickname } })
    emit('logged-in', data)
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '验证码错误或已过期')
  } finally {
    verifying.value = false
  }
}

onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<style scoped>
.login-wrap { max-width: 380px; margin: 0 auto; padding: 15vh 20px 0; }
.brand { text-align: center; margin-bottom: 28px; }
.logo { width: 52px; height: 52px; margin: 0 auto 12px; border-radius: 15px; background: linear-gradient(135deg, #6b5cf6, #8b7cf9); color: #fff; font-size: 26px; font-weight: 700; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 20px rgba(107, 92, 246, 0.28); }
.brand h2 { margin: 0; font-size: 20px; }
.sub { color: #8a93a6; font-size: 13px; margin: 8px 0 0; }
.fld { margin-bottom: 12px; }
.row { display: flex; gap: 8px; margin-bottom: 16px; }
</style>
