<template>
  <div>
    <div class="page-toolbar">
      <el-tabs v-model="tab" @tab-change="reload" class="flex-tabs">
        <el-tab-pane v-for="s in TABS" :key="s.key" :name="s.key">
          <template #label>
            <span class="tab-label-badge">
              {{ s.label }}
              <el-badge v-if="counts[s.key]" :value="counts[s.key]" :type="['pending','approved'].includes(s.key) ? 'danger' : 'info'" />
            </span>
          </template>
        </el-tab-pane>
      </el-tabs>
      <div class="toolbar-right">
        <el-switch v-if="!isAdmin" v-model="mineOnly" active-text="只看我的" @change="reload" />
        <el-input v-model="search" placeholder="搜达人/抖音号/手机号/产品" clearable style="width:230px"
          @keyup.enter="reload" @clear="reload" />
        <el-button @click="reload">查询</el-button>
        <el-button type="primary" @click="openCreate">+ 手动添加</el-button>
      </div>
    </div>

    <el-table :data="rows" v-loading="loading" row-key="id">
      <el-table-column label="达人" min-width="170">
        <template #default="{ row }">
          <router-link :to="`/influencers/${row.influencer_id}`" class="link">{{ row.influencer_nickname }}</router-link>
          <div class="sub">{{ row.douyin_id || '无抖音号' }} <span v-if="row.phone">/{{ row.phone }}</span></div>
        </template>
      </el-table-column>
      <el-table-column label="产品" min-width="180">
        <template #default="{ row }">
          <div class="product-cell">
            <el-image v-if="row.product_image" :src="row.product_image" fit="cover" class="product-thumb" />
            <div v-else class="product-thumb placeholder" />
            <router-link :to="{ path: '/products', query: { open: row.product_id } }" class="link">{{ row.product_name }}</router-link>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="owner_bd_name" label="归属商务" width="100" />
      <el-table-column label="状态" width="105">
        <template #default="{ row }"><el-tag size="small" :type="statusTag(row.status)">{{ STATUS_LABEL[row.status] || row.status }}</el-tag></template>
      </el-table-column>
      <el-table-column label="物流" min-width="210">
        <template #default="{ row }">
          <span v-if="row.tracking_no">{{ row.courier_company || '' }} {{ row.tracking_no }}</span>
          <span v-else class="sub">暂无单号</span>
          <div v-if="lastEvent(row)" class="sub">{{ lastEvent(row).context }}</div>
          <div v-if="lastEvent(row)?.ftime || lastEvent(row)?.time" class="sub">{{ lastEvent(row).ftime || lastEvent(row).time }}</div>
        </template>
      </el-table-column>
      <el-table-column label="业务数据" min-width="160">
        <template #default="{ row }">
          <div class="biz">视频 {{ row.video_count || 0 }} / GMV ¥{{ Number(row.gmv || 0).toFixed(2) }}</div>
          <div class="sub">投流 {{ row.promotion_status || '无' }}</div>
        </template>
      </el-table-column>
      <el-table-column prop="reject_reason" label="拒绝原因" show-overflow-tooltip />
      <el-table-column label="更新" width="120">
        <template #default="{ row }">{{ fmt(row.updated_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <template v-if="row.status === 'pending' && row.can_operate">
            <el-button size="small" type="success" :loading="operatingId === row.id" @click="review(row, true)">通过</el-button>
            <el-button size="small" type="danger" plain :disabled="operatingId === row.id" @click="openReject(row)">拒绝</el-button>
          </template>
          <el-button v-else-if="row.status === 'approved' && row.can_operate" size="small" type="primary" @click="openShip(row)">
            填单号发货
          </el-button>
          <span v-else class="sub">{{ row.can_operate ? '—' : '只读' }}</span>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && !rows.length" description="暂无带货记录" :image-size="70" />
    <el-pagination v-if="total > pageSize" background layout="prev, pager, next, total"
      :total="total" :page-size="pageSize" :current-page="page"
      style="margin-top:12px; justify-content:flex-end" @current-change="onPage" />

    <el-dialog v-model="createVisible" title="手动添加带货达人" width="480px">
      <el-form label-width="72px">
        <el-form-item label="达人"><InfluencerSelect v-model="createForm.influencer_id" style="width:100%" /></el-form-item>
        <el-form-item label="产品">
          <el-select v-model="createForm.product_id" filterable placeholder="选择产品" style="width:100%">
            <el-option v-for="p in products" :key="p.id" :label="p.name" :value="p.id"
              :disabled="p.allow_promotion === false" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="createForm.note" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="doCreate">添加并通过</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="rejectVisible" title="拒绝带货申请" width="440px">
      <el-input v-model="rejectReason" type="textarea" :rows="3" placeholder="请填写拒绝原因,达人端会看到" />
      <template #footer>
        <el-button @click="rejectVisible = false">取消</el-button>
        <el-button type="danger" :loading="reviewing" @click="doReject">确认拒绝</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="shipVisible" title="填单号发货" width="480px">
      <el-select v-model="shipForm.courier" placeholder="选择快递公司" style="width:100%" filterable>
        <el-option v-for="c in couriers" :key="c.code" :label="c.name" :value="c.code" />
      </el-select>
      <el-input v-model="shipForm.tracking_no" placeholder="快递单号" style="margin-top:8px" />
      <el-input v-model="shipForm.phone" placeholder="收件人手机号(顺丰等需要)" style="margin-top:8px" />
      <template #footer>
        <el-button @click="shipVisible = false">取消</el-button>
        <el-button type="primary" :loading="shipping" @click="doShip">发货</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import api from '../api'
import InfluencerSelect from '../components/InfluencerSelect.vue'

const route = useRoute()
const user = JSON.parse(localStorage.getItem('user') || '{}')
const isAdmin = user.role === 'admin'
const TABS = [
  { key: 'pending', label: '审核中' },
  { key: 'approved', label: '待发货' },
  { key: 'shipped', label: '已发货' },
  { key: 'in_transit', label: '运输中' },
  { key: 'signed', label: '已签收' },
  { key: 'rejected', label: '已拒绝' },
  { key: 'cancelled', label: '已取消' },
  { key: 'all', label: '全部' },
]
const STATUS_LABEL = { pending: '审核中', approved: '待发货', shipped: '已发货', in_transit: '运输中', signed: '已签收', rejected: '已拒绝', cancelled: '已取消' }

const initialTab = (() => {
  const value = String(route.query.tab || route.query.status || (route.query.q ? 'all' : 'pending'))
  return TABS.some((item) => item.key === value) ? value : 'pending'
})()
const tab = ref(initialTab)
const rows = ref([])
const counts = ref({})
const loading = ref(false)
const search = ref(route.query.q ? String(route.query.q) : '')
const mineOnly = ref(false)
const page = ref(1)
const total = ref(0)
const pageSize = 50
const products = ref([])
const couriers = ref([])

const createVisible = ref(false)
const creating = ref(false)
const createForm = reactive({ influencer_id: null, product_id: null, note: '' })
const rejectVisible = ref(false)
const rejectReason = ref('')
const reviewing = ref(false)
const shipVisible = ref(false)
const shipping = ref(false)
const shipForm = reactive({ tracking_no: '', courier: '', phone: '' })
const current = ref(null)
const operatingId = ref(null)

const fmt = (v) => (v ? v.slice(0, 10) : '—')
const lastEvent = (row) => row.logistics_status?.last_event || row.logistics_status?.events?.[0] || null
const statusTag = (status) => {
  if (status === 'pending' || status === 'approved') return 'warning'
  if (status === 'rejected') return 'danger'
  if (status === 'signed') return 'success'
  if (status === 'cancelled') return 'info'
  return 'primary'
}

let seq = 0
async function load() {
  const cur = ++seq
  loading.value = true
  try {
    const status = tab.value === 'all' ? undefined : tab.value
    const [r, c] = await Promise.all([
      api.get('/api/product-applications', {
        params: { status, q: search.value || undefined, mine_only: mineOnly.value || undefined, page: page.value, page_size: pageSize },
      }),
      api.get('/api/product-applications/status-counts', {
        params: { q: search.value || undefined, mine_only: mineOnly.value || undefined },
      }),
    ])
    if (cur !== seq) return
    rows.value = r.items
    total.value = r.total
    counts.value = c
  } catch (e) {
    if (cur === seq) ElMessage.error(e.response?.data?.detail || '加载失败')
  } finally {
    if (cur === seq) loading.value = false
  }
}
function reload() { page.value = 1; load() }
function onPage(p) { page.value = p; load() }

function openCreate() {
  Object.assign(createForm, { influencer_id: null, product_id: null, note: '' })
  createVisible.value = true
}
async function doCreate() {
  if (!createForm.influencer_id || !createForm.product_id) return ElMessage.warning('请选择达人和产品')
  creating.value = true
  try {
    await api.post('/api/product-applications', { ...createForm })
    ElMessage.success('已添加到带货流程')
    createVisible.value = false
    tab.value = 'approved'
    await load()
    refreshNavBadges()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '添加失败')
  } finally {
    creating.value = false
  }
}

async function review(row, approve) {
  if (reviewing.value || operatingId.value) return
  reviewing.value = true
  operatingId.value = row.id
  try {
    await api.post(`/api/product-applications/${row.id}/review`, { approve })
    ElMessage.success('已通过,进入待发货')
    await load()
    refreshNavBadges()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '操作失败')
  } finally {
    reviewing.value = false
    operatingId.value = null
  }
}
function openReject(row) {
  current.value = row
  rejectReason.value = ''
  rejectVisible.value = true
}
async function doReject() {
  if (reviewing.value) return
  if (!current.value?.id) return ElMessage.warning('请选择申请')
  if (!rejectReason.value.trim()) return ElMessage.warning('请填写拒绝原因')
  reviewing.value = true
  try {
    await api.post(`/api/product-applications/${current.value.id}/review`,
      { approve: false, reject_reason: rejectReason.value })
    ElMessage.success('已拒绝')
    rejectVisible.value = false
    await load()
    refreshNavBadges()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '操作失败')
  } finally {
    reviewing.value = false
  }
}

function openShip(row) {
  current.value = row
  Object.assign(shipForm, { tracking_no: '', courier: '', phone: '' })
  shipVisible.value = true
}
async function doShip() {
  if (shipping.value) return
  if (!current.value?.id) return ElMessage.warning('请选择申请')
  if (!shipForm.tracking_no.trim()) return ElMessage.warning('请填写快递单号')
  shipping.value = true
  try {
    await api.post(`/api/product-applications/${current.value.id}/ship`, {
      tracking_no: shipForm.tracking_no,
      courier: shipForm.courier || undefined,
      phone: shipForm.phone || undefined,
    })
    ElMessage.success('已发货')
    shipVisible.value = false
    tab.value = 'shipped'
    await load()
    refreshNavBadges()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '发货失败')
  } finally {
    shipping.value = false
  }
}

onMounted(async () => {
  const [plist, courierList] = await Promise.all([
    api.get('/api/products', { params: { status: 'on' } }),
    api.get('/api/samples/couriers'),
  ])
  products.value = plist.filter((p) => p.status === 'on')
  couriers.value = courierList
  await load()
})

function refreshNavBadges() {
  window.dispatchEvent(new Event('nav-badge-refresh'))
}
</script>

<style scoped>
.page-toolbar { display: flex; align-items: center; gap: 12px; }
.flex-tabs { flex: 1; min-width: 0; }
.flex-tabs :deep(.el-tabs__header) { margin-bottom: 12px; }
.toolbar-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.tab-label-badge { display: inline-flex; align-items: center; gap: 6px; }
.link { color: #6b5cf6; text-decoration: none; }
.link:hover { text-decoration: underline; }
.sub { color: #8a93a6; font-size: 12px; line-height: 1.5; }
.biz { color: #303545; font-size: 13px; }
.product-cell { display: flex; align-items: center; gap: 8px; min-width: 0; }
.product-thumb { width: 32px; height: 32px; border-radius: 6px; flex-shrink: 0; }
.product-thumb.placeholder { background: #eef0f5; }
@media (max-width: 900px) {
  .page-toolbar { display: block; }
  .toolbar-right { justify-content: flex-start; margin-bottom: 10px; }
}
</style>
