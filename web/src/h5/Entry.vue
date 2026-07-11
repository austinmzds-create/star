<template>
  <div class="h5-wrap">
    <h2>达人合作申请</h2>

    <template v-if="!token">
      <el-input v-model="phone" placeholder="手机号" size="large" maxlength="11" />
      <div class="row">
        <el-input v-model="code" placeholder="验证码" size="large" maxlength="6" />
        <el-button :disabled="cd > 0" @click="send">{{ cd > 0 ? `${cd}s` : '获取验证码' }}</el-button>
      </div>
      <el-button type="primary" size="large" style="width: 100%" @click="verify">进入</el-button>
    </template>

    <template v-else>
      <el-input v-model="intro" type="textarea" :rows="6"
        placeholder="把你的自我介绍粘贴到这里(抖音号、主页链接、粉丝数等),提交后我们会尽快联系你" />
      <el-button type="primary" size="large" style="width: 100%; margin-top: 12px" @click="submit">
        一键提交申请
      </el-button>

      <el-button type="warning" plain style="width: 100%; margin-top: 16px"
        @click="$router.push('/h5/notice')">📌 拍摄前必读(卡审避坑)</el-button>

      <h3 style="margin-top: 24px">已开放给你的产品</h3>
      <el-card v-for="p in products" :key="p.id" class="prod"
        @click="$router.push(`/h5/products/${p.id}`)">
        {{ p.name }} <span style="color: #999">{{ p.price_text }}</span>
      </el-card>
      <el-empty v-if="!products.length" description="暂无开放产品,提交资料后等待商务开通" />
    </template>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { onMounted, ref } from 'vue'
import api from '../api'

const phone = ref('')
const code = ref('')
const cd = ref(0)
const token = ref(localStorage.getItem('h5_token'))
const intro = ref('')
const products = ref([])

async function send() {
  await api.post('/api/h5/sms/send', { phone: phone.value })
  cd.value = 60
  const t = setInterval(() => { if (--cd.value <= 0) clearInterval(t) }, 1000)
}

async function verify() {
  const data = await api.post('/api/h5/sms/verify', { phone: phone.value, code: code.value })
  localStorage.setItem('h5_token', data.token)
  localStorage.setItem('token', data.token) // h5 请求共用拦截器
  token.value = data.token
  loadProducts()
}

async function submit() {
  await api.post('/api/h5/submit', { text: intro.value })
  ElMessage.success('已提交,商务会尽快与你联系')
}

async function loadProducts() {
  products.value = await api.get('/api/h5/products')
}

onMounted(() => { if (token.value) loadProducts() })
</script>

<style scoped>
.h5-wrap { max-width: 480px; margin: 0 auto; padding: 24px 16px; }
.row { display: flex; gap: 8px; margin: 12px 0; }
.prod { margin-top: 8px; cursor: pointer; }
</style>
