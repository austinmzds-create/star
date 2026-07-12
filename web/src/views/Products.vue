<template>
  <div>
    <div class="page-toolbar">
      <el-button type="primary" @click="openCreate">+ 新建产品</el-button>
    </div>

    <el-table :data="rows" @row-click="open" style="cursor: pointer">
      <el-table-column label="产品" min-width="260">
        <template #default="{ row }">
          <div class="prod-cell">
            <el-image v-if="row.product_image" :src="row.product_image" fit="cover" class="prod-img" />
            <div v-else class="prod-img placeholder"></div>
            <span class="prod-name">{{ row.name }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="shop_name" label="店铺" width="150" />
      <el-table-column prop="price_text" label="价格" width="90" />
      <el-table-column label="默认佣金" width="90">
        <template #default="{ row }">{{ row.default_commission != null ? row.default_commission + '%' : '—' }}</template>
      </el-table-column>
      <el-table-column label="素材" width="70">
        <template #default="{ row }">{{ row.material_count }}</template>
      </el-table-column>
      <el-table-column label="授权达人" width="90">
        <template #default="{ row }">{{ row.granted_count }}</template>
      </el-table-column>
      <el-table-column label="状态" width="80">
        <template #default="{ row }">
          <el-tag size="small" :type="row.status === 'on' ? 'success' : 'info'">{{ row.status === 'on' ? '上架' : '下架' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建" width="140">
        <template #default="{ row }">{{ ft(row.created_at) }}</template>
      </el-table-column>
    </el-table>

    <!-- 新建产品 -->
    <el-dialog v-model="createVisible" title="新建产品" width="520px">
      <el-form label-width="90px">
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="商品图">
          <MultiUpload v-model="form.product_images" :max="6" prefix="product" />
          <span class="muted" style="font-size:12px">首张作封面,可传多张</span>
        </el-form-item>
        <el-form-item label="店铺"><el-input v-model="form.shop_name" /></el-form-item>
        <el-form-item label="价格"><el-input v-model="form.price_text" placeholder="如 30起" /></el-form-item>
        <el-form-item label="抖店链接"><el-input v-model="form.link" /></el-form-item>
        <el-form-item label="默认佣金%"><el-input-number v-model="form.default_commission" :min="0" :max="50" :step="0.5" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" @click="saveCreate">保存</el-button>
      </template>
    </el-dialog>

    <!-- 编辑素材 -->
    <el-dialog v-model="editMatVisible" title="编辑素材" width="480px" append-to-body>
      <el-form label-width="80px">
        <el-form-item label="标题"><el-input v-model="matEdit.title" /></el-form-item>
        <el-form-item v-if="matEdit.type === 'copy'" label="文案"><el-input v-model="matEdit.parsed_text" type="textarea" :rows="3" /></el-form-item>
        <el-form-item v-if="matEdit.type === 'video_hot'" label="爆款链接"><el-input v-model="matEdit.source_link" /></el-form-item>
        <el-form-item v-if="matEdit.type === 'pdf'" label="报告ID"><el-input v-model="matEdit.report_id" /></el-form-item>
        <el-form-item label="允许下载"><el-switch v-model="matEdit.downloadable" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editMatVisible = false">取消</el-button>
        <el-button type="primary" @click="saveMat">保存</el-button>
      </template>
    </el-dialog>

    <!-- 产品详情抽屉 -->
    <el-drawer v-model="drawer" :title="detail?.name" size="760px">
      <template v-if="detail">
        <!-- 商品卡 -->
        <div class="prod-head">
          <el-image v-if="detail.product_image" :src="detail.product_image" fit="cover" class="head-img" />
          <div v-else class="head-img placeholder"></div>
          <div class="head-info">
            <div class="head-name">{{ detail.name }}</div>
            <div class="muted" style="font-size:13px">{{ detail.shop_name }} · {{ detail.price_text }} · 默认佣金 {{ detail.default_commission ?? '—' }}%</div>
            <CopyText v-if="detail.link" :value="detail.link" style="margin-top:6px" />
          </div>
          <div style="display:flex; flex-direction:column; gap:6px">
            <el-button size="small" :type="detail.status === 'on' ? 'info' : 'success'" @click="toggle">
              {{ detail.status === 'on' ? '下架' : '上架' }}
            </el-button>
            <el-button size="small" type="danger" plain @click="removeProduct">删除</el-button>
          </div>
        </div>

        <el-tabs v-model="dtab" style="margin-top:8px">
          <!-- 素材 -->
          <el-tab-pane label="素材" name="materials">
            <el-tabs v-model="mtype" tab-position="left" class="mat-tabs">
              <el-tab-pane v-for="t in MAT_TYPES" :key="t.v" :label="`${t.l} ${countOf(t.v)}`" :name="t.v">
                <!-- 添加区 -->
                <div class="mat-add">
                  <template v-if="t.v === 'video_hot'">
                    <el-input v-model="matForm.source_link" placeholder="爆款抖音链接" style="flex:1" />
                    <el-input v-model="matForm.title" placeholder="标题(可选)" style="width:160px" />
                  </template>
                  <template v-else-if="t.v === 'copy'">
                    <el-input v-model="matForm.parsed_text" type="textarea" :rows="2" placeholder="文案内容" style="flex:1" />
                  </template>
                  <template v-else>
                    <el-upload :show-file-list="false" :before-upload="() => true" :http-request="uploadMat">
                      <el-button size="small">上传文件</el-button>
                    </el-upload>
                    <el-input v-model="matForm.title" placeholder="标题(可选)" style="width:160px" />
                    <el-input v-if="t.v === 'pdf'" v-model="matForm.report_id" placeholder="报告ID" style="width:120px" />
                    <span v-if="matForm.oss_key" class="muted" style="font-size:12px">已上传 ✓</span>
                  </template>
                  <el-button type="primary" size="small" @click="addMaterial">添加</el-button>
                </div>
                <!-- 列表 -->
                <div v-for="m in materialsOf(mtype)" :key="m.id" class="mat-row">
                  <el-link v-if="m.url" :href="m.url" target="_blank" type="primary">{{ m.title || '查看文件' }}</el-link>
                  <el-link v-else-if="m.source_link" :href="m.source_link" target="_blank">{{ m.title || m.source_link }}</el-link>
                  <span v-else>{{ m.title || m.parsed_text }}</span>
                  <span v-if="m.report_id" class="muted">报告ID: {{ m.report_id }}</span>
                  <div class="mat-ops">
                    <el-icon class="op" @click="openEditMat(m)"><Edit /></el-icon>
                    <el-icon class="del" @click="delMaterial(m)"><Delete /></el-icon>
                  </div>
                </div>
                <el-empty v-if="!materialsOf(mtype).length" :description="`暂无${MAT_TYPES.find(x=>x.v===mtype).l}`" :image-size="50" />
              </el-tab-pane>
            </el-tabs>
          </el-tab-pane>

          <!-- 商品信息 -->
          <el-tab-pane label="商品信息" name="info">
            <el-form label-width="88px" style="max-width:560px">
              <el-form-item label="名称"><el-input v-model="detail.name" /></el-form-item>
              <el-form-item label="商品图">
                <MultiUpload v-model="detail.product_images_keys" :max="6" prefix="product"
                  :initial-previews="imgPreviewMap" />
                <span class="muted" style="font-size:12px">首张作封面</span>
              </el-form-item>
              <el-form-item label="抖店链接"><el-input v-model="detail.link" /></el-form-item>
              <el-form-item label="默认佣金%"><el-input-number v-model="detail.default_commission" :min="0" :max="50" :step="0.5" /></el-form-item>
              <el-form-item label="卖点"><el-input v-model="detail.selling_points" type="textarea" :rows="2" /></el-form-item>
              <el-form-item label="拍摄要求"><el-input v-model="detail.shooting_notes" type="textarea" :rows="2" /></el-form-item>
              <el-form-item label="寄样备注"><el-input v-model="detail.sample_remark" type="textarea" :rows="2" /></el-form-item>
              <el-form-item label="带货备注"><el-input v-model="detail.promo_remark" type="textarea" :rows="2" placeholder="如:孩子太小的话就不要出镜,打码也不行" /></el-form-item>
              <el-form-item label="一键审核">
                <el-segmented v-model="detail.auto_audit_type" :options="AUDIT_TYPES" />
              </el-form-item>
              <el-form-item label="允许带货">
                <el-segmented v-model="detail.allow_promotion" :options="[{label:'允许',value:true},{label:'不允许',value:false}]" />
              </el-form-item>
              <el-button type="primary" @click="saveInfo">保存</el-button>
            </el-form>
          </el-tab-pane>

          <!-- 授权达人 -->
          <el-tab-pane label="授权达人" name="grants">
            <div class="mat-add">
              <InfluencerSelect v-model="grantId" style="flex:1" />
              <el-button type="primary" size="small" :disabled="!grantId" @click="addGrant">开放</el-button>
            </div>
            <el-table :data="grants" size="small">
              <el-table-column prop="nickname" label="达人" />
              <el-table-column prop="douyin_id" label="抖音号" />
              <el-table-column label="授权时间" width="150"><template #default="{ row }">{{ ft(row.granted_at) }}</template></el-table-column>
              <el-table-column width="70"><template #default="{ row }">
                <el-button size="small" text type="danger" @click="removeGrant(row)">移除</el-button>
              </template></el-table-column>
            </el-table>
            <el-empty v-if="!grants.length" description="尚未授权任何达人" :image-size="50" />
          </el-tab-pane>

          <!-- 动态 -->
          <el-tab-pane label="动态" name="activity">
            <div class="section-title">寄样 {{ act.samples.length }}</div>
            <div v-for="s in act.samples" :key="'s'+s.id" class="mat-row">
              <span>{{ s.nickname }}</span>
              <el-tag size="small" :type="sampleTag(s.status).type">{{ sampleTag(s.status).label }}</el-tag>
              <span class="muted">{{ ft(s.created_at) }}</span>
            </div>
            <el-empty v-if="!act.samples.length" description="暂无寄样" :image-size="40" />
            <div class="section-title" style="margin-top:16px">视频 {{ act.videos.length }}</div>
            <div v-for="v in act.videos" :key="'v'+v.id" class="mat-row">
              <span>{{ v.nickname }}</span>
              <el-tag size="small" :type="videoTag(v.status).type">{{ videoTag(v.status).label }}</el-tag>
              <span class="muted">{{ ft(v.created_at) }}</span>
            </div>
            <el-empty v-if="!act.videos.length" description="暂无视频" :image-size="40" />
          </el-tab-pane>
        </el-tabs>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { Delete, Edit } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, onMounted, reactive, ref } from 'vue'
import api from '../api'
import CopyText from '../components/CopyText.vue'
import InfluencerSelect from '../components/InfluencerSelect.vue'
import MultiUpload from '../components/MultiUpload.vue'
import { formatTime as ft } from '../utils/time'
import { SAMPLE_STATUS, VIDEO_STATUS, tag } from '../utils/status'

const MAT_TYPES = [
  { v: 'video_ai', l: 'AI视频' }, { v: 'video_hot', l: '爆款参考' },
  { v: 'video_output', l: '达人成片' }, { v: 'image', l: '图片' },
  { v: 'pdf', l: '质检报告' }, { v: 'copy', l: '文案' },
]
const AUDIT_TYPES = [
  { label: '不需审核', value: 'none' }, { label: '必须审核', value: 'must' },
  { label: '18:30自动通过', value: 'auto1830' },
]

const rows = ref([])
const createVisible = ref(false)
const form = reactive({})
const drawer = ref(false)
const detail = ref(null)
const dtab = ref('materials')
const mtype = ref('video_ai')
const matForm = reactive({})
const grants = ref([])
const grantId = ref(null)
const act = ref({ samples: [], videos: [] })

const sampleTag = (s) => tag(SAMPLE_STATUS, s)
const videoTag = (s) => tag(VIDEO_STATUS, s)
const materialsOf = (t) => (detail.value?.materials || []).filter((m) => m.type === t)
const countOf = (t) => materialsOf(t).length
// 旧图预览映射:{oss_key: 签名URL},供 MultiUpload 编辑时展示已存图
const imgPreviewMap = computed(() => {
  const keys = detail.value?.product_images_keys || []
  const urls = detail.value?.product_images || []
  return Object.fromEntries(keys.map((k, i) => [k, urls[i]]))
})

async function load() { rows.value = await api.get('/api/products') }

function openCreate() { Object.keys(form).forEach((k) => delete form[k]); form.default_commission = 5; createVisible.value = true }
async function saveCreate() {
  if (!form.name) return ElMessage.warning('请填写名称')
  await api.post('/api/products', { ...form })
  ElMessage.success('已创建'); createVisible.value = false; load()
}

async function open(row) {
  detail.value = await api.get(`/api/products/${row.id}`)
  drawer.value = true; dtab.value = 'materials'; mtype.value = 'video_ai'
  Object.keys(matForm).forEach((k) => delete matForm[k])
  grants.value = await api.get(`/api/products/${row.id}/grants`)
  act.value = await api.get(`/api/products/${row.id}/activity`)
}
async function refreshDetail() { detail.value = await api.get(`/api/products/${detail.value.id}`) }

async function toggle() {
  const r = await api.post(`/api/products/${detail.value.id}/toggle`)
  detail.value.status = r.status; load()
}

async function uploadMat({ file }) {
  const fd = new FormData(); fd.append('file', file)
  const r = await api.post('/api/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  matForm.oss_key = r.key; ElMessage.success('文件已上传')
}
async function addMaterial() {
  const body = { type: mtype.value, title: matForm.title }
  if (mtype.value === 'video_hot') body.source_link = matForm.source_link
  else if (mtype.value === 'copy') body.parsed_text = matForm.parsed_text
  else { body.oss_key = matForm.oss_key; if (mtype.value === 'pdf') body.report_id = matForm.report_id }
  if (!body.oss_key && !body.source_link && !body.parsed_text) return ElMessage.warning('请填写内容或上传文件')
  await api.post(`/api/products/${detail.value.id}/materials`, body)
  ElMessage.success('已添加'); Object.keys(matForm).forEach((k) => delete matForm[k]); refreshDetail(); load()
}
async function delMaterial(m) {
  await ElMessageBox.confirm('确认删除该素材?', '提示', { type: 'warning' })
  await api.delete(`/api/products/materials/${m.id}`); refreshDetail(); load()
}

const editMatVisible = ref(false)
const matEdit = reactive({})
function openEditMat(m) {
  Object.assign(matEdit, { id: m.id, type: m.type, title: m.title, parsed_text: m.parsed_text,
    source_link: m.source_link, report_id: m.report_id, downloadable: m.downloadable })
  editMatVisible.value = true
}
async function saveMat() {
  await api.put(`/api/products/materials/${matEdit.id}`, {
    title: matEdit.title, parsed_text: matEdit.parsed_text, source_link: matEdit.source_link,
    report_id: matEdit.report_id, downloadable: matEdit.downloadable,
  })
  editMatVisible.value = false; ElMessage.success('已保存'); refreshDetail()
}
async function removeProduct() {
  await ElMessageBox.confirm('确认删除该产品?(仅无寄样/视频/出单记录时可删)', '删除', { type: 'warning' })
  try {
    await api.delete(`/api/products/${detail.value.id}`)
    ElMessage.success('已删除'); drawer.value = false; load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '删除失败')
  }
}

async function saveInfo() {
  await api.put(`/api/products/${detail.value.id}`, {
    name: detail.value.name, link: detail.value.link,
    product_images: detail.value.product_images_keys || [],
    default_commission: detail.value.default_commission,
    selling_points: detail.value.selling_points, shooting_notes: detail.value.shooting_notes,
    sample_remark: detail.value.sample_remark, promo_remark: detail.value.promo_remark,
    auto_audit_type: detail.value.auto_audit_type, allow_promotion: detail.value.allow_promotion,
  })
  ElMessage.success('已保存'); load()
}

async function addGrant() {
  await api.post(`/api/products/${detail.value.id}/grant`, { influencer_id: grantId.value })
  ElMessage.success('已开放'); grantId.value = null
  grants.value = await api.get(`/api/products/${detail.value.id}/grants`); load()
}
async function removeGrant(row) {
  await api.delete(`/api/products/${detail.value.id}/grant/${row.influencer_id}`)
  grants.value = await api.get(`/api/products/${detail.value.id}/grants`); load()
}

onMounted(load)
</script>

<style scoped>
.prod-cell { display: flex; align-items: center; gap: 10px; }
.prod-img { width: 40px; height: 40px; border-radius: 8px; flex-shrink: 0; }
.prod-img.placeholder { background: #eef0f5; }
.prod-name { font-weight: 500; }
.prod-head { display: flex; gap: 14px; align-items: flex-start; padding-bottom: 16px; border-bottom: 1px solid #f0f1f5; }
.head-img { width: 64px; height: 64px; border-radius: 10px; }
.head-img.placeholder { background: #eef0f5; }
.head-info { flex: 1; }
.head-name { font-weight: 600; font-size: 15px; }
.mat-tabs { min-height: 220px; }
.mat-add { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; flex-wrap: wrap; }
.mat-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f4f5f8; }
.mat-ops { margin-left: auto; display: flex; gap: 10px; }
.mat-row .op, .mat-row .del { color: #c0c4cc; cursor: pointer; }
.mat-row .op:hover { color: #6b5cf6; }
.mat-row .del:hover { color: #f56c6c; }
</style>
