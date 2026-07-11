<template>
  <div class="h5-wrap">
    <!-- 未登录:验证码进入 -->
    <template v-if="!token">
      <div class="brand"><div class="logo">达</div><h2>达人合作</h2><p class="sub">手机号验证码进入</p></div>
      <el-input v-model="phone" placeholder="手机号" size="large" maxlength="11" class="fld" />
      <div class="row">
        <el-input v-model="code" placeholder="验证码" size="large" maxlength="6" />
        <el-button size="large" :disabled="cd > 0" @click="send">{{ cd > 0 ? `${cd}s` : '获取验证码' }}</el-button>
      </div>
      <el-button type="primary" size="large" style="width: 100%" @click="verify">进入</el-button>
    </template>

    <!-- 已登录 -->
    <template v-else>
      <div class="hi">你好{{ me?.nickname ? '，' + me.nickname : '' }} 👋</div>

      <!-- 资料未完善提示 -->
      <el-card v-if="me && !me.has_profile" class="tip">
        <div style="font-weight:600;margin-bottom:6px">完善你的资料</div>
        <el-input v-model="intro" type="textarea" :rows="4"
          placeholder="把自我介绍粘贴到这里(抖音号、主页链接、粉丝数、收件信息等),提交后商务会尽快联系你" />
        <el-button type="primary" style="width:100%;margin-top:10px" @click="submit">一键提交</el-button>
      </el-card>

      <el-button type="warning" plain style="width: 100%; margin-top: 12px"
        @click="$router.push('/h5/notice')">📌 拍摄前必读(卡审避坑)</el-button>

      <h3>已开放给你的产品</h3>
      <el-card v-for="p in products" :key="p.id" class="prod" @click="$router.push(`/h5/products/${p.id}`)">
        <div class="prod-in">
          <el-image v-if="p.product_image" :src="p.product_image" fit="cover" class="pimg" />
          <div class="pimg placeholder" v-else></div>
          <div><div class="pname">{{ p.name }}</div><div class="muted">{{ p.price_text }}</div></div>
          <el-icon class="arr"><ArrowRight /></el-icon>
        </div>
      </el-card>
      <el-empty v-if="!products.length" description="暂无开放产品,完善资料后等待商务开通" :image-size="70" />

      <template v-if="me && me.samples.length">
        <h3>我的寄样</h3>
        <el-card v-for="(s, i) in me.samples" :key="i" class="prod">
          <div class="prod-in">
            <span>{{ s.product_name }}</span>
            <el-tag size="small" :type="s.signed ? 'success' : 'info'" style="margin-left:auto">
              {{ sampleLabel(s) }}
            </el-tag>
          </div>
          <div v-if="s.tracking_no" class="muted" style="font-size:12px;margin-top:4px">单号 {{ s.tracking_no }}</div>
        </el-card>
      </template>
    </template>
  </div>
</template>

<script setup>
import { ArrowRight } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { onMounted, ref } from 'vue'
import api from '../api'

const STATUS = { pending: '待审批', approved: '待发货', shipped: '已发货', in_transit: '运输中', signed: '已签收', rejected: '已拒绝' }
const phone = ref('')
const code = ref('')
const cd = ref(0)
const token = ref(localStorage.getItem('h5_token'))
const intro = ref('')
const products = ref([])
const me = ref(null)

const sampleLabel = (s) => STATUS[s.status] || s.status

async function send() {
  if (phone.value.length !== 11) return ElMessage.warning('请输入11位手机号')
  await api.post('/api/h5/sms/send', { phone: phone.value })
  ElMessage.success('验证码已发送')
  cd.value = 60
  const t = setInterval(() => { if (--cd.value <= 0) clearInterval(t) }, 1000)
}
async function verify() {
  const data = await api.post('/api/h5/sms/verify', { phone: phone.value, code: code.value })
  localStorage.setItem('h5_token', data.token)
  localStorage.setItem('token', data.token)
  localStorage.setItem('user', JSON.stringify({ role: 'influencer', name: data.nickname }))
  token.value = data.token
  loadAll()
}
async function submit() {
  await api.post('/api/h5/submit', { text: intro.value })
  ElMessage.success('已提交,商务会尽快与你联系')
  loadAll()
}
async function loadAll() {
  products.value = await api.get('/api/h5/products')
  me.value = await api.get('/api/h5/me')
}

onMounted(() => { if (token.value) loadAll() })
</script>

<style scoped>
.h5-wrap { max-width: 480px; margin: 0 auto; padding: 24px 16px; }
.brand { text-align: center; margin-bottom: 24px; }
.logo { width: 48px; height: 48px; margin: 0 auto 10px; border-radius: 14px; background: linear-gradient(135deg,#6b5cf6,#8b7cf9); color:#fff; font-size:24px; font-weight:700; display:flex; align-items:center; justify-content:center; }
.brand h2 { margin: 0; } .sub { color:#8a93a6; font-size:13px; margin:6px 0 0; }
.fld { margin-bottom: 12px; } .row { display: flex; gap: 8px; margin-bottom: 16px; }
.hi { font-size: 20px; font-weight: 600; margin-bottom: 16px; }
.tip { margin-bottom: 8px; }
h3 { margin: 22px 0 10px; font-size: 15px; }
.prod { margin-top: 8px; cursor: pointer; }
.prod-in { display: flex; align-items: center; gap: 10px; }
.pimg { width: 44px; height: 44px; border-radius: 8px; } .pimg.placeholder { background:#eef0f5; }
.pname { font-weight: 500; } .muted { color:#8a93a6; }
.arr { margin-left: auto; color: #c0c4cc; }
</style>
