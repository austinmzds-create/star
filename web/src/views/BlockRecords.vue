<template>
  <div>
    <div class="toolbar">
      <el-radio-group v-model="days" @change="loadList">
        <el-radio-button :value="7">近7天</el-radio-button>
        <el-radio-button :value="15">近15天</el-radio-button>
        <el-radio-button :value="30">近30天</el-radio-button>
        <el-radio-button :value="0">全部</el-radio-button>
      </el-radio-group>
      <el-select v-model="productId" placeholder="全部产品" clearable style="width: 180px" @change="loadList">
        <el-option v-for="p in products" :key="p.id" :label="p.name" :value="p.id" />
      </el-select>
      <el-select v-model="tag" placeholder="全部违规类型" clearable style="width: 160px" @change="loadList">
        <el-option v-for="t in tags" :key="t" :label="t" :value="t" />
      </el-select>
      <span>只看加星 <el-switch v-model="onlyStarred" @change="loadList" /></span>
      <el-button type="primary" @click="createVisible = true">+ 新增卡审记录</el-button>
    </div>

    <el-table :data="rows">
      <el-table-column label="截图" width="100">
        <template #default="{ row }">
          <el-image v-if="row.screenshot_url" :src="row.screenshot_url" :preview-src-list="[row.screenshot_url]"
                    fit="cover" style="width: 64px; height: 64px" />
          <span v-else style="color: #ccc">—</span>
        </template>
      </el-table-column>
      <el-table-column prop="text" label="文案" show-overflow-tooltip />
      <el-table-column label="违规类型" width="140">
        <template #default="{ row }"><el-tag v-if="row.tag" size="small" type="danger">{{ row.tag }}</el-tag></template>
      </el-table-column>
      <el-table-column label="时间" width="170">
        <template #default="{ row }">{{ fmt(row.happened_at) }}</template>
      </el-table-column>
      <el-table-column label="加星" width="80">
        <template #default="{ row }">
          <el-switch :model-value="row.starred" @change="(v) => toggleStar(row, v)" />
        </template>
      </el-table-column>
      <el-table-column v-if="isAdmin" label="操作" width="90">
        <template #default="{ row }">
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 新增卡审记录 -->
    <el-dialog v-model="createVisible" title="新增卡审记录" width="520px">
      <el-form label-width="90px">
        <el-form-item label="产品">
          <el-select v-model="form.product_id" placeholder="可空" clearable style="width: 100%">
            <el-option v-for="p in products" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="违规类型"><el-input v-model="form.tag" placeholder="如 极限词/夸大功效" /></el-form-item>
        <el-form-item label="文案"><el-input v-model="form.text" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="发生时间">
          <el-date-picker v-model="form.happened_at" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" style="width: 100%" />
        </el-form-item>
        <el-form-item label="截图">
          <el-upload :show-file-list="false" :before-upload="beforeUpload" :http-request="uploadReq">
            <el-button size="small">上传截图</el-button>
          </el-upload>
          <el-image v-if="previewUrl" :src="previewUrl" fit="cover" style="width: 64px; height: 64px; margin-left: 8px" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus'
import { onMounted, reactive, ref } from 'vue'
import api from '../api'

const user = JSON.parse(localStorage.getItem('user') || '{}')
const isAdmin = user.role === 'admin'

const rows = ref([])
const products = ref([])
const tags = ref([])

const days = ref(7)
const productId = ref(null)
const tag = ref(null)
const onlyStarred = ref(false)

const createVisible = ref(false)
const form = reactive({ product_id: null, tag: '', text: '', happened_at: '', screenshot_oss_key: '' })
const previewUrl = ref('')

function fmt(s) { return s ? String(s).replace('T', ' ').slice(0, 16) : '' }

async function loadList() {
  const params = {}
  if (days.value) params.days = days.value
  if (productId.value) params.product_id = productId.value
  if (tag.value) params.tag = tag.value
  if (onlyStarred.value) params.starred = true
  rows.value = await api.get('/api/block-records', { params })
}

async function loadTags() { tags.value = await api.get('/api/block-records/tags') }

function beforeUpload() { return true }
async function uploadReq({ file }) {
  const fd = new FormData()
  fd.append('file', file)
  const r = await api.post('/api/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  form.screenshot_oss_key = r.key
  previewUrl.value = r.url
  ElMessage.success('截图已上传')
}

async function save() {
  await api.post('/api/block-records', { ...form })
  createVisible.value = false
  ElMessage.success('已新增')
  form.product_id = null; form.tag = ''; form.text = ''; form.happened_at = ''; form.screenshot_oss_key = ''
  previewUrl.value = ''
  loadList(); loadTags()
}

async function toggleStar(row, v) {
  await api.post(`/api/block-records/${row.id}/star`, { starred: v })
  loadList()
}

async function remove(row) {
  await ElMessageBox.confirm('确认删除该卡审记录?', '提示', { type: 'warning' })
  await api.delete(`/api/block-records/${row.id}`)
  ElMessage.success('已删除')
  loadList()
}

onMounted(async () => {
  products.value = await api.get('/api/products')
  loadTags()
  loadList()
})
</script>

<style scoped>
.toolbar { margin-bottom: 16px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
</style>
