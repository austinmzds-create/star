<template>
  <div class="h5-wrap" v-if="d">
    <div class="topbar">
      <el-button size="small" type="primary" plain @click="$router.push('/h5/products')">← 返回产品列表</el-button>
      <el-select v-model="curId" placeholder="选择产品" size="large" class="product-picker" filterable @change="goProduct">
        <el-option v-for="p in productList" :key="p.id" :label="p.name" :value="p.id" />
      </el-select>
    </div>

    <div class="product-card">
      <el-image v-if="d.product_image" :src="d.product_image" fit="cover" class="phimg" />
      <div class="phimg placeholder" v-else></div>
      <div class="phinfo">
        <div class="phname">{{ d.name }}</div>
        <div class="phmeta">
          <span v-if="d.price_text" class="price">{{ d.price_text }}</span>
          <el-tag v-if="d.default_commission != null" size="small" type="success" effect="plain">
            自然流 {{ d.default_commission }}%
          </el-tag>
          <el-tag v-if="d.merchant_promotion_commission != null" size="small" type="warning" effect="plain">
            投流 {{ d.merchant_promotion_commission }}%
          </el-tag>
        </div>
      </div>
    </div>

    <div v-if="d.application" class="application-card">
      <div>
        <div class="app-title">带货状态</div>
        <div class="app-status" :class="d.application.status">{{ d.application.status_label }}</div>
        <div v-if="d.application.reject_reason" class="app-reason">原因:{{ d.application.reject_reason }}</div>
      </div>
      <el-button v-if="d.application.can_apply" type="primary" size="small" :loading="applying" @click="applyProduct">
        申请带货
      </el-button>
    </div>

    <div class="detail-shell">
      <div class="side-tabs" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          class="side-tab"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          <span class="tab-label">{{ tab.label }}</span>
          <span class="tab-count">{{ countOf(tab) }}</span>
          <span v-if="unreadOf(tab)" class="tab-badge">{{ unreadOf(tab) }}</span>
        </button>
      </div>

      <div class="tab-panel">
        <template v-if="activeTab === 'detail'">
          <div v-if="detailItems.length" class="panel-list">
            <section v-for="item in detailItems" :key="item.label" class="panel-block">
              <h4>{{ item.label }}</h4>
              <p>{{ item.value }}</p>
            </section>
          </div>
          <el-empty v-else description="暂无商品详情" :image-size="54" />
        </template>

        <template v-else-if="activeTab === 'sample'">
          <section v-if="d.sample" class="panel-block">
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
            <div v-else-if="logisticsIncomplete" class="logi-empty">
              {{ logisticsMessage }}
            </div>
            <el-timeline v-if="expandLogi" class="logi-tl">
              <el-timeline-item
                v-for="(e, i) in events"
                :key="i"
                :timestamp="e.ftime || e.time"
                :type="i === 0 ? 'primary' : ''"
                size="small"
              >
                {{ e.context }}
              </el-timeline-item>
            </el-timeline>
            <div v-if="d.sample.tracking_no" class="logi-actions">
              <el-button size="small" text @click="refreshLogi" :loading="refreshing">刷新物流</el-button>
              <el-button v-if="events.length > 1" size="small" text @click="expandLogi = !expandLogi">
                {{ expandLogi ? '收起' : `全部${events.length}条` }}
              </el-button>
            </div>
          </section>
          <el-empty v-else description="暂无寄样物流" :image-size="54" />
        </template>

        <template v-else>
          <div v-if="activeMaterials.length" class="material-list">
            <section v-for="m in activeMaterials" :key="m.id" class="material-card">
              <div class="mat-head">
                <el-tag size="small">{{ TYPE_LABEL[m.type] || m.type }}</el-tag>
                <span v-if="m.title" class="mtitle">{{ m.title }}</span>
                <span v-if="m.unread_total" class="mat-badge">{{ m.unread_total }}</span>
              </div>
              <MaterialPreview :material="m" />
              <div v-if="m.type === 'video_output'" class="video-comments">
                <div class="comments-title">评论 {{ m.comment_count || (m.comments || []).length || 0 }}</div>
                <div v-if="(m.comments || []).length" class="comments-list">
                  <div v-for="c in m.comments" :key="c.id" class="comment-item">
                    <div class="comment-meta">
                      <span class="comment-author">{{ c.author_name || '内部人员' }}</span>
                      <span>{{ roleLabel(c.author_role) }}</span>
                      <span>{{ ft(c.created_at) }}</span>
                    </div>
                    <div v-if="c.body" class="comment-body">{{ c.body }}</div>
                    <div v-if="c.attachments?.length" class="comment-files">
                      <a v-for="a in c.attachments" :key="a.id" :href="a.download_url || a.url"
                        target="_blank" rel="noopener">
                        {{ fileTypeLabel(a.file_type) }} {{ a.filename || '附件' }}
                      </a>
                    </div>
                  </div>
                </div>
                <div v-else class="muted no-comments">暂无评论</div>
              </div>
              <div v-if="m.downloadable && m.url" class="mat-actions">
                <el-button size="small" type="primary" plain @click="download(m)">下载素材</el-button>
              </div>
            </section>
          </div>
          <el-empty v-else :description="`暂无${activeTabLabel}`" :image-size="54" />
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { Van } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'
import MaterialPreview from '../components/MaterialPreview.vue'
import { formatTime as ft } from '../utils/time'
import { h5store } from './store'

const TYPE_LABEL = {
  video_ai: 'AI视频',
  video_hot: '爆款参考',
  video_output: '达人成片',
  image: '图片',
  pdf: '质检报告',
  copy: '文案',
}
const tabs = [
  { key: 'detail', label: '商品详情' },
  { key: 'video_ai', label: 'AI视频', types: ['video_ai'] },
  { key: 'video_hot', label: '爆款参考', types: ['video_hot'] },
  { key: 'video_output', label: '达人成片', types: ['video_output'] },
  { key: 'image', label: '图片', types: ['image'] },
  { key: 'pdf', label: '质检报告', types: ['pdf'] },
  { key: 'copy', label: '文案', types: ['copy'] },
  { key: 'sample', label: '寄样物流' },
]
const STATUS = { pending: '待审批', approved: '待发货', shipped: '已发货', in_transit: '运输中', signed: '已签收', rejected: '已拒绝' }
const STATUS_TYPE = { pending: 'info', approved: 'warning', shipped: 'primary', in_transit: 'primary', signed: 'success', rejected: 'danger' }
const COURIERS = { yuantong: '圆通', zhongtong: '中通', shentong: '申通', yunda: '韵达', shunfeng: '顺丰', jtexpress: '极兔', ems: 'EMS', youzhengguonei: '邮政', jd: '京东', huitongkuaidi: '百世' }

const route = useRoute()
const router = useRouter()
const d = ref(null)
const productList = ref([])
const curId = ref(Number(route.params.id))
const activeTab = ref('detail')
const expandLogi = ref(false)
const refreshing = ref(false)
const markingRead = ref(false)
const applying = ref(false)

const matsOf = (types) => (d.value?.materials || []).filter((m) => types.includes(m.type))
const detailItems = computed(() => [
  { label: '自然流佣金', value: d.value?.default_commission != null ? `${d.value.default_commission}%` : null },
  { label: '商家投流佣金', value: d.value?.merchant_promotion_commission != null ? `${d.value.merchant_promotion_commission}%` : null },
  { label: '卖点', value: d.value?.selling_points },
  { label: '拍摄要求', value: d.value?.shooting_notes },
  { label: '带货备注', value: d.value?.promo_remark },
].filter((item) => item.value))
const activeTabConfig = computed(() => tabs.find((tab) => tab.key === activeTab.value) || tabs[0])
const activeMaterials = computed(() => (
  activeTabConfig.value.types ? matsOf(activeTabConfig.value.types) : []
))
const activeTabLabel = computed(() => activeTabConfig.value.label)
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
const logisticsIncomplete = computed(() => Boolean(d.value?.sample?.tracking_no && !lastEvent.value))
const logisticsMessage = computed(() => {
  const status = d.value?.sample?.logistics_status || {}
  if (status.code === 'CONFIG_MISSING') return status.message || '物流接口未配置,请联系管理员'
  if (status.message && status.message !== 'ok') return `${status.message}:暂无轨迹明细,请稍后刷新`
  return '暂无轨迹明细,请稍后刷新'
})

function countOf(tab) {
  if (tab.key === 'detail') return detailItems.value.length
  if (tab.key === 'sample') return d.value?.sample ? 1 : 0
  return matsOf(tab.types).length
}

function unreadOf(tab) {
  if (tab.key !== 'video_output') return 0
  return d.value?.unread_badges?.video_output || matsOf(['video_output']).reduce((sum, m) => sum + Number(m.unread_total || 0), 0)
}

const roleLabel = (role) => (role === 'admin' ? '管理员' : '商务')
const fileTypeLabel = (type) => ({ image: '图片', video: '视频', pdf: 'PDF', file: '附件' }[type] || '附件')

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
    else if (r.code === 'CONFIG_MISSING') ElMessage.warning(r.message || '物流接口未配置')
    else ElMessage.info(r.message || '暂无轨迹')
    await loadDetail({ resetTab: false })
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '查询失败')
  } finally {
    refreshing.value = false
  }
}

async function applyProduct() {
  if (applying.value) return
  applying.value = true
  try {
    const r = await api.post(`/api/h5/products/${route.params.id}/apply`, {}, { skipBadgeRefresh: true })
    d.value.application = r.application
    const pid = Number(route.params.id)
    const updateProduct = (p) => {
      if (!p) return
      p.application_status = r.application.application_status
      p.cooperation_status = r.application.status
      p.reject_reason = r.application.reject_reason
    }
    updateProduct(productList.value.find((p) => p.id === pid))
    updateProduct(h5store.products.find((p) => p.id === pid))
    ElMessage.success('已提交申请')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '申请失败')
  } finally {
    applying.value = false
  }
}

async function loadDetail({ resetTab = true } = {}) {
  expandLogi.value = false
  if (resetTab) activeTab.value = 'detail'
  d.value = await api.get(`/api/h5/products/${route.params.id}/materials`)
}

async function markVideoOutputRead() {
  if (markingRead.value || activeTab.value !== 'video_output') return
  const mats = matsOf(['video_output']).filter((m) => Number(m.unread_total || 0) > 0)
  if (!mats.length) return
  markingRead.value = true
  try {
    await Promise.all(mats.map((m) => api.post(`/api/h5/materials/${m.id}/read`, { scope: 'all' }, { skipBadgeRefresh: true })))
    mats.forEach((m) => {
      m.is_new = false
      m.unread_comment_count = 0
      m.unread_total = 0
    })
    if (d.value?.unread_badges) d.value.unread_badges.video_output = 0
    const pid = Number(route.params.id)
    const productTargets = [productList.value.find((p) => p.id === pid), h5store.products.find((p) => p.id === pid)]
    productTargets.filter(Boolean).forEach((p) => {
      p.unread_badge = 0
      p.unread_video_count = 0
      p.unread_comment_count = 0
    })
  } catch {
    // 已读失败不影响浏览,下次进入仍会提示
  } finally {
    markingRead.value = false
  }
}

watch(() => route.params.id, (id) => {
  curId.value = Number(id)
  loadDetail()
})

watch(activeTab, () => {
  if (activeTab.value === 'video_output') setTimeout(markVideoOutputRead, 300)
})

onMounted(async () => {
  productList.value = await api.get('/api/h5/products')
  await loadDetail()
})
</script>

<style scoped>
.h5-wrap { max-width: 520px; margin: 0 auto; padding: 14px 12px 20px; }
.topbar { display: flex; align-items: center; gap: 8px; }
.product-picker { flex: 1; min-width: 0; }
.product-card {
  display: flex;
  gap: 12px;
  align-items: center;
  margin: 12px 0;
  padding: 12px;
  border: 1px solid #e8ebf2;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 6px 18px rgba(24, 31, 67, 0.05);
}
.phimg { width: 68px; height: 68px; border-radius: 10px; flex-shrink: 0; }
.phimg.placeholder { background: #eef0f5; }
.phinfo { min-width: 0; }
.phname { font-weight: 700; font-size: 16px; color: #202431; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.phmeta { display: flex; align-items: center; gap: 8px; margin-top: 5px; flex-wrap: wrap; }
.phmeta .price { color: #f56c6c; font-weight: 700; }
.application-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: -2px 0 12px;
  padding: 11px 12px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid #e8ebf2;
}
.app-title { font-size: 12px; color: #8a93a6; }
.app-status { margin-top: 3px; font-size: 14px; font-weight: 700; color: #606a7c; }
.app-status.pending, .app-status.approved { color: #b36b00; }
.app-status.shipped, .app-status.in_transit { color: #337ecc; }
.app-status.signed { color: #2f9f5b; }
.app-status.rejected { color: #d93030; }
.app-status.cancelled { color: #8a93a6; }
.app-reason { margin-top: 4px; color: #d93030; font-size: 12px; line-height: 1.45; }
.detail-shell { display: grid; grid-template-columns: 86px minmax(0, 1fr); gap: 10px; align-items: start; }
.side-tabs {
  position: sticky;
  top: 12px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.side-tab {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
  width: 100%;
  min-height: 38px;
  padding: 7px 8px;
  border: 1px solid #e6e9f1;
  border-radius: 9px;
  background: #fff;
  color: #5d6575;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.side-tab.active {
  border-color: #6b5cf6;
  background: #f3f1ff;
  color: #4236c6;
  font-weight: 700;
}
.tab-label { min-width: 0; line-height: 1.2; }
.tab-count {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: #f0f2f7;
  color: #7b8495;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
  flex-shrink: 0;
}
.side-tab.active .tab-count { background: #6b5cf6; color: #fff; }
.tab-badge, .mat-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: #f56c6c;
  color: #fff;
  font-size: 11px;
  line-height: 18px;
  font-weight: 700;
}
.tab-badge {
  position: absolute;
  top: -6px;
  right: -5px;
}
.tab-panel { min-width: 0; }
.panel-list, .material-list { display: flex; flex-direction: column; gap: 10px; }
.panel-block, .material-card {
  padding: 12px;
  border: 1px solid #e8ebf2;
  border-radius: 10px;
  background: #fff;
}
.panel-block h4 { margin: 0 0 8px; font-size: 14px; color: #202431; }
.panel-block p { margin: 0; white-space: pre-wrap; line-height: 1.7; color: #4f566b; font-size: 13px; }
.muted { color: #8a93a6; }
.mat-head { display: flex; align-items: center; gap: 8px; }
.mtitle { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mat-badge { margin-left: auto; flex-shrink: 0; }
.mat-actions { margin-top: 8px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.video-comments {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed #e5e7ef;
}
.comments-title { font-size: 13px; font-weight: 700; color: #202431; margin-bottom: 8px; }
.comments-list { display: flex; flex-direction: column; gap: 8px; }
.comment-item { padding: 9px; border-radius: 8px; background: #f8f9fc; border: 1px solid #eef0f5; }
.comment-meta { display: flex; gap: 6px; flex-wrap: wrap; color: #8a93a6; font-size: 11px; }
.comment-author { color: #303545; font-weight: 700; }
.comment-body { margin-top: 6px; white-space: pre-wrap; line-height: 1.6; color: #4f566b; font-size: 13px; }
.comment-files { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.comment-files a {
  max-width: 100%;
  padding: 4px 8px;
  border: 1px solid #e5e7ef;
  border-radius: 6px;
  background: #fff;
  color: #6254e8;
  text-decoration: none;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.no-comments { font-size: 12px; }
.samp-head { display: flex; align-items: center; gap: 8px; font-size: 13px; flex-wrap: wrap; }
.reject { margin-top: 8px; font-size: 12px; color: #f56c6c; }
.logi {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding: 8px 10px;
  background: #f6f8fc;
  border-radius: 8px;
  font-size: 12px;
  color: #5a6072;
}
.logi .ctx { flex: 1; min-width: 0; }
.logi .tm { color: #98a0b0; white-space: nowrap; }
.logi-empty { margin-top: 8px; font-size: 12px; color: #e6a23c; }
.logi-tl { margin-top: 8px; padding-left: 4px; }
.logi-actions { margin-top: 6px; display: flex; gap: 8px; }
@media (max-width: 380px) {
  .h5-wrap { padding-left: 10px; padding-right: 10px; }
}
@media (max-width: 520px) {
  .detail-shell { display: block; }
  .side-tabs {
    position: static;
    flex-direction: row;
    overflow-x: auto;
    gap: 8px;
    padding: 2px 2px 10px;
    margin-bottom: 10px;
    scrollbar-width: none;
  }
  .side-tabs::-webkit-scrollbar { display: none; }
  .side-tab {
    flex: 0 0 auto;
    width: auto;
    min-width: 78px;
    justify-content: center;
    text-align: center;
  }
  .tab-count { margin-left: 4px; }
}
</style>
