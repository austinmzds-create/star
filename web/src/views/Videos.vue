<template>
  <div>
    <el-tabs v-model="mainTab" @tab-change="onMainTab">
      <el-tab-pane name="video" label="视频审核" />
      <el-tab-pane name="promotion" label="投流管理" />
    </el-tabs>

    <!-- ===================== 视频审核 ===================== -->
    <div v-if="mainTab === 'video'" key="video-pane">
      <div class="page-toolbar">
        <el-tabs v-model="vTab" @tab-change="reloadVideos" class="flex-tabs">
          <el-tab-pane v-for="s in VIDEO_TABS" :key="s.key" :name="s.key">
            <template #label>
              <span class="tab-label-badge">
                {{ s.label }}
                <el-badge v-if="vCounts[s.key]" :value="vCounts[s.key]" :type="videoBadgeType(s.key)" />
              </span>
            </template>
          </el-tab-pane>
        </el-tabs>
        <div style="display:flex; gap:8px; align-items:center">
          <el-input v-model="vSearch" placeholder="搜达人/产品" clearable style="width:180px"
            @keyup.enter="reloadVideos" @clear="reloadVideos" />
          <el-button type="primary" @click="openCreateVideo">+ 登记视频</el-button>
        </div>
      </div>

      <el-table :data="videos" v-loading="vLoading">
        <el-table-column label="达人">
          <template #default="{ row }">
            <router-link :to="`/influencers/${row.influencer_id}`" class="link">{{ row.influencer_nickname }}</router-link>
          </template>
        </el-table-column>
        <el-table-column label="产品">
          <template #default="{ row }">
            <router-link :to="{ path: '/products', query: { open: row.product_id } }" class="link">{{ row.product_name }}</router-link>
          </template>
        </el-table-column>
        <el-table-column prop="round_no" label="轮次" width="70" />
        <el-table-column label="抖音链接">
          <template #default="{ row }">
            <el-link v-if="row.dy_url" :href="row.dy_url" target="_blank" type="primary">
              查看视频
            </el-link>
            <span v-else style="color: #909399">-</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="VIDEO_TAG[row.status] || 'info'">
              {{ videoTabLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="320">
          <template #default="{ row }">
            <template v-if="row.status === 'submitted' || row.status === 'rejected' || row.status === 'blocked'">
              <el-button size="small" type="success" @click="passVideo(row)">通过</el-button>
              <el-button size="small" type="danger" @click="openReject(row)">拒绝</el-button>
              <el-button size="small" type="warning" @click="blockVideo(row)">标记卡审</el-button>
            </template>
            <el-button v-if="row.status === 'approved'" size="small" type="primary"
              @click="startPromotion(row)">发起投流</el-button>
            <el-button size="small" link type="danger" @click="removeVideo(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination v-if="vTotal > 50" background layout="prev, pager, next, total"
        :total="vTotal" :page-size="50" :current-page="vPage"
        style="margin-top:12px; justify-content:flex-end" @current-change="onVPage" />

      <!-- 登记视频 -->
      <el-dialog v-model="createVideoVisible" title="登记视频" width="480px">
        <el-form label-width="72px">
          <el-form-item label="达人"><InfluencerSelect v-model="videoForm.influencer_id" style="width:100%" /></el-form-item>
          <el-form-item label="产品">
            <el-select v-model="videoForm.product_id" placeholder="选择产品" filterable style="width:100%">
              <el-option v-for="p in products" :key="p.id" :label="p.name" :value="p.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="抖音链接"><el-input v-model="videoForm.dy_url" placeholder="视频链接(可选)" /></el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="createVideoVisible = false">取消</el-button>
          <el-button type="primary" @click="doCreateVideo">登记</el-button>
        </template>
      </el-dialog>

      <!-- 拒绝(填原因 + 时间点评论) -->
      <el-dialog v-model="rejectVisible" title="拒绝视频" width="520px">
        <el-input v-model="rejectReason" placeholder="拒绝原因" type="textarea" :rows="2" />
        <el-input v-model="timeComments" style="margin-top: 8px" type="textarea" :rows="3"
          placeholder="时间点评论(可选,每行一条,如:00:12 卖点不清晰)" />
        <template #footer>
          <el-button @click="rejectVisible = false">取消</el-button>
          <el-button type="danger" @click="doReject">确认拒绝</el-button>
        </template>
      </el-dialog>
    </div>

    <!-- ===================== 投流管理 ===================== -->
    <div v-else key="promo-pane">
      <div class="page-toolbar">
        <el-tabs v-model="pTab" @tab-change="reloadPromotions" class="flex-tabs">
          <el-tab-pane v-for="s in PROMO_TABS" :key="s.key" :name="s.key">
            <template #label>
              <span class="tab-label-badge">
                {{ s.label }}
                <el-badge v-if="pCounts[s.key]" :value="pCounts[s.key]" :type="promoBadgeType(s.key)" />
              </span>
            </template>
          </el-tab-pane>
        </el-tabs>
        <el-input v-model="pSearch" placeholder="搜达人/产品/抖音号" clearable style="width:200px"
          @keyup.enter="reloadPromotions" @clear="reloadPromotions" />
      </div>

      <el-empty v-if="!promotions.length" description="暂无投流任务" />
      <div v-for="row in promotions" :key="row.id" class="promo-card">
        <div class="pc-head">
          <div>
            <router-link :to="`/influencers/${row.influencer_id}`" class="pc-name link">{{ row.influencer_nickname }}</router-link>
            <span class="muted" style="margin-left:8px">{{ row.fans_count ?? '—' }}粉丝 · {{ row.product_name }}</span>
          </div>
          <el-tag size="small" :type="PROMO_TAG[row.auth_status] || 'info'">{{ promoLabel(row.auth_status) }}</el-tag>
        </div>
        <div class="pc-sub muted">
          {{ row.mode_snapshot === 'self' ? '达人自投' : '商家投流' }}
          <span v-if="row.fail_reason">· 失败原因:{{ row.fail_reason }}</span>
          · {{ ft(row.created_at) }}
        </div>
        <!-- 展开:逐字段复制(粘千川) -->
        <div v-if="expanded === row.id" class="pc-copy">
          <CopyText block label="抖音号" :value="row.douyin_id" />
          <CopyText block label="UID" :value="row.douyin_uid" />
          <CopyText block label="合作码" :value="row.cooperation_code" />
          <CopyText block label="视频链接" :value="row.dy_url" />
        </div>
        <div class="pc-actions">
          <el-button v-for="a in (PROMO_ACTIONS[row.auth_status] || [])" :key="a.action"
            size="small" :type="a.type"
            @click="a.action === 'mark_failed' ? openFail(row) : doTransition(row, a.action)">
            {{ a.label }}
          </el-button>
          <el-button size="small" text @click="expanded = expanded === row.id ? null : row.id">
            {{ expanded === row.id ? '收起' : '展开复制' }}
          </el-button>
          <el-button size="small" link type="danger" style="margin-left:auto" @click="removePromo(row)">删除</el-button>
        </div>
      </div>

      <el-pagination v-if="pTotal > 50" background layout="prev, pager, next, total"
        :total="pTotal" :page-size="50" :current-page="pPage"
        style="margin-top:12px; justify-content:flex-end" @current-change="onPPage" />

      <!-- 投流失败(填原因) -->
      <el-dialog v-model="failVisible" title="标记投流失败" width="480px">
        <el-input v-model="failReason" placeholder="失败原因" type="textarea" :rows="2" />
        <div style="margin-top:10px">
          <div class="muted" style="font-size:12px;margin-bottom:6px">失败截图(可选)</div>
          <MultiUpload v-model="failProofKeys" :max="3" prefix="promo_fail" />
        </div>
        <template #footer>
          <el-button @click="failVisible = false">取消</el-button>
          <el-button type="danger" @click="doFail">确认</el-button>
        </template>
      </el-dialog>
    </div>
  </div>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus'
import { nextTick, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import api from '../api'
import CopyText from '../components/CopyText.vue'
import InfluencerSelect from '../components/InfluencerSelect.vue'
import MultiUpload from '../components/MultiUpload.vue'
import { formatTime as ft } from '../utils/time'

const route = useRoute()
const mainTab = ref('video')
const expanded = ref(null)
const products = ref([])

// ---------- 登记视频 ----------
const createVideoVisible = ref(false)
const videoForm = reactive({ influencer_id: null, product_id: null, dy_url: '' })
function openCreateVideo() {
  videoForm.influencer_id = null
  videoForm.product_id = null
  videoForm.dy_url = ''
  createVideoVisible.value = true
}
async function doCreateVideo() {
  if (!videoForm.influencer_id || !videoForm.product_id) {
    ElMessage.warning('请选择达人和产品')
    return
  }
  try {
    await api.post('/api/videos', { ...videoForm, dy_url: videoForm.dy_url || undefined })
    createVideoVisible.value = false
    ElMessage.success('已登记(待审)')
    vTab.value = 'submitted'
    loadVideos()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '登记失败')
  }
}
async function removeVideo(row) {
  await ElMessageBox.confirm('确认删除该视频任务?(连带其投流记录)', '提示', { type: 'warning' })
  await api.delete(`/api/videos/${row.id}`)
  ElMessage.success('已删除')
  loadVideos()
}
async function removePromo(row) {
  await ElMessageBox.confirm('确认删除该投流记录?', '提示', { type: 'warning' })
  await api.delete(`/api/promotions/${row.id}`)
  ElMessage.success('已删除')
  loadPromotions()
}

// ---------- 视频审核 ----------
const VIDEO_TABS = [
  { key: 'submitted', label: '待审' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '已拒绝' },
  { key: 'blocked', label: '卡审' },
]
const VIDEO_TAG = { submitted: 'info', approved: 'success', rejected: 'danger', blocked: 'warning' }
const vTab = ref('submitted')
const videos = ref([])
const vCounts = ref({})
const vLoading = ref(false)
const vSearch = ref('')
const vPage = ref(1)
const vTotal = ref(0)

const rejectVisible = ref(false)
const rejectReason = ref('')
const timeComments = ref('')
let currentVideo = null

const videoTabLabel = (k) => VIDEO_TABS.find((t) => t.key === k)?.label || k
const videoBadgeType = (k) => (['submitted', 'blocked'].includes(k) ? 'danger' : 'info')

async function loadVideos() {
  vLoading.value = true
  try {
    const [r, nextCounts] = await Promise.all([
      api.get('/api/videos', {
        params: { status: vTab.value, q: vSearch.value || undefined, page: vPage.value, page_size: 50 },
      }),
      api.get('/api/videos/status-counts'),
    ])
    videos.value = r.items
    vTotal.value = r.total
    vCounts.value = nextCounts
  } finally {
    vLoading.value = false
  }
}
function reloadVideos() { vPage.value = 1; loadVideos() }
function onVPage(p) { vPage.value = p; loadVideos() }

async function passVideo(row) {
  await api.post(`/api/videos/${row.id}/audit`, { approve: true })
  ElMessage.success('已通过')
  loadVideos()
}

async function blockVideo(row) {
  try {
    await api.post(`/api/videos/${row.id}/audit`, { approve: false, blocked: true })
    ElMessage.success('已标记卡审')
    loadVideos()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '操作失败')
  }
}

function openReject(row) {
  currentVideo = row
  rejectReason.value = ''
  timeComments.value = ''
  rejectVisible.value = true
}
async function doReject() {
  const tc = timeComments.value.split('\n').map((s) => s.trim()).filter(Boolean)
  await api.post(`/api/videos/${currentVideo.id}/audit`, {
    approve: false, reject_reason: rejectReason.value,
    time_comments: tc.length ? tc : undefined,
  })
  rejectVisible.value = false
  ElMessage.success('已拒绝')
  loadVideos()
}

async function startPromotion(row) {
  try {
    await api.post('/api/promotions', { video_task_id: row.id })
    ElMessage.success('已发起投流,已跳转「投流管理」跟进')
    mainTab.value = 'promotion'
    pTab.value = 'pending_request'
    pPage.value = 1
    loadPromotions()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '发起失败')
  }
}

// ---------- 投流管理 ----------
const PROMO_TABS = [
  { key: 'pending_request', label: '待发起授权' },
  { key: 'pending_confirm', label: '待达人确认' },
  { key: 'authorized', label: '已授权' },
  { key: 'promoted', label: '已投流' },
  { key: 'failed', label: '投流失败' },
  { key: 'refused', label: '达人拒绝' },
  { key: 'done', label: '完成' },
]
const PROMO_TAG = {
  pending_request: 'info', pending_confirm: 'info', authorized: 'primary',
  promoted: 'success', failed: 'danger', refused: 'danger', done: 'success',
}
// 每个状态下可用的流转按钮(与后端 TRANSITIONS 对应)
const PROMO_ACTIONS = {
  pending_request: [
    { action: 'request_auth', label: '我已发起授权', type: 'primary' },
    { action: 'mark_promoted', label: '我已投流', type: 'success' },
  ],
  pending_confirm: [
    { action: 'confirm_auth', label: '确认达人已授权', type: 'primary' },
    { action: 'refuse', label: '达人拒绝', type: 'danger' },
  ],
  authorized: [
    { action: 'mark_promoted', label: '我已投流', type: 'success' },
    { action: 'mark_failed', label: '投流失败', type: 'danger' },
  ],
  promoted: [
    { action: 'done', label: '完成', type: 'success' },
    { action: 'mark_failed', label: '投流失败', type: 'danger' },
  ],
  failed: [
    { action: 'mark_promoted', label: '重试投流', type: 'warning' },
  ],
}
const pTab = ref('pending_request')
const promotions = ref([])
const pCounts = ref({})
const pLoading = ref(false)
const pSearch = ref('')
const pPage = ref(1)
const pTotal = ref(0)
function reloadPromotions() { pPage.value = 1; loadPromotions() }
function onPPage(p) { pPage.value = p; loadPromotions() }

const failVisible = ref(false)
const failReason = ref('')
const failProofKeys = ref([])
let currentPromo = null

const promoLabel = (k) => PROMO_TABS.find((t) => t.key === k)?.label || k
const promoBadgeType = (k) => (['pending_request', 'pending_confirm', 'failed'].includes(k) ? 'danger' : 'info')

async function loadPromotions() {
  pLoading.value = true
  try {
    const [r, nextCounts] = await Promise.all([
      api.get('/api/promotions', {
        params: { auth_status: pTab.value, q: pSearch.value || undefined, page: pPage.value, page_size: 50 },
      }),
      api.get('/api/promotions/status-counts'),
    ])
    promotions.value = r.items
    pTotal.value = r.total
    pCounts.value = nextCounts
  } finally {
    pLoading.value = false
  }
}

async function doTransition(row, action) {
  try {
    await api.post(`/api/promotions/${row.id}/transition`, { action })
    ElMessage.success('已更新')
    loadPromotions()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '操作失败')
  }
}

function openFail(row) {
  currentPromo = row
  failReason.value = ''
  failProofKeys.value = []
  failVisible.value = true
}
async function doFail() {
  try {
    await api.post(`/api/promotions/${currentPromo.id}/transition`, {
      action: 'mark_failed', fail_reason: failReason.value,
      fail_proof_oss_key: failProofKeys.value[0] || undefined,
    })
    failVisible.value = false
    ElMessage.success('已标记失败')
    loadPromotions()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '操作失败')
  }
}

function onMainTab(name) {
  if (name === 'video') loadVideos()
  else loadPromotions()
}

onMounted(async () => {
  api.get('/api/products').then((rows) => { products.value = rows }).catch(() => {})
  // 工作台待办深链:?main=promotion 进投流管理,?tab= 精确到子分栏
  if (route.query.main === 'promotion') mainTab.value = 'promotion'
  if (mainTab.value === 'video') {
    if (route.query.tab && VIDEO_TABS.some((t) => t.key === route.query.tab)) vTab.value = route.query.tab
    nextTick(loadVideos)
  } else {
    if (route.query.tab && PROMO_TABS.some((t) => t.key === route.query.tab)) pTab.value = route.query.tab
    nextTick(loadPromotions)
  }
})
</script>

<style scoped>
.page-toolbar { display: flex; align-items: center; justify-content: space-between; }
.flex-tabs { flex: 1; }
.flex-tabs :deep(.el-tabs__header) { margin-bottom: 12px; }
.tab-label-badge { display: inline-flex; align-items: center; gap: 6px; }
.promo-card { background: #fff; border: 1px solid #f0f1f5; border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; }
.pc-head { display: flex; align-items: center; justify-content: space-between; }
.pc-name { font-weight: 600; }
.pc-sub { font-size: 12px; margin-top: 4px; }
.pc-copy { margin-top: 10px; padding: 10px 12px; background: #f8f9fc; border-radius: 8px; display: flex; flex-direction: column; gap: 6px; }
.pc-actions { display: flex; gap: 8px; margin-top: 10px; align-items: center; }
.link { color: #6b5cf6; text-decoration: none; }
.link:hover { text-decoration: underline; }
</style>
