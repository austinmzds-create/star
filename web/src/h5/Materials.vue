<template>
  <div class="h5-wrap" v-if="d">
    <!-- 产品下拉切换 -->
    <el-select v-model="curId" placeholder="选择产品" size="large" style="width:100%" @change="goProduct">
      <el-option v-for="p in productList" :key="p.id" :label="p.name" :value="p.id" />
    </el-select>

    <!-- 产品头 -->
    <div class="phead">
      <el-image v-if="d.product_image" :src="d.product_image" fit="cover" class="phimg" />
      <div class="phimg placeholder" v-else></div>
      <div class="phinfo">
        <div class="phname">{{ d.name }}</div>
        <div class="phmeta">
          <span v-if="d.price_text" class="price">{{ d.price_text }}</span>
          <el-tag v-if="d.default_commission != null" size="small" type="success" effect="plain">佣金 {{ d.default_commission }}%</el-tag>
        </div>
      </div>
    </div>

    <el-card v-if="d.selling_points" header="卖点" class="sec">{{ d.selling_points }}</el-card>
    <el-card v-if="d.shooting_notes" header="拍摄要求(拍摄前必读)" class="sec">{{ d.shooting_notes }}</el-card>
    <el-card v-if="d.promo_remark" header="带货备注" class="sec">{{ d.promo_remark }}</el-card>

    <!-- 快递 / 寄样进度 -->
    <el-card v-if="d.sample" header="寄样 / 快递" class="sec">
      <div class="samp-head">
        <el-tag size="small" :type="sampleTagType(sampStatus)">{{ sampleLabel }}</el-tag>
        <span v-if="d.sample.tracking_no" class="muted">{{ courierName(d.sample.courier_company) }} {{ d.sample.tracking_no }}</span>
      </div>
      <div v-if="d.sample.status === 'rejected' && d.sample.reject_reason" class="reject">未通过:{{ d.sample.reject_reason }}</div>
      <div v-if="lastEvent" class="logi">
        <el-icon><Van /></el-icon>
        <span class="ctx">{{ lastEvent.context }}</span>
        <span class="tm">{{ lastEvent.ftime || lastEvent.time }}</span>
      </div>
      <el-timeline v-if="expandLogi" class="logi-tl">
        <el-timeline-item v-for="(e, i) in events" :key="i" :timestamp="e.ftime || e.time"
          :type="i === 0 ? 'primary' : ''" size="small">{{ e.context }}</el-timeline-item>
      </el-timeline>
      <div v-if="d.sample.tracking_no" class="logi-actions">
        <el-button size="small" text @click="refreshLogi" :loading="refreshing">刷新物流</el-button>
        <el-button v-if="events.length > 1" size="small" text @click="expandLogi = !expandLogi">
          {{ expandLogi ? '收起' : `全部${events.length}条` }}
        </el-button>
      </div>
    </el-card>

    <!-- 素材分组 -->
    <template v-for="g in groups" :key="g.key">
      <template v-if="matsOf(g.types).length">
        <h3>{{ g.label }} <span class="muted">{{ matsOf(g.types).length }}</span></h3>
        <el-card v-for="m in matsOf(g.types)" :key="m.id" class="mat">
          <div class="mat-head">
            <el-tag size="small">{{ TYPE_LABEL[m.type] || m.type }}</el-tag>
            <span v-if="m.title" class="mtitle">{{ m.title }}</span>
          </div>
          <MaterialPreview :material="m" />
          <div v-if="m.downloadable && m.url" class="mat-actions">
            <el-button size="small" type="primary" plain @click="download(m)">下载素材</el-button>
          </div>
        </el-card>
      </template>
    </template>
    <el-empty v-if="!d.materials.length" description="该产品暂无素材" :image-size="60" />
  </div>
</template>

<script setup>
import { Van } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'
import MaterialPreview from '../components/MaterialPreview.vue'

const TYPE_LABEL = {
  video_ai: 'AI视频', video_hot: '爆款参考', video_output: '达人成片',
  image: '图片', pdf: '质检报告', copy: '文案',
}
const groups = [
  { key: 'video', label: '视频素材', types: ['video_ai', 'video_hot', 'video_output'] },
  { key: 'copy', label: '文案', types: ['copy'] },
  { key: 'image', label: '图片', types: ['image'] },
  { key: 'pdf', label: '质检报告', types: ['pdf'] },
]
const STATUS = { pending: '待审批', approved: '待发货', shipped: '已发货', in_transit: '运输中', signed: '已签收', rejected: '已拒绝' }
const STATUS_TYPE = { pending: 'info', approved: 'warning', shipped: 'primary', in_transit: 'primary', signed: 'success', rejected: 'danger' }
const COURIERS = { yuantong: '圆通', zhongtong: '中通', shentong: '申通', yunda: '韵达', shunfeng: '顺丰', jtexpress: '极兔', ems: 'EMS', youzhengguonei: '邮政', jd: '京东', huitongkuaidi: '百世' }

const route = useRoute()
const router = useRouter()
const d = ref(null)
const productList = ref([])
const curId = ref(Number(route.params.id))
const expandLogi = ref(false)
const refreshing = ref(false)

const matsOf = (types) => (d.value?.materials || []).filter((m) => types.includes(m.type))
const sampStatus = computed(() => {
  const s = d.value?.sample
  if (s?.status === 'shipped' && s.logistics_status?.status) return s.logistics_status.status
  return s?.status
})
const sampleLabel = computed(() => STATUS[sampStatus.value] || sampStatus.value)
const sampleTagType = (st) => STATUS_TYPE[st] || 'info'
const courierName = (c) => COURIERS[c] || c || ''
const events = computed(() => d.value?.sample?.logistics_status?.events || [])
const lastEvent = computed(() => d.value?.sample?.logistics_status?.last_event || events.value[0] || null)

function goProduct(id) {
  if (id !== Number(route.params.id)) router.push(`/h5/products/${id}`)
}
async function download(m) {
  const { url } = await api.post(`/api/h5/materials/${m.id}/download`)
  window.open(url, '_blank')
}
async function refreshLogi() {
  refreshing.value = true
  try {
    const r = await api.post(`/api/h5/samples/${d.value.sample.id}/track`)
    if (r.ok || r.events?.length) ElMessage.success('物流已更新')
    else ElMessage.info(r.message || '暂无轨迹')
    await loadDetail()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '查询失败')
  } finally {
    refreshing.value = false
  }
}
async function loadDetail() {
  expandLogi.value = false
  d.value = await api.get(`/api/h5/products/${route.params.id}/materials`)
}

watch(() => route.params.id, (id) => { curId.value = Number(id); loadDetail() })

onMounted(async () => {
  productList.value = await api.get('/api/h5/products')
  await loadDetail()
})
</script>

<style scoped>
.h5-wrap { max-width: 480px; margin: 0 auto; padding: 16px; }
.phead { display: flex; gap: 12px; align-items: center; margin: 14px 0 4px; }
.phimg { width: 60px; height: 60px; border-radius: 10px; flex-shrink: 0; } .phimg.placeholder { background: #eef0f5; }
.phinfo { min-width: 0; }
.phname { font-weight: 600; font-size: 16px; }
.phmeta { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.phmeta .price { color: #f56c6c; font-weight: 600; }
.sec { margin-top: 10px; }
h3 { margin: 18px 0 8px; font-size: 15px; }
.muted { color: #8a93a6; }
.mat { margin-top: 8px; }
.mat-head { display: flex; align-items: center; gap: 8px; }
.mtitle { font-weight: 500; }
.mat-actions { margin-top: 8px; display: flex; gap: 10px; align-items: center; }
.samp-head { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.reject { margin-top: 6px; font-size: 12px; color: #f56c6c; }
.logi { display: flex; align-items: center; gap: 6px; margin-top: 8px; padding: 6px 10px;
  background: #f6f8fc; border-radius: 8px; font-size: 12px; color: #5a6072; }
.logi .ctx { flex: 1; min-width: 0; } .logi .tm { color: #98a0b0; white-space: nowrap; }
.logi-tl { margin-top: 8px; padding-left: 4px; }
.logi-actions { margin-top: 4px; display: flex; gap: 8px; }
</style>
