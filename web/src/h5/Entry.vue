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

      <!-- 我的资料卡 -->
      <el-card v-if="me" class="me-card">
        <div class="me-top">
          <div class="me-badges">
            <el-tag size="small" type="warning" effect="dark">{{ me.level || 'L1' }}</el-tag>
            <span class="me-comm" v-if="me.commission_tier != null">佣金 {{ me.commission_tier }}%</span>
          </div>
          <el-button size="small" text type="primary" @click="editing = !editing">
            {{ editing ? '收起' : (me.has_profile ? '更新资料' : '完善资料') }}
          </el-button>
        </div>
        <div class="me-kv"><span class="k">抖音号</span><span>{{ me.douyin_id || '—' }}</span></div>
        <div class="me-kv"><span class="k">合作码</span><span>{{ me.cooperation_code || '—' }}</span></div>
        <div class="me-kv"><span class="k">收件人</span><span>{{ me.real_name || '—' }} {{ me.phone || '' }}</span></div>
        <div class="me-kv"><span class="k">收件地址</span><span>{{ me.default_address || '—' }}</span></div>

        <!-- 完善/更新资料(粘贴解析) -->
        <div v-if="editing || !me.has_profile" class="me-edit">
          <el-input v-model="intro" type="textarea" :rows="4"
            placeholder="把自我介绍粘贴到这里(抖音号、主页链接、粉丝数、收件人/电话/地址等),提交后自动识别更新" />
          <el-button type="primary" style="width:100%;margin-top:10px" @click="submit">提交并识别</el-button>
        </div>
      </el-card>

      <el-button type="warning" plain style="width: 100%; margin-top: 12px"
        @click="$router.push('/h5/notice')">📌 拍摄前必读(卡审避坑)</el-button>

      <h3>已开放给你的产品</h3>
      <p class="muted" style="font-size:12px;margin:-4px 0 8px">选择产品,查看视频/文案素材、拍摄要求与寄样物流</p>
      <el-select v-model="pickProduct" placeholder="选择产品查看全部资料" size="large" style="width:100%"
        filterable @change="(id) => $router.push(`/h5/products/${id}`)">
        <el-option v-for="p in products" :key="p.id" :value="p.id" :label="p.name">
          <div class="opt">
            <span>{{ p.name }}</span>
            <span class="opt-meta">
              <span v-if="p.price_text" class="price">{{ p.price_text }}</span>
              <span v-if="p.default_commission != null" class="comm">佣金{{ p.default_commission }}%</span>
            </span>
          </div>
        </el-option>
      </el-select>
      <el-empty v-if="!products.length" description="暂无开放产品,完善资料后等待商务开通" :image-size="70" />

      <template v-if="me && me.samples.length">
        <h3>我的寄样</h3>
        <el-card v-for="s in me.samples" :key="s.id" class="prod">
          <div class="prod-in">
            <el-image v-if="s.product_image" :src="s.product_image" fit="cover" class="pimg" />
            <div class="pimg placeholder" v-else></div>
            <div class="pinfo">
              <div class="pname">{{ s.product_name }}</div>
              <div v-if="s.tracking_no" class="muted" style="font-size:12px">{{ courierName(s.courier_company) }} {{ s.tracking_no }}</div>
            </div>
            <el-tag size="small" :type="sampleTagType(s.status)" style="margin-left:auto">{{ sampleLabel(s) }}</el-tag>
          </div>

          <!-- 拒绝原因 -->
          <div v-if="s.status === 'rejected' && s.reject_reason" class="reject">未通过:{{ s.reject_reason }}</div>

          <!-- 物流轨迹 -->
          <div v-if="lastEvent(s)" class="logi">
            <el-icon><Van /></el-icon>
            <span class="ctx">{{ lastEvent(s).context }}</span>
            <span class="tm">{{ lastEvent(s).ftime || lastEvent(s).time }}</span>
          </div>
          <el-timeline v-if="expanded === s.id" class="logi-tl">
            <el-timeline-item v-for="(e, i) in events(s)" :key="i"
              :timestamp="e.ftime || e.time" :type="i === 0 ? 'primary' : ''" size="small">
              {{ e.context }}
            </el-timeline-item>
          </el-timeline>
          <div v-if="s.tracking_no" class="logi-actions">
            <el-button size="small" text @click="refresh(s)" :loading="tracking === s.id">刷新物流</el-button>
            <el-button v-if="events(s).length > 1" size="small" text
              @click="expanded = expanded === s.id ? null : s.id">
              {{ expanded === s.id ? '收起' : `全部${events(s).length}条` }}
            </el-button>
          </div>
        </el-card>
      </template>
    </template>
  </div>
</template>

<script setup>
import { Van } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { onMounted, ref } from 'vue'
import api from '../api'

const STATUS = { pending: '待审批', approved: '待发货', shipped: '已发货', in_transit: '运输中', signed: '已签收', rejected: '已拒绝' }
const STATUS_TYPE = { pending: 'info', approved: 'warning', shipped: 'primary', in_transit: 'primary', signed: 'success', rejected: 'danger' }
const COURIERS = { yuantong: '圆通', zhongtong: '中通', shentong: '申通', yunda: '韵达', shunfeng: '顺丰', jtexpress: '极兔', ems: 'EMS', youzhengguonei: '邮政', jd: '京东', huitongkuaidi: '百世' }
const phone = ref('')
const code = ref('')
const cd = ref(0)
const token = ref(localStorage.getItem('h5_token'))
const intro = ref('')
const products = ref([])
const me = ref(null)
const editing = ref(false)
const expanded = ref(null)
const tracking = ref(null)
const pickProduct = ref(null)

// 寄样状态:优先展示物流状态(运输中/已签收),否则用订单状态
function effStatus(s) {
  if (s.status === 'shipped' && s.logistics_status?.status) return s.logistics_status.status
  return s.status
}
const sampleLabel = (s) => STATUS[effStatus(s)] || effStatus(s)
const sampleTagType = (st) => STATUS_TYPE[st] || 'info'
const courierName = (c) => COURIERS[c] || c || ''
const events = (s) => s.logistics_status?.events || []
const lastEvent = (s) => s.logistics_status?.last_event || events(s)[0] || null

async function refresh(s) {
  tracking.value = s.id
  try {
    const r = await api.post(`/api/h5/samples/${s.id}/track`)
    if (r.ok || r.events?.length) ElMessage.success('物流已更新')
    else ElMessage.info(r.message || '暂无轨迹')
    me.value = await api.get('/api/h5/me')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '查询失败')
  } finally {
    tracking.value = null
  }
}

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
  if (!intro.value.trim()) return ElMessage.warning('请先粘贴自我介绍')
  await api.post('/api/h5/submit', { text: intro.value })
  ElMessage.success('已提交并识别,信息已更新')
  intro.value = ''
  editing.value = false
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
h3 { margin: 22px 0 10px; font-size: 15px; }
.prod { margin-top: 8px; cursor: pointer; }
.prod-in { display: flex; align-items: center; gap: 10px; }
.pimg { width: 44px; height: 44px; border-radius: 8px; flex-shrink: 0; } .pimg.placeholder { background:#eef0f5; }
.pinfo { min-width: 0; flex: 1; }
.pname { font-weight: 500; }
.pmeta { display: flex; align-items: center; gap: 8px; margin: 2px 0; }
.pmeta .price { color: #f56c6c; font-weight: 600; }
.muted { color:#8a93a6; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.arr { margin-left: auto; color: #c0c4cc; flex-shrink: 0; }
.opt { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.opt-meta { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.opt-meta .price { color: #f56c6c; }
.opt-meta .comm { color: #67c23a; }
/* 我的资料卡 */
.me-card { margin-bottom: 8px; }
.me-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.me-badges { display: flex; align-items: center; gap: 8px; }
.me-comm { color: #67c23a; font-weight: 600; font-size: 14px; }
.me-kv { display: flex; gap: 10px; padding: 3px 0; font-size: 13px; }
.me-kv .k { color: #8a93a6; min-width: 56px; flex-shrink: 0; }
.me-edit { margin-top: 12px; padding-top: 12px; border-top: 1px solid #f2f3f7; }
/* 寄样物流 */
.reject { margin-top: 6px; font-size: 12px; color: #f56c6c; }
.logi { display: flex; align-items: center; gap: 6px; margin-top: 8px; padding: 6px 10px;
  background: #f6f8fc; border-radius: 8px; font-size: 12px; color: #5a6072; }
.logi .ctx { flex: 1; min-width: 0; }
.logi .tm { color: #98a0b0; white-space: nowrap; }
.logi-tl { margin-top: 8px; padding-left: 4px; }
.logi-actions { margin-top: 4px; display: flex; gap: 8px; }
</style>
