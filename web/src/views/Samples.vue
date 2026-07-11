<template>
  <div>
    <el-tabs v-model="tab" @tab-change="load">
      <el-tab-pane v-for="s in TABS" :key="s.key" :name="s.key"
        :label="`${s.label}${counts[s.key] ? ' ' + counts[s.key] : ''}`" />
    </el-tabs>

    <el-table :data="rows" v-loading="loading">
      <el-table-column prop="influencer_nickname" label="达人" />
      <el-table-column prop="product_name" label="产品" />
      <el-table-column prop="round_no" label="轮次" width="70" />
      <el-table-column label="物流">
        <template #default="{ row }">
          <span v-if="row.tracking_no">{{ row.courier_company || '' }} {{ row.tracking_no }}</span>
          <el-tag v-if="row.logistics_status" size="small" :type="row.logistics_status.signed ? 'success' : 'info'">
            {{ STATUS_LABEL[row.logistics_status.status] || row.logistics_status.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="reject_reason" label="拒绝原因" show-overflow-tooltip />
      <el-table-column label="操作" width="260">
        <template #default="{ row }">
          <template v-if="row.status === 'pending'">
            <el-button size="small" type="success" @click="pass(row)">通过</el-button>
            <el-button size="small" type="danger" @click="openReject(row)">拒绝</el-button>
          </template>
          <el-button v-else-if="row.status === 'approved'" size="small" type="primary" @click="openShip(row)">
            填单号发货
          </el-button>
          <el-button v-else-if="row.tracking_no" size="small" @click="refreshTrack(row)">刷新物流</el-button>
          <span v-else style="color: #909399">{{ tabLabel(row.status) }}</span>
        </template>
      </el-table-column>
    </el-table>

    <!-- 拒绝(拒绝理由库) -->
    <el-dialog v-model="rejectVisible" title="拒绝寄样" width="480px">
      <el-select v-model="rejectReason" placeholder="选择拒绝原因" style="width: 100%" filterable allow-create>
        <el-option v-for="r in reasons" :key="r.id" :label="r.text" :value="r.text" />
      </el-select>
      <template #footer>
        <el-button @click="rejectVisible = false">取消</el-button>
        <el-button type="danger" @click="doReject">确认拒绝</el-button>
      </template>
    </el-dialog>

    <!-- 发货(选快递公司 + 单号 → 快递100 订阅) -->
    <el-dialog v-model="shipVisible" title="填单号发货" width="480px">
      <el-select v-model="courier" placeholder="选择快递公司" style="width: 100%" filterable>
        <el-option v-for="c in couriers" :key="c.code" :label="c.name" :value="c.code" />
      </el-select>
      <el-input v-model="trackingNo" placeholder="快递单号" style="margin-top: 8px" />
      <el-input v-model="shipPhone" placeholder="收件人手机号(顺丰等需要)" style="margin-top: 8px" />
      <p style="color: #909399; font-size: 12px">
        提交后订阅轨迹推送(快递100);也可在列表点「刷新物流」实时查询。签收后进入催拍计时。
      </p>
      <template #footer>
        <el-button @click="shipVisible = false">取消</el-button>
        <el-button type="primary" @click="doShip">发货</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { onMounted, ref } from 'vue'
import api from '../api'

const TABS = [
  { key: 'pending', label: '待审批' },
  { key: 'approved', label: '待发货' },
  { key: 'shipped', label: '已发货' },
  { key: 'signed', label: '已签收' },
  { key: 'rejected', label: '已拒绝' },
]
const STATUS_LABEL = { shipped: '已揽收', in_transit: '运输中', signed: '已签收' }

const tab = ref('pending')
const rows = ref([])
const counts = ref({})
const reasons = ref([])
const loading = ref(false)

const rejectVisible = ref(false)
const rejectReason = ref('')
const shipVisible = ref(false)
const trackingNo = ref('')
const shipPhone = ref('')
const courier = ref('')
const couriers = ref([])
let current = null

const tabLabel = (k) => TABS.find((t) => t.key === k)?.label || k

async function load() {
  loading.value = true
  try {
    rows.value = await api.get('/api/samples', { params: { status: tab.value } })
    counts.value = await api.get('/api/samples/status-counts')
  } finally {
    loading.value = false
  }
}

async function pass(row) {
  await api.post(`/api/samples/${row.id}/audit`, { approve: true })
  ElMessage.success('已通过')
  load()
}

function openReject(row) {
  current = row
  rejectReason.value = ''
  rejectVisible.value = true
}
async function doReject() {
  await api.post(`/api/samples/${current.id}/audit`, { approve: false, reject_reason: rejectReason.value })
  rejectVisible.value = false
  ElMessage.success('已拒绝')
  load()
}

function openShip(row) {
  current = row
  trackingNo.value = ''
  shipPhone.value = ''
  courier.value = ''
  shipVisible.value = true
}
async function doShip() {
  if (!courier.value || !trackingNo.value) {
    ElMessage.warning('请选择快递公司并填写单号')
    return
  }
  try {
    const r = await api.post(`/api/samples/${current.id}/ship`, {
      tracking_no: trackingNo.value, courier: courier.value, phone: shipPhone.value || undefined,
    })
    shipVisible.value = false
    ElMessage.success(r.subscribed ? '已发货并订阅轨迹' : `已发货(订阅未成功:${r.message || ''})`)
    load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '发货失败')
  }
}

async function refreshTrack(row) {
  try {
    const r = await api.post(`/api/samples/${row.id}/track`)
    if (r.ok) ElMessage.success(`最新:${r.last_event?.context || r.status || '已更新'}`)
    else ElMessage.info(r.message || '暂无轨迹')
    load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '查询失败')
  }
}

onMounted(async () => {
  reasons.value = await api.get('/api/samples/reject-reasons')
  couriers.value = await api.get('/api/samples/couriers')
  load()
})
</script>
