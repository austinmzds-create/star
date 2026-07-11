<template>
  <div>
    <div class="toolbar">
      <el-button v-if="isAdmin" type="primary" @click="createVisible = true">+ 新建产品</el-button>
    </div>

    <el-table :data="rows" @row-click="open" style="cursor: pointer">
      <el-table-column prop="name" label="产品" />
      <el-table-column prop="shop_name" label="店铺" />
      <el-table-column prop="price_text" label="价格" width="100" />
      <el-table-column prop="material_count" label="素材数" width="90" />
      <el-table-column prop="status" label="状态" width="80" />
    </el-table>

    <!-- 新建产品 -->
    <el-dialog v-model="createVisible" title="新建产品" width="520px">
      <el-form label-width="90px">
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="店铺"><el-input v-model="form.shop_name" /></el-form-item>
        <el-form-item label="价格"><el-input v-model="form.price_text" placeholder="如 30起" /></el-form-item>
        <el-form-item label="抖店链接"><el-input v-model="form.link" /></el-form-item>
        <el-form-item label="默认佣金%"><el-input-number v-model="form.default_commission" :min="0" :max="50" :step="0.5" /></el-form-item>
        <el-form-item label="卖点"><el-input v-model="form.selling_points" type="textarea" /></el-form-item>
        <el-form-item label="拍摄要求"><el-input v-model="form.shooting_notes" type="textarea" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 产品详情抽屉:素材 + 授权 + 出单登记 -->
    <el-drawer v-model="detailVisible" :title="detail?.name" size="640px">
      <template v-if="detail">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="店铺">{{ detail.shop_name }}</el-descriptions-item>
          <el-descriptions-item label="价格">{{ detail.price_text }}</el-descriptions-item>
          <el-descriptions-item label="默认佣金">{{ detail.default_commission }}%</el-descriptions-item>
          <el-descriptions-item label="状态">{{ detail.status }}</el-descriptions-item>
        </el-descriptions>

        <el-divider content-position="left">素材({{ detail.materials.length }})</el-divider>
        <div v-if="isAdmin" class="mat-add">
          <el-select v-model="matType" style="width: 130px">
            <el-option v-for="t in MAT_TYPES" :key="t.v" :label="t.l" :value="t.v" />
          </el-select>
          <el-input v-model="matTitle" placeholder="标题" style="width: 160px" />
          <template v-if="matType === 'video_hot'">
            <el-input v-model="matLink" placeholder="爆款抖音链接(自动转存解析)" style="width: 220px" />
          </template>
          <template v-else-if="matType === 'copy'">
            <el-input v-model="matText" placeholder="文案内容" style="width: 220px" />
          </template>
          <el-upload v-else :show-file-list="false" :before-upload="beforeUpload" :http-request="uploadReq">
            <el-button size="small">上传文件</el-button>
          </el-upload>
          <el-input v-if="matType === 'pdf'" v-model="matReportId" placeholder="报告ID" style="width: 120px" />
          <el-button type="primary" size="small" @click="addMaterial">添加</el-button>
        </div>
        <el-table :data="detail.materials" size="small">
          <el-table-column label="类型" width="90">
            <template #default="{ row }"><el-tag size="small">{{ typeLabel(row.type) }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="title" label="标题" />
          <el-table-column prop="report_id" label="报告ID" width="100" />
          <el-table-column label="文件" width="80">
            <template #default="{ row }">
              <el-link v-if="row.oss_key" :href="`/api/files/${row.oss_key}`" target="_blank" type="primary">查看</el-link>
              <el-link v-else-if="row.source_link" :href="row.source_link" target="_blank">原链</el-link>
            </template>
          </el-table-column>
        </el-table>

        <el-divider content-position="left">授权达人查看</el-divider>
        <div class="mat-add">
          <el-input v-model.number="grantInfId" placeholder="达人ID" style="width: 120px" />
          <el-button size="small" type="primary" @click="grant">开放给该达人</el-button>
        </div>

        <el-divider content-position="left">出单登记(GMV,人工)</el-divider>
        <div class="mat-add">
          <el-input v-model.number="orderInfId" placeholder="达人ID" style="width: 110px" />
          <el-date-picker v-model="orderDate" type="date" value-format="YYYY-MM-DD" style="width: 140px" />
          <el-input v-model.number="orderAmount" placeholder="金额" style="width: 100px" />
          <el-button size="small" type="primary" @click="recordOrder">登记</el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { onMounted, reactive, ref } from 'vue'
import api from '../api'

const MAT_TYPES = [
  { v: 'video_ai', l: 'AI视频' }, { v: 'video_hot', l: '爆款参考' },
  { v: 'video_output', l: '达人成片' }, { v: 'image', l: '图片' },
  { v: 'pdf', l: '质检报告' }, { v: 'copy', l: '文案' },
]
const typeLabel = (v) => MAT_TYPES.find((t) => t.v === v)?.l || v

const user = JSON.parse(localStorage.getItem('user') || '{}')
const isAdmin = user.role === 'admin'

const rows = ref([])
const createVisible = ref(false)
const form = reactive({ default_commission: 5 })
const detailVisible = ref(false)
const detail = ref(null)

const matType = ref('image')
const matTitle = ref('')
const matLink = ref('')
const matText = ref('')
const matReportId = ref('')
const uploadedKey = ref('')

const grantInfId = ref()
const orderInfId = ref()
const orderDate = ref('')
const orderAmount = ref()

async function loadList() {
  rows.value = await api.get('/api/products')
}

async function save() {
  await api.post('/api/products', form)
  createVisible.value = false
  ElMessage.success('已创建')
  loadList()
}

async function open(row) {
  detail.value = await api.get(`/api/products/${row.id}`)
  detailVisible.value = true
}

function beforeUpload() { return true }
async function uploadReq({ file }) {
  const fd = new FormData()
  fd.append('file', file)
  const r = await api.post('/api/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  uploadedKey.value = r.key
  ElMessage.success('文件已上传')
}

async function addMaterial() {
  const body = { type: matType.value, title: matTitle.value }
  if (matType.value === 'video_hot') body.source_link = matLink.value
  else if (matType.value === 'copy') body.parsed_text = matText.value
  else body.oss_key = uploadedKey.value
  if (matType.value === 'pdf') body.report_id = matReportId.value
  await api.post(`/api/products/${detail.value.id}/materials`, body)
  ElMessage.success('已添加素材')
  matTitle.value = matLink.value = matText.value = matReportId.value = uploadedKey.value = ''
  open({ id: detail.value.id })
}

async function grant() {
  await api.post(`/api/products/${detail.value.id}/grant`, { influencer_id: grantInfId.value })
  ElMessage.success('已开放')
  grantInfId.value = undefined
}

async function recordOrder() {
  await api.post(`/api/products/${detail.value.id}/orders`, {
    influencer_id: orderInfId.value, order_date: orderDate.value, amount: orderAmount.value,
  })
  ElMessage.success('已登记出单')
  orderInfId.value = orderAmount.value = undefined
  orderDate.value = ''
}

onMounted(loadList)
</script>

<style scoped>
.toolbar { margin-bottom: 16px; }
.mat-add { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; }
</style>
