<template>
  <div>
    <div class="toolbar">
      <el-segmented v-if="!isAdmin" v-model="scopeMode" :options="SCOPE_OPTIONS" @change="() => { page = 1; load() }" />
      <el-input v-model="q" placeholder="搜昵称/抖音号/UID/手机号" style="width: 240px" clearable @change="() => { page = 1; load() }" />
      <el-select v-model="level" placeholder="等级" style="width: 100px" clearable @change="() => { page = 1; load() }">
        <el-option label="L1" value="L1" /><el-option label="L2" value="L2" /><el-option label="L3" value="L3" />
      </el-select>
      <el-popover trigger="click" width="240">
        <template #reference>
          <el-button>列顺序</el-button>
        </template>
        <div class="column-sort">
          <div
            v-for="(col, idx) in orderedColumns"
            :key="col.key"
            class="column-sort-row"
            draggable="true"
            @dragstart="dragColumnIdx = idx"
            @dragover.prevent
            @drop.prevent="dropColumn(idx)"
          >
            <span class="drag-handle">☰</span>
            <span>{{ col.label }}</span>
          </div>
          <div class="column-sort-actions">
            <el-button size="small" text @click="resetColumnOrder">恢复默认</el-button>
          </div>
        </div>
      </el-popover>
      <el-button @click="importVisible = true">Excel 导入</el-button>
      <el-button type="primary" @click="showPaste = true">+ 粘贴录入达人</el-button>
      <el-tag v-if="ownerBdId" closable type="warning" @close="clearOwnerFilter">
        仅看商务：{{ ownerBdName || '#' + ownerBdId }}
      </el-tag>
    </div>

    <el-table :data="rows" v-loading="loading" @row-click="(r) => $router.push(`/influencers/${r.id}`)" style="cursor: pointer">
      <el-table-column
        v-for="col in orderedColumns"
        :key="col.key"
        :label="col.label"
        :width="col.width"
        :min-width="col.minWidth"
      >
        <template #default="{ row }">
          <span v-if="col.key === 'nickname'">{{ row.nickname || '—' }}</span>
          <span v-else-if="col.key === 'douyin_id'">{{ row.douyin_id || '—' }}</span>
          <span v-else-if="col.key === 'fans_count'">{{ row.fans_count != null ? num(row.fans_count) : '—' }}</span>
          <span v-else-if="col.key === 'gmv_30d'">{{ row.gmv_30d != null ? num(row.gmv_30d) : '—' }}</span>
          <span v-else-if="col.key === 'data_source'">{{ row.data_source || (row.source === 'import' ? '导入' : row.source) || '—' }}</span>
          <el-tag v-else-if="col.key === 'level'">{{ row.level }}</el-tag>
          <span v-else-if="col.key === 'commission_tier'">{{ row.commission_tier }}%</span>
          <template v-else-if="col.key === 'tags'">
            <el-tag v-for="t in (row.tags || [])" :key="t" size="small" type="info" style="margin-right: 4px">{{ t }}</el-tag>
            <span v-if="!(row.tags || []).length">—</span>
          </template>
          <span v-else-if="col.key === 'owner_bd_name'">{{ row.owner_bd_name || '—' }}</span>
          <span v-else-if="col.key === 'round_count'">{{ row.round_count ?? 0 }}</span>
          <span v-else-if="col.key === 'updated_at'">{{ fmtDate(row.updated_at) }}</span>
        </template>
      </el-table-column>
      <el-table-column v-if="!isAdmin" label="操作" width="100">
        <template #default="{ row }">
          <el-button v-if="!row.owned" size="small" type="primary" plain
            @click.stop="openConnect(row)">申请建联</el-button>
          <el-tag v-else size="small" type="success" effect="plain">我的</el-tag>
        </template>
      </el-table-column>
    </el-table>

    <!-- 申请建联 -->
    <el-dialog v-model="connectVisible" title="申请建联" width="440px">
      <p class="muted" style="font-size:13px;margin:0 0 12px">
        向管理员申请把「{{ connectTarget?.nickname }}」的归属转到你名下。通过后你将获得操作权限,原商务转为只读。
      </p>
      <el-input v-model="connectReason" type="textarea" :rows="3" placeholder="建联理由(可选,便于管理员判断)" />
      <template #footer>
        <el-button @click="connectVisible = false">取消</el-button>
        <el-button type="primary" :loading="connecting" @click="submitConnect">提交申请</el-button>
      </template>
    </el-dialog>
    <el-empty v-if="!loading && !rows.length" description="暂无达人" :image-size="70" />
    <el-pagination v-if="total > pageSize" background layout="total, prev, pager, next" :total="total"
      :page-size="pageSize" :current-page="page" style="margin-top: 16px; justify-content: flex-end"
      @current-change="(p) => { page = p; load() }" />

    <!-- 录入达人:粘贴识别 / 手动填写 双模式(R1) -->
    <el-dialog v-model="showPaste" title="录入达人" width="640px" @closed="resetDialog">
      <el-segmented v-model="mode" :options="MODES" block style="margin-bottom: 16px" />

      <template v-if="mode === 'paste'">
        <el-input v-model="pasteText" type="textarea" :rows="6"
          placeholder="把达人在微信里发来的自我介绍整段粘贴到这里(含抖音号/UID/主页链接/粉丝数/收件信息等),点识别自动拆解" />
        <el-button type="primary" style="margin-top: 12px" :loading="parsing" @click="doParse">
          识别并拆解
        </el-button>
        <p v-if="parsed" class="muted" style="font-size: 12px; margin-top: 8px">
          黄色字段为 AI 推断,请核对;可继续手动修改后保存。
        </p>
      </template>

      <!-- 表单:手动模式直接显示;粘贴模式识别后显示 -->
      <template v-if="mode === 'manual' || parsed">
        <el-alert v-if="parsed && parsed.duplicate && parsed.duplicate.owned_by_other_bd"
          type="error" :closable="false" style="margin: 12px 0"
          :title="`该账号已被商务 ${parsed.duplicate.owner_bd_name || '其他同事'} 对接,请勿重复建档`" />
        <template v-else-if="parsed && parsed.duplicate">
          <el-alert type="warning" :closable="false" style="margin: 12px 0"
            :title="`达人已存在:${parsed.duplicate.nickname}(已合作 ${parsed.duplicate.round_count} 轮)`"
            :description="duplicateDiff.length ? '本次录入与已有档案有差异,勾选要更新的字段并填写原因,或直接打开已有档案。' : '本次录入无新差异,可直接打开已有档案继续维护。'" />
          <div v-if="duplicateDiff.length" class="diff-box">
            <div class="diff-head">
              <span>字段差异对比</span>
              <el-button link size="small" @click="toggleAllDiff">{{ allDiffSelected ? '全不选' : '全选' }}</el-button>
            </div>
            <div v-for="row in duplicateDiff" :key="row.field" class="diff-row">
              <el-checkbox v-model="diffSelected[row.field]" />
              <span class="diff-label">{{ row.label }}</span>
              <span class="diff-old">{{ row.old || '空' }}</span>
              <el-icon class="diff-arrow"><Right /></el-icon>
              <span class="diff-new">{{ row.new || '空' }}</span>
            </div>
            <el-input v-model="updateReason" size="small" placeholder="变更原因(留痕,可选)" style="margin-top:8px" />
          </div>
        </template>
        <el-form label-width="90px" style="margin-top: 12px">
          <el-row :gutter="12">
            <el-col v-for="f in FIELDS" :key="f.key" :span="12">
              <el-form-item :label="f.label">
                <el-input v-model="form[f.key]"
                  :class="{ 'low-conf': parsed && parsed.source[f.key] === 'llm' }" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-form-item label="等级">
            <el-radio-group v-model="form.level">
              <el-radio-button value="L1">L1 · 5%</el-radio-button>
              <el-radio-button value="L2">L2 · 6%</el-radio-button>
              <el-radio-button value="L3">L3 · 7%</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="form.homepage_url" label="主页">
            <el-link :href="form.homepage_url" target="_blank" type="primary">↗ 打开主页人工审核</el-link>
          </el-form-item>
        </el-form>
      </template>

      <template #footer>
        <el-button @click="showPaste = false">取消</el-button>
        <el-button v-if="showUpdateButton" @click="openExisting">打开已有档案</el-button>
        <el-button v-if="showUpdateButton" type="primary" :loading="updating" @click="applyUpdate">
          更新选中字段并打开
        </el-button>
        <el-button v-else type="primary" :disabled="!canSave" @click="save">{{ saveLabel }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="importVisible" title="批量导入达人" width="720px" @closed="resetImport">
      <div class="import-actions">
        <el-button @click="downloadTemplate">下载 Excel 模板</el-button>
      </div>
      <el-upload
        drag
        accept=".xlsx"
        :auto-upload="false"
        :limit="1"
        :file-list="importFileList"
        :on-change="onImportFile"
        :on-remove="removeImportFile"
      >
        <div class="upload-text">把填写好的 .xlsx 文件拖到这里，或点击选择文件</div>
      </el-upload>
      <el-alert v-if="importResult" style="margin-top:12px" type="success" :closable="false"
        :title="`共读取 ${importResult.total} 行，成功 ${importResult.success_count} 行，失败 ${importResult.failed_count} 行`" />
      <el-table v-if="importResult?.failures?.length" :data="importResult.failures" size="small" style="margin-top:12px" max-height="260">
        <el-table-column prop="row" label="行号" width="70" />
        <el-table-column prop="nickname" label="昵称" width="120" />
        <el-table-column prop="douyin_id" label="抖音号" width="140" />
        <el-table-column prop="reason" label="失败原因" />
      </el-table>
      <template #footer>
        <el-button @click="importVisible = false">关闭</el-button>
        <el-button type="primary" :disabled="!importFile" :loading="importing" @click="doImport">开始导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { Right } from '@element-plus/icons-vue'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'
import { num } from '../utils/format'

const FIELDS = [
  { key: 'nickname', label: '昵称' },
  { key: 'douyin_id', label: '抖音号' },
  { key: 'douyin_uid', label: 'UID' },
  { key: 'homepage_url', label: '主页链接' },
  { key: 'phone', label: '手机号' },
  { key: 'cooperation_code', label: '合作码' },
  { key: 'real_name', label: '收件人' },
  { key: 'default_address', label: '收件地址' },
  { key: 'fans_count', label: '粉丝数' },
]

const DEFAULT_COLUMNS = [
  { key: 'nickname', label: '昵称', minWidth: 120 },
  { key: 'douyin_id', label: '抖音号', minWidth: 120 },
  { key: 'fans_count', label: '粉丝', width: 90 },
  { key: 'gmv_30d', label: 'GMV', width: 90 },
  { key: 'data_source', label: '数据来源', width: 120 },
  { key: 'level', label: '等级', width: 70 },
  { key: 'commission_tier', label: '佣金', width: 70 },
  { key: 'tags', label: '标签', width: 150 },
  { key: 'owner_bd_name', label: '归属商务', width: 100 },
  { key: 'round_count', label: '轮次', width: 70 },
  { key: 'updated_at', label: '更新', width: 110 },
]
const DEFAULT_COLUMN_KEYS = DEFAULT_COLUMNS.map((c) => c.key)

const MODES = [
  { label: '粘贴识别', value: 'paste' },
  { label: '手动填写', value: 'manual' },
]
const rows = ref([])
const router = useRouter()
const route = useRoute()
const total = ref(0)
const page = ref(1)
const pageSize = 50
const q = ref('')
const level = ref('')
const loading = ref(false)
const user = JSON.parse(localStorage.getItem('user') || '{}')
const isAdmin = user.role === 'admin'
const SCOPE_OPTIONS = [{ label: '我的达人', value: 'mine' }, { label: '全部达人', value: 'all' }]
const scopeMode = ref('mine')
const connectVisible = ref(false)
const connectTarget = ref(null)
const connectReason = ref('')
const connecting = ref(false)
// 从看板"按商务"下钻时带入的归属商务过滤
const ownerBdId = ref(route.query.owner_bd_id ? Number(route.query.owner_bd_id) : null)
const showPaste = ref(false)
const mode = ref('paste')
const pasteText = ref('')
const parsing = ref(false)
const parsed = ref(null)
const form = reactive({ level: 'L1' })
const importVisible = ref(false)
const importFile = ref(null)
const importFileList = ref([])
const importing = ref(false)
const importResult = ref(null)
const columnOrder = ref([...DEFAULT_COLUMN_KEYS])
const dragColumnIdx = ref(null)
const orderedColumns = computed(() => {
  const known = new Set(DEFAULT_COLUMN_KEYS)
  const keys = [
    ...columnOrder.value.filter((key) => known.has(key)),
    ...DEFAULT_COLUMN_KEYS.filter((key) => !columnOrder.value.includes(key)),
  ]
  return keys.map((key) => DEFAULT_COLUMNS.find((col) => col.key === key))
})

const duplicate = computed(() => parsed.value?.duplicate || null)
const duplicateOwnedByOther = computed(() => Boolean(duplicate.value?.owned_by_other_bd))
const duplicateInScope = computed(() => Boolean(duplicate.value?.id && !duplicateOwnedByOther.value))
const duplicateDiff = computed(() => duplicate.value?.diff || [])
const showUpdateButton = computed(() => duplicateInScope.value)
const saveLabel = computed(() => (duplicateInScope.value ? '打开已有档案' : '保存建档'))
const canSave = computed(() => {
  if (duplicateOwnedByOther.value) return false
  if (duplicateInScope.value) return true
  return Boolean(form.nickname && form.douyin_id && (mode.value === 'manual' || parsed.value))
})

// 重复确认:每个差异字段是否勾选更新(默认全选)
const diffSelected = reactive({})
const updateReason = ref('')
const updating = ref(false)
const allDiffSelected = computed(() => duplicateDiff.value.length > 0
  && duplicateDiff.value.every((r) => diffSelected[r.field]))
watch(duplicateDiff, (rows) => {
  Object.keys(diffSelected).forEach((k) => delete diffSelected[k])
  rows.forEach((r) => { diffSelected[r.field] = true })
  updateReason.value = ''
})
function toggleAllDiff() {
  const to = !allDiffSelected.value
  duplicateDiff.value.forEach((r) => { diffSelected[r.field] = to })
}
function openExisting() {
  showPaste.value = false
  router.push(`/influencers/${duplicate.value.id}`)
}
async function applyUpdate() {
  const fields = {}
  duplicateDiff.value.forEach((r) => {
    if (diffSelected[r.field]) fields[r.field] = parsed.value.fields[r.field]
  })
  if (!Object.keys(fields).length) { openExisting(); return }
  updating.value = true
  try {
    const r = await api.post(`/api/influencers/${duplicate.value.id}/apply-update`,
      { fields, reason: updateReason.value || undefined })
    ElMessage.success(`已更新 ${r.changed} 个字段`)
    showPaste.value = false
    router.push(`/influencers/${duplicate.value.id}`)
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '更新失败')
  } finally {
    updating.value = false
  }
}

function resetDialog() {
  mode.value = 'paste'
  pasteText.value = ''
  parsed.value = null
  Object.keys(form).forEach((k) => delete form[k])
  form.level = 'L1'
}

async function load() {
  loading.value = true
  try {
    const data = await api.get('/api/influencers', {
      params: {
        q: q.value || undefined, level: level.value || undefined,
        owner_bd_id: ownerBdId.value || undefined,
        scope_mode: isAdmin ? undefined : scopeMode.value,
        page: page.value, page_size: pageSize,
      },
    })
    rows.value = data.items
    total.value = data.total
  } finally {
    loading.value = false
  }
}
const ownerBdName = computed(() => rows.value.find((r) => r.owner_bd_id === ownerBdId.value)?.owner_bd_name)
function clearOwnerFilter() {
  ownerBdId.value = null
  router.replace({ path: '/influencers' })
  page.value = 1
  load()
}

async function loadColumnOrder() {
  try {
    const r = await api.get('/api/preferences/influencer_columns')
    const saved = r.value?.columns
    if (Array.isArray(saved) && saved.length) {
      columnOrder.value = [
        ...saved.filter((key) => DEFAULT_COLUMN_KEYS.includes(key)),
        ...DEFAULT_COLUMN_KEYS.filter((key) => !saved.includes(key)),
      ]
    }
  } catch (e) { /* 偏好失败不影响达人库主流程 */ }
}

async function saveColumnOrder() {
  try {
    await api.put('/api/preferences/influencer_columns', { value: { columns: columnOrder.value } })
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '列顺序保存失败')
  }
}

function dropColumn(targetIdx) {
  const from = dragColumnIdx.value
  dragColumnIdx.value = null
  if (from == null || from === targetIdx) return
  const next = [...orderedColumns.value.map((col) => col.key)]
  const [moved] = next.splice(from, 1)
  next.splice(targetIdx, 0, moved)
  columnOrder.value = next
  saveColumnOrder()
}

function resetColumnOrder() {
  columnOrder.value = [...DEFAULT_COLUMN_KEYS]
  saveColumnOrder()
}

async function doParse() {
  parsing.value = true
  try {
    parsed.value = await api.post('/api/influencers/parse', { text: pasteText.value })
    Object.assign(form, parsed.value.fields, { raw_intro: pasteText.value })
  } finally {
    parsing.value = false
  }
}

async function save() {
  if (duplicateInScope.value) {
    showPaste.value = false
    router.push(`/influencers/${duplicate.value.id}`)
    return
  }
  try {
    await api.post('/api/influencers', { ...form })
    ElMessage.success('已建档并开启第1轮合作')
    showPaste.value = false
    load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '保存失败')
  }
}

function fmtDate(value) {
  if (!value) return '—'
  return value.slice(0, 10)
}

function openConnect(row) {
  connectTarget.value = row
  connectReason.value = ''
  connectVisible.value = true
}
async function submitConnect() {
  connecting.value = true
  try {
    await api.post('/api/connection-requests',
      { influencer_id: connectTarget.value.id, reason: connectReason.value || undefined })
    ElMessage.success('建联申请已提交,等待管理员审批')
    connectVisible.value = false
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '申请失败')
  } finally {
    connecting.value = false
  }
}

function onImportFile(uploadFile) {
  importFile.value = uploadFile.raw
  importFileList.value = [uploadFile]
  importResult.value = null
}
function removeImportFile() {
  importFile.value = null
  importFileList.value = []
}
function resetImport() {
  importFile.value = null
  importFileList.value = []
  importResult.value = null
  importing.value = false
}
async function downloadTemplate() {
  const blob = await api.get('/api/influencers/import-template', { responseType: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = '达人导入模板.xlsx'
  a.click()
  URL.revokeObjectURL(url)
}
async function doImport() {
  if (!importFile.value) return ElMessage.warning('请先选择 Excel 文件')
  importing.value = true
  try {
    const fd = new FormData()
    fd.append('file', importFile.value)
    importResult.value = await api.post('/api/influencers/import', fd)
    ElMessage.success(`导入完成:成功 ${importResult.value.success_count} 行,失败 ${importResult.value.failed_count} 行`)
    await load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '导入失败')
  } finally {
    importing.value = false
  }
}

onMounted(() => {
  loadColumnOrder()
  load()
})
</script>

<style scoped>
.toolbar { display: flex; gap: 12px; margin-bottom: 16px; }
.column-sort { display: flex; flex-direction: column; gap: 6px; }
.column-sort-row { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border: 1px solid #ebeef5; border-radius: 6px; cursor: grab; background: #fff; }
.column-sort-row:active { cursor: grabbing; }
.drag-handle { color: #a8abb2; font-size: 13px; }
.column-sort-actions { display: flex; justify-content: flex-end; padding-top: 4px; }
.low-conf :deep(.el-input__wrapper) { background: #fdf6ec; } /* LLM 低置信度标黄待确认 */
.import-actions { display: flex; justify-content: flex-end; margin-bottom: 12px; }
.upload-text { color: #606266; font-size: 13px; }
.diff-box { border: 1px solid #f0d8a8; background: #fffdf6; border-radius: 8px; padding: 10px 12px; margin: 0 0 12px; }
.diff-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: #8a6d3b; margin-bottom: 6px; }
.diff-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 13px; }
.diff-label { min-width: 64px; color: #606266; }
.diff-old { color: #b3bac9; text-decoration: line-through; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.diff-arrow { color: #e6a23c; }
.diff-new { color: #1f2637; font-weight: 500; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
