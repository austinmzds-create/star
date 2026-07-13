<template>
  <div v-if="d">
    <el-page-header :content="d.nickname" @back="$router.back()">
      <template #extra>
        <div v-if="isStaff" style="display:flex; gap:8px; align-items:center">
          <el-tag v-if="d.archived" type="info" size="small">已停用</el-tag>
          <el-button size="small" @click="openEdit">编辑档案</el-button>
          <el-button size="small" :type="d.archived ? 'success' : 'warning'" @click="toggleArchive">
            {{ d.archived ? '启用' : '停用' }}
          </el-button>
          <el-button size="small" type="danger" plain @click="removeInfluencer">删除</el-button>
        </div>
      </template>
    </el-page-header>

    <!-- 编辑核心档案 -->
    <el-dialog v-model="editVisible" title="编辑档案" width="560px">
      <el-form label-width="80px">
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="昵称"><el-input v-model="editForm.nickname" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="抖音号"><el-input v-model="editForm.douyin_id" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="UID"><el-input v-model="editForm.douyin_uid" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="合作码"><el-input v-model="editForm.cooperation_code" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="收件人"><el-input v-model="editForm.real_name" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="手机"><el-input v-model="editForm.phone" maxlength="11" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="粉丝数"><el-input-number v-model="editForm.fans_count" :min="0" :controls="false" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="主页"><el-input v-model="editForm.homepage_url" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="数据来源"><el-input v-model="editForm.data_source" placeholder="官方后台/蝉妈妈/导入" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="收件地址"><el-input v-model="editForm.default_address" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="品类"><el-input v-model="categoryText" placeholder="逗号分隔,如 母婴,儿童" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="来源备注"><el-input v-model="editForm.source_note" type="textarea" :rows="3" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 速览 -->
    <div class="stats">
      <div class="stat"><div class="v">{{ d.level }}</div><div class="k">等级</div></div>
      <div class="stat"><div class="v">{{ d.commission_tier }}%</div><div class="k">佣金</div></div>
      <div class="stat"><div class="v">{{ d.cooperations.length }}</div><div class="k">合作轮次</div></div>
      <div class="stat"><div class="v">{{ d.fans_count ?? '—' }}</div><div class="k">粉丝</div></div>
      <div class="stat"><div class="v">{{ d.gmv_30d ?? '—' }}</div><div class="k">近30天GMV</div></div>
      <div class="stat"><div class="v">{{ d.promo_mode === 'self' ? '达人自投' : '商家投流' }}</div><div class="k">投流方式</div></div>
    </div>

    <el-row :gutter="16">
      <!-- 左:档案 + 定级 + 标签 -->
      <el-col :span="10">
        <el-card header="档案">
          <div class="kv-grid">
            <div class="kv"><span class="k">抖音号</span><CopyText :value="d.douyin_id" /></div>
            <div class="kv"><span class="k">UID</span><CopyText :value="d.douyin_uid" /></div>
            <div class="kv"><span class="k">合作码</span><CopyText :value="d.cooperation_code" /></div>
            <div class="kv"><span class="k">手机</span><CopyText :value="d.phone" /></div>
            <div class="kv"><span class="k">收件人</span><span>{{ d.real_name || '—' }}</span></div>
            <div class="kv"><span class="k">拍摄</span><span>{{ d.shoot_type || '未知' }}</span></div>
            <div class="kv"><span class="k">品类</span><span>{{ (d.category_tags || []).join(' / ') || '—' }}</span></div>
            <div class="kv"><span class="k">来源</span><span>{{ d.data_source || (d.source === 'import' ? '导入' : d.source) || '—' }}</span></div>
            <div class="kv"><span class="k">主页</span>
              <el-link v-if="d.homepage_url" :href="d.homepage_url" target="_blank" type="primary">打开</el-link>
              <span v-else>{{ d.homepage_raw || '—' }}</span>
            </div>
            <div class="kv full"><span class="k">收件地址</span><span>{{ d.default_address || '—' }}</span></div>
          </div>

          <el-divider>定级与待遇 <span class="muted" style="font-size:12px">(调整留痕,历史不回溯)</span></el-divider>
          <el-form label-width="72px">
            <el-form-item label="等级">
              <el-radio-group v-model="edit.level">
                <el-radio-button value="L1">L1</el-radio-button>
                <el-radio-button value="L2">L2</el-radio-button>
                <el-radio-button value="L3">L3</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="佣金%"><el-input-number v-model="edit.commission_tier" :min="0" :max="50" :step="0.5" /></el-form-item>
            <el-form-item label="投流">
              <el-segmented v-model="edit.promo_mode" :options="[{label:'商家投流',value:'merchant'},{label:'达人自投',value:'self'}]" />
            </el-form-item>
            <el-form-item v-if="isStaff" label="归属商务">
              <el-select v-model="edit.owner_bd_id" style="width: 160px" placeholder="转移给">
                <el-option v-for="b in bds" :key="b.id" :label="b.display_name" :value="b.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="原因"><el-input v-model="edit.reason" placeholder="调整原因(留痕)" /></el-form-item>
            <el-button type="primary" @click="save">保存</el-button>
          </el-form>

          <el-divider>标签</el-divider>
          <el-tag v-for="t in tags" :key="t" closable style="margin: 0 6px 6px 0" @close="removeTag(t)">{{ t }}</el-tag>
          <el-input v-if="tagInput !== null" v-model="tagInput" size="small" style="width: 120px"
            @keyup.enter="addTag" @blur="addTag" />
          <el-button v-else size="small" @click="tagInput = ''">+ 标签</el-button>
        </el-card>

        <el-card v-if="d.raw_intro" header="原始资料" style="margin-top: 16px">
          <pre class="raw">{{ d.raw_intro }}</pre>
        </el-card>

        <el-card v-if="d.source_note" header="来源备注" style="margin-top: 16px">
          <pre class="raw">{{ d.source_note }}</pre>
        </el-card>

        <el-card v-if="isAdmin" header="管理员备注" style="margin-top: 16px">
          <el-input v-model="adminNote" type="textarea" :rows="4" maxlength="1000"
            show-word-limit placeholder="仅管理员可见" />
          <div class="note-actions">
            <el-button size="small" type="primary" :loading="savingAdminNote" @click="saveAdminNote">保存备注</el-button>
          </div>
        </el-card>
      </el-col>

      <!-- 右:动态(寄样/视频/投流/合作/留痕) -->
      <el-col :span="14">
        <el-card>
          <el-tabs v-model="tab">
            <el-tab-pane name="samples">
              <template #label>
                <span class="tab-label-badge">
                  寄样 {{ act.samples.length }}
                  <el-badge v-if="sampleAttention" :value="sampleAttention" type="danger" />
                </span>
              </template>
              <div v-if="isStaff" class="tab-toolbar">
                <el-button size="small" type="primary" @click="openQuick('sample')">+ 新建寄样</el-button>
              </div>
              <el-empty v-if="!act.samples.length" description="暂无寄样" :image-size="60" />
              <div v-for="s in act.samples" :key="s.id" class="row-card">
                <div class="rc-main">
                  <router-link :to="{ path: '/products', query: { open: s.product_id } }" class="rc-title link">{{ s.product_name }}</router-link>
                  <el-tag size="small" :type="sampleTag(s.status).type">{{ sampleTag(s.status).label }}</el-tag>
                  <div style="margin-left:auto; display:flex; gap:4px">
                    <el-button v-if="isStaff && s.tracking_no" size="small" link
                      :loading="trackingId === s.id" @click="refreshTrack(s)">刷新物流</el-button>
                    <el-button v-if="isStaff && (s.status === 'pending' || s.status === 'rejected')"
                      size="small" link type="danger" @click="delSample(s)">删除</el-button>
                  </div>
                </div>
                <div class="rc-sub muted">
                  <span v-if="s.tracking_no"><CopyText :value="`${s.courier_company} ${s.tracking_no}`" /></span>
                  <span v-if="s.logistics_status?.status">· {{ logi(s.logistics_status.status) }}</span>
                  <span v-if="s.signed_at">· 签收 {{ ft(s.signed_at) }}</span>
                  <span v-if="s.reject_reason">· {{ s.reject_reason }}</span>
                  <span>· {{ ft(s.created_at) }}</span>
                </div>
                <!-- 物流轨迹:最新一条直接显示,可展开全部 -->
                <div v-if="lastEvent(s)" class="logi-latest">
                  <el-icon><Van /></el-icon>
                  <span class="ctx">{{ lastEvent(s).context }}</span>
                  <span class="tm">{{ lastEvent(s).ftime || lastEvent(s).time }}</span>
                  <el-button v-if="events(s).length > 1" size="small" text
                    @click="expandedSample = expandedSample === s.id ? null : s.id">
                    {{ expandedSample === s.id ? '收起' : `全部${events(s).length}条` }}
                  </el-button>
                </div>
                <el-timeline v-if="expandedSample === s.id" class="logi-timeline">
                  <el-timeline-item v-for="(e, i) in events(s)" :key="i"
                    :timestamp="e.ftime || e.time" :type="i === 0 ? 'primary' : ''" size="small">
                    {{ e.context }}
                  </el-timeline-item>
                </el-timeline>
                <div v-else-if="s.tracking_no && !lastEvent(s)" class="logi-empty muted">
                  {{ logisticsMessage(s) }}
                </div>
              </div>
            </el-tab-pane>

            <el-tab-pane name="videos">
              <template #label>
                <span class="tab-label-badge">
                  视频 {{ act.videos.length }}
                  <el-badge v-if="videoAttention" :value="videoAttention" type="danger" />
                </span>
              </template>
              <div v-if="isStaff" class="tab-toolbar">
                <el-button size="small" type="primary" @click="openQuick('video')">+ 登记视频</el-button>
              </div>
              <el-empty v-if="!act.videos.length" description="暂无视频" :image-size="60" />
              <div v-for="v in act.videos" :key="v.id" class="row-card">
                <div class="rc-main">
                  <router-link :to="{ path: '/products', query: { open: v.product_id } }" class="rc-title link">{{ v.product_name }}</router-link>
                  <el-tag size="small" :type="videoTag(v.status).type">{{ videoTag(v.status).label }}</el-tag>
                  <el-link v-if="v.dy_url" :href="v.dy_url" target="_blank" type="primary" style="margin-left:auto">查看</el-link>
                  <el-button v-if="isStaff" size="small" link type="danger"
                    :style="v.dy_url ? '' : 'margin-left:auto'" @click="delVideo(v)">删除</el-button>
                </div>
                <div class="rc-sub muted">{{ ft(v.created_at) }}</div>
              </div>
            </el-tab-pane>

            <el-tab-pane name="promotions">
              <template #label>
                <span class="tab-label-badge">
                  投流 {{ act.promotions.length }}
                  <el-badge v-if="promoAttention" :value="promoAttention" type="danger" />
                </span>
              </template>
              <el-empty v-if="!act.promotions.length" description="暂无投流" :image-size="60" />
              <div v-for="p in act.promotions" :key="p.id" class="row-card">
                <div class="rc-main">
                  <el-tag size="small" :type="promoTag(p.auth_status).type">{{ promoTag(p.auth_status).label }}</el-tag>
                  <span class="muted">{{ p.mode_snapshot === 'self' ? '达人自投' : '商家投流' }}</span>
                  <span v-if="p.fail_reason" class="muted">· {{ p.fail_reason }}</span>
                </div>
                <div class="rc-sub muted">{{ ft(p.created_at) }}</div>
              </div>
            </el-tab-pane>

            <el-tab-pane :label="`合作轮次 ${d.cooperations.length}`" name="coop">
              <el-timeline>
                <el-timeline-item v-for="c in d.cooperations" :key="c.id" :timestamp="ft(c.created_at)">
                  第{{ c.round_no }}轮 · {{ c.level_snapshot }} · 佣金{{ c.commission_tier_snapshot }}% · {{ c.status }}
                </el-timeline-item>
              </el-timeline>
            </el-tab-pane>

            <el-tab-pane :label="`变更记录 ${d.change_logs.length}`" name="logs">
              <el-empty v-if="!d.change_logs.length" description="暂无变更" :image-size="60" />
              <el-timeline>
                <el-timeline-item v-for="(l, i) in d.change_logs" :key="i" :timestamp="ft(l.at)">
                  {{ l.field }}: {{ l.old }} → {{ l.new }} <span v-if="l.reason" class="muted">({{ l.reason }})</span>
                </el-timeline-item>
              </el-timeline>
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </el-col>
    </el-row>

    <!-- 快捷建单(达人已锁定为当前档案) -->
    <el-dialog v-model="quickVisible" :title="quickType === 'sample' ? '新建寄样' : '登记视频'" width="440px">
      <el-form label-width="72px">
        <el-form-item label="达人"><el-input :model-value="d.nickname" disabled /></el-form-item>
        <el-form-item label="产品">
          <el-select v-model="quickForm.product_id" placeholder="选择产品" filterable style="width:100%">
            <el-option v-for="p in products" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="quickType === 'video'" label="抖音链接">
          <el-input v-model="quickForm.dy_url" placeholder="视频链接(可选)" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="quickVisible = false">取消</el-button>
        <el-button type="primary" @click="doQuick">{{ quickType === 'sample' ? '创建' : '登记' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, onMounted, reactive, ref } from 'vue'
import { Van } from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'
import CopyText from '../components/CopyText.vue'
import { formatTime as ft } from '../utils/time'
import { LOGISTICS_STATUS, PROMO_STATUS, SAMPLE_STATUS, VIDEO_STATUS, tag } from '../utils/status'

const route = useRoute()
const router = useRouter()
const user = JSON.parse(localStorage.getItem('user') || '{}')
const isStaff = user.role === 'admin' || user.role === 'bd'
const isAdmin = user.role === 'admin'
const d = ref(null)
const act = ref({ samples: [], videos: [], promotions: [] })
const edit = reactive({})
const tags = ref([])
const tagInput = ref(null)
const bds = ref([])
const tab = ref('samples')
const products = ref([])
const quickVisible = ref(false)
const quickType = ref('sample')
const quickForm = reactive({ product_id: null, dy_url: '' })

const editVisible = ref(false)
const editForm = reactive({})
const categoryText = ref('')
const adminNote = ref('')
const savingAdminNote = ref(false)
const EDIT_FIELDS = ['nickname', 'douyin_id', 'douyin_uid', 'cooperation_code',
  'real_name', 'phone', 'fans_count', 'homepage_url', 'default_address',
  'data_source', 'source_note']

function openEdit() {
  EDIT_FIELDS.forEach((k) => { editForm[k] = d.value[k] })
  categoryText.value = (d.value.category_tags || []).join(',')
  editVisible.value = true
}
async function saveEdit() {
  const payload = {}
  EDIT_FIELDS.forEach((k) => { payload[k] = editForm[k] ?? null })
  payload.category_tags = categoryText.value
    ? categoryText.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : []
  try {
    await api.patch(`/api/influencers/${route.params.id}`, payload)
    editVisible.value = false
    ElMessage.success('已保存')
    await load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '保存失败')
  }
}
async function toggleArchive() {
  const to = !d.value.archived
  await ElMessageBox.confirm(to ? '停用后该达人默认从列表隐藏(不影响历史记录),确认?' : '确认重新启用?', '提示', { type: 'warning' })
  await api.patch(`/api/influencers/${route.params.id}`, { archived: to })
  ElMessage.success(to ? '已停用' : '已启用')
  await load()
}
async function removeInfluencer() {
  await ElMessageBox.confirm('确认删除该达人?(仅无寄样/视频记录时可删)', '删除', { type: 'warning' })
  try {
    await api.delete(`/api/influencers/${route.params.id}`)
    ElMessage.success('已删除')
    router.push('/influencers')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '删除失败')
  }
}

const sampleTag = (s) => tag(SAMPLE_STATUS, s)
const videoTag = (s) => tag(VIDEO_STATUS, s)
const promoTag = (s) => tag(PROMO_STATUS, s)
const logi = (s) => LOGISTICS_STATUS[s] || s

const expandedSample = ref(null)
const trackingId = ref(null)
const events = (s) => s.logistics_status?.events || []
const lastEvent = (s) => s.logistics_status?.last_event || events(s)[0] || null
function logisticsMessage(s) {
  const status = s.logistics_status || {}
  if (status.code === 'CONFIG_MISSING') return status.message || '物流接口未配置,请联系管理员'
  if (status.message && status.message !== 'ok') {
    return `${status.message}:暂无轨迹明细,请确认快递公司/单号/收件手机号后刷新`
  }
  return isStaff ? '暂无轨迹明细,请确认快递公司/单号/收件手机号后刷新' : '暂无轨迹明细,请稍后刷新'
}
const sampleAttention = computed(() => act.value.samples.filter((s) => (
  ['pending', 'approved'].includes(s.status) || (s.tracking_no && !lastEvent(s))
)).length)
const videoAttention = computed(() => act.value.videos.filter((v) => (
  ['submitted', 'blocked'].includes(v.status)
)).length)
const promoAttention = computed(() => act.value.promotions.filter((p) => (
  ['pending_request', 'pending_confirm', 'failed'].includes(p.auth_status)
)).length)

async function refreshTrack(s) {
  trackingId.value = s.id
  try {
    const r = await api.post(`/api/samples/${s.id}/track`)
    if (r.ok || r.events?.length) ElMessage.success('物流已更新')
    else if (r.code === 'CONFIG_MISSING') ElMessage.warning(r.message || '物流接口未配置')
    else ElMessage.info(r.message || '暂无轨迹')
    act.value = await api.get(`/api/influencers/${route.params.id}/activity`)
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '查询失败')
  } finally {
    trackingId.value = null
  }
}

async function load() {
  d.value = await api.get(`/api/influencers/${route.params.id}`)
  if (isAdmin) adminNote.value = d.value.admin_note || ''
  tags.value = d.value.tags || []
  Object.assign(edit, {
    level: d.value.level, commission_tier: d.value.commission_tier,
    promo_mode: d.value.promo_mode, owner_bd_id: d.value.owner_bd_id, reason: '',
  })
  act.value = await api.get(`/api/influencers/${route.params.id}/activity`)
}

async function save() {
  await api.patch(`/api/influencers/${route.params.id}`, edit)
  ElMessage.success('已保存')
  load()
}
async function saveAdminNote() {
  savingAdminNote.value = true
  try {
    await api.patch(`/api/influencers/${route.params.id}`, { admin_note: adminNote.value })
    ElMessage.success('备注已保存')
    await load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '保存失败')
  } finally {
    savingAdminNote.value = false
  }
}
async function saveTags() { await api.patch(`/api/influencers/${route.params.id}`, { tags: tags.value }) }
function addTag() {
  const v = (tagInput.value || '').trim()
  if (v && !tags.value.includes(v)) { tags.value.push(v); saveTags() }
  tagInput.value = null
}
function removeTag(t) { tags.value = tags.value.filter((x) => x !== t); saveTags() }

function openQuick(type) {
  quickType.value = type
  quickForm.product_id = null
  quickForm.dy_url = ''
  quickVisible.value = true
}
async function doQuick() {
  if (!quickForm.product_id) return ElMessage.warning('请选择产品')
  try {
    if (quickType.value === 'sample') {
      await api.post('/api/samples', { influencer_id: d.value.id, product_id: quickForm.product_id })
      ElMessage.success('已创建寄样单(待审批)')
    } else {
      await api.post('/api/videos', {
        influencer_id: d.value.id, product_id: quickForm.product_id,
        dy_url: quickForm.dy_url || undefined,
      })
      ElMessage.success('已登记视频(待审)')
    }
    quickVisible.value = false
    act.value = await api.get(`/api/influencers/${route.params.id}/activity`)
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '操作失败')
  }
}
async function delSample(s) {
  await ElMessageBox.confirm('确认删除该寄样单?', '提示', { type: 'warning' })
  await api.delete(`/api/samples/${s.id}`)
  ElMessage.success('已删除')
  act.value = await api.get(`/api/influencers/${route.params.id}/activity`)
}
async function delVideo(v) {
  await ElMessageBox.confirm('确认删除该视频任务?(连带其投流记录)', '提示', { type: 'warning' })
  await api.delete(`/api/videos/${v.id}`)
  ElMessage.success('已删除')
  act.value = await api.get(`/api/influencers/${route.params.id}/activity`)
}

onMounted(async () => {
  await load()
  if (isStaff) {
    try { bds.value = await api.get('/api/admin/bd-users') } catch (e) { /* ignore */ }
    try { products.value = await api.get('/api/products') } catch (e) { /* ignore */ }
  }
})
</script>

<style scoped>
.stats { display: flex; gap: 12px; margin: 16px 0; flex-wrap: wrap; }
.stat { background: #fff; border-radius: 12px; padding: 14px 22px; box-shadow: 0 2px 12px rgba(20,30,60,.04); text-align: center; min-width: 96px; }
.stat .v { font-size: 20px; font-weight: 600; color: #1f2637; }
.stat .k { font-size: 12px; color: #8a93a6; margin-top: 4px; }
.kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 20px; }
.kv-grid .full { grid-column: 1 / -1; }
.kv { display: flex; align-items: center; gap: 10px; padding: 6px 0; min-width: 0; }
.kv .k { color: #8a93a6; font-size: 13px; min-width: 48px; flex-shrink: 0; }
.note-actions { display: flex; justify-content: flex-end; margin-top: 8px; }
.tab-toolbar { display: flex; justify-content: flex-end; margin-bottom: 8px; }
.tab-label-badge { display: inline-flex; align-items: center; gap: 6px; }
.raw { white-space: pre-wrap; margin: 0; font-size: 13px; color: #5a6072; }
.row-card { padding: 10px 0; border-bottom: 1px solid #f2f3f7; }
.row-card:last-child { border-bottom: none; }
.rc-main { display: flex; align-items: center; gap: 8px; }
.rc-title { font-weight: 500; }
.link { color: #6b5cf6; text-decoration: none; }
.link:hover { text-decoration: underline; }
.rc-sub { font-size: 12px; margin-top: 4px; }
.logi-latest { display: flex; align-items: center; gap: 6px; margin-top: 6px; padding: 6px 10px;
  background: #f6f8fc; border-radius: 8px; font-size: 12px; color: #5a6072; }
.logi-latest .ctx { flex: 1; }
.logi-latest .tm { color: #98a0b0; white-space: nowrap; }
.logi-timeline { margin-top: 8px; padding-left: 4px; }
.logi-empty { font-size: 12px; margin-top: 6px; }
</style>
