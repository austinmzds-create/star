<template>
  <div>
    <div class="page-toolbar">
      <el-tabs v-model="tab" @tab-change="load" class="flex-tabs">
        <el-tab-pane name="pending">
          <template #label>
            <span class="tab-label-badge">待审批
              <el-badge v-if="pendingCount" :value="pendingCount" type="danger" />
            </span>
          </template>
        </el-tab-pane>
        <el-tab-pane label="已通过" name="approved" />
        <el-tab-pane label="已拒绝" name="rejected" />
        <el-tab-pane label="全部" name="all" />
      </el-tabs>
    </div>

    <el-table :data="rows" v-loading="loading">
      <el-table-column label="达人">
        <template #default="{ row }">
          <router-link :to="`/influencers/${row.influencer_id}`" class="link">{{ row.influencer_nickname }}</router-link>
        </template>
      </el-table-column>
      <el-table-column prop="requester_name" label="申请商务" width="120" />
      <el-table-column prop="current_owner_name" label="当前归属" width="120">
        <template #default="{ row }">{{ row.current_owner_name || '无' }}</template>
      </el-table-column>
      <el-table-column prop="reason" label="理由" show-overflow-tooltip />
      <el-table-column label="状态" width="90">
        <template #default="{ row }"><el-tag size="small" :type="STATUS_TYPE[row.status]">{{ STATUS_LABEL[row.status] }}</el-tag></template>
      </el-table-column>
      <el-table-column label="时间" width="120">
        <template #default="{ row }">{{ fmtDate(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="160">
        <template #default="{ row }">
          <template v-if="row.status === 'pending'">
            <el-button size="small" type="success" @click="openReview(row, true)">通过</el-button>
            <el-button size="small" type="danger" plain @click="openReview(row, false)">拒绝</el-button>
          </template>
          <span v-else class="muted">{{ row.review_note || '—' }}</span>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && !rows.length" description="暂无建联申请" :image-size="70" />

    <el-dialog v-model="reviewVisible" :title="approving ? '通过建联申请' : '拒绝建联申请'" width="440px">
      <p class="muted" style="font-size:13px;margin:0 0 12px">
        <template v-if="approving">通过后「{{ current?.influencer_nickname }}」归属将转给 {{ current?.requester_name }},原商务转为只读。</template>
        <template v-else>拒绝「{{ current?.requester_name }}」对「{{ current?.influencer_nickname }}」的建联申请。</template>
      </p>
      <el-input v-model="reviewNote" type="textarea" :rows="2" placeholder="审批备注(可选)" />
      <template #footer>
        <el-button @click="reviewVisible = false">取消</el-button>
        <el-button :type="approving ? 'success' : 'danger'" :loading="reviewing" @click="doReview">
          {{ approving ? '确认通过' : '确认拒绝' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { computed, onMounted, ref } from 'vue'
import api from '../api'

const STATUS_LABEL = { pending: '待审批', approved: '已通过', rejected: '已拒绝', withdrawn: '已撤回' }
const STATUS_TYPE = { pending: 'warning', approved: 'success', rejected: 'danger', withdrawn: 'info' }

const tab = ref('pending')
const rows = ref([])
const loading = ref(false)
const pendingCount = ref(0)
const reviewVisible = ref(false)
const approving = ref(true)
const reviewNote = ref('')
const reviewing = ref(false)
const current = ref(null)

const fmtDate = (v) => (v ? v.slice(0, 10) : '—')

async function load() {
  loading.value = true
  try {
    const status = tab.value === 'all' ? undefined : tab.value
    rows.value = await api.get('/api/connection-requests', { params: { status } })
    const r = await api.get('/api/connection-requests/pending-count')
    pendingCount.value = r.count || 0
  } finally {
    loading.value = false
  }
}

function openReview(row, approve) {
  current.value = row
  approving.value = approve
  reviewNote.value = ''
  reviewVisible.value = true
}
async function doReview() {
  reviewing.value = true
  try {
    await api.post(`/api/connection-requests/${current.value.id}/review`,
      { approve: approving.value, note: reviewNote.value || undefined })
    ElMessage.success(approving.value ? '已通过并转移归属' : '已拒绝')
    reviewVisible.value = false
    window.dispatchEvent(new Event('nav-badge-refresh'))
    await load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '操作失败')
  } finally {
    reviewing.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.page-toolbar { display: flex; align-items: center; }
.flex-tabs { flex: 1; }
.flex-tabs :deep(.el-tabs__header) { margin-bottom: 12px; }
.tab-label-badge { display: inline-flex; align-items: center; gap: 6px; }
.link { color: #6b5cf6; text-decoration: none; }
.link:hover { text-decoration: underline; }
</style>
