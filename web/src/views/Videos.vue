<template>
  <div>
    <el-tabs v-model="mainTab" @tab-change="onMainTab">
      <el-tab-pane name="video" label="视频审核" />
      <el-tab-pane name="promotion" label="投流管理" />
    </el-tabs>

    <!-- ===================== 视频审核 ===================== -->
    <div v-if="mainTab === 'video'" key="video-pane">
      <el-tabs v-model="vTab" @tab-change="loadVideos">
        <el-tab-pane v-for="s in VIDEO_TABS" :key="s.key" :name="s.key"
          :label="`${s.label}${vCounts[s.key] ? ' ' + vCounts[s.key] : ''}`" />
      </el-tabs>

      <el-table :data="videos">
        <el-table-column prop="influencer_nickname" label="达人" />
        <el-table-column prop="product_name" label="产品" />
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
          </template>
        </el-table-column>
      </el-table>

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
      <el-tabs v-model="pTab" @tab-change="loadPromotions">
        <el-tab-pane v-for="s in PROMO_TABS" :key="s.key" :name="s.key"
          :label="`${s.label}${pCounts[s.key] ? ' ' + pCounts[s.key] : ''}`" />
      </el-tabs>

      <el-table :data="promotions">
        <el-table-column prop="influencer_nickname" label="达人" />
        <el-table-column prop="product_name" label="产品" />
        <el-table-column label="投流方式" width="100">
          <template #default="{ row }">
            {{ row.mode_snapshot === 'self' ? '达人自投' : '商家投流' }}
          </template>
        </el-table-column>
        <el-table-column label="当前状态" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="PROMO_TAG[row.auth_status] || 'info'">
              {{ promoLabel(row.auth_status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="fail_reason" label="失败原因" show-overflow-tooltip />
        <el-table-column label="操作" width="360">
          <template #default="{ row }">
            <el-button v-for="a in (PROMO_ACTIONS[row.auth_status] || [])" :key="a.action"
              size="small" :type="a.type"
              @click="a.action === 'mark_failed' ? openFail(row) : doTransition(row, a.action)">
              {{ a.label }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 投流失败(填原因) -->
      <el-dialog v-model="failVisible" title="标记投流失败" width="480px">
        <el-input v-model="failReason" placeholder="失败原因" type="textarea" :rows="2" />
        <el-input v-model="failProof" placeholder="失败截图 OSS key(可选)" style="margin-top: 8px" />
        <template #footer>
          <el-button @click="failVisible = false">取消</el-button>
          <el-button type="danger" @click="doFail">确认</el-button>
        </template>
      </el-dialog>
    </div>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { nextTick, onMounted, ref } from 'vue'
import api from '../api'

const mainTab = ref('video')

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

const rejectVisible = ref(false)
const rejectReason = ref('')
const timeComments = ref('')
let currentVideo = null

const videoTabLabel = (k) => VIDEO_TABS.find((t) => t.key === k)?.label || k

async function loadVideos() {
  vLoading.value = true
  try {
    videos.value = await api.get('/api/videos', { params: { status: vTab.value } })
    vCounts.value = await api.get('/api/videos/status-counts')
  } finally {
    vLoading.value = false
  }
}

async function passVideo(row) {
  await api.post(`/api/videos/${row.id}/audit`, { approve: true })
  ElMessage.success('已通过')
  loadVideos()
}

function blockVideo(row) {
  api.post(`/api/videos/${row.id}/audit`, { approve: false, blocked: true }).then(() => {
    ElMessage.success('已标记卡审')
    loadVideos()
  })
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
    ElMessage.success('已发起投流,可在「投流管理」跟进')
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

const failVisible = ref(false)
const failReason = ref('')
const failProof = ref('')
let currentPromo = null

const promoLabel = (k) => PROMO_TABS.find((t) => t.key === k)?.label || k

async function loadPromotions() {
  pLoading.value = true
  try {
    promotions.value = await api.get('/api/promotions', { params: { auth_status: pTab.value } })
    // 计数:前端按各状态拉一遍全量再统计(后端未提供 promotions 计数端点)
    const all = await api.get('/api/promotions')
    const c = {}
    for (const p of all) c[p.auth_status] = (c[p.auth_status] || 0) + 1
    pCounts.value = c
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
  failProof.value = ''
  failVisible.value = true
}
async function doFail() {
  try {
    await api.post(`/api/promotions/${currentPromo.id}/transition`, {
      action: 'mark_failed', fail_reason: failReason.value,
      fail_proof_oss_key: failProof.value || undefined,
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

// 延到首帧之后再触发加载,避免 vLoading 在挂载中同步翻转导致 v-loading 指令报错
onMounted(() => nextTick(loadVideos))
</script>
