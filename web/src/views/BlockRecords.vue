<template>
  <div>
    <div class="page-toolbar">
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
      <span class="muted">只看加星 <el-switch v-model="onlyStarred" @change="loadList" /></span>
      <el-button type="primary" @click="openCreate">+ 新增卡审记录</el-button>
    </div>

    <el-table :data="rows">
      <el-table-column label="截图" width="130">
        <template #default="{ row }">
          <div class="shots">
            <el-image v-for="(u, i) in row.screenshots" :key="i" :src="u" :preview-src-list="row.screenshots"
              :initial-index="i" fit="cover" class="shot" />
            <span v-if="!row.screenshots.length" class="muted">—</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="text" label="文案/说明" show-overflow-tooltip />
      <el-table-column label="违规类型" width="130">
        <template #default="{ row }"><el-tag v-if="row.tag" size="small" type="danger">{{ row.tag }}</el-tag></template>
      </el-table-column>
      <el-table-column label="关联达人" width="120">
        <template #default="{ row }">{{ row.influencer_nickname || '—' }}</template>
      </el-table-column>
      <el-table-column label="视频" width="70">
        <template #default="{ row }">
          <el-link v-if="row.video_url" :href="row.video_url" target="_blank" type="primary">看</el-link>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column label="时间" width="150">
        <template #default="{ row }">{{ ft(row.happened_at) }}</template>
      </el-table-column>
      <el-table-column label="加星" width="70">
        <template #default="{ row }"><el-switch :model-value="row.starred" @change="(v) => toggleStar(row, v)" /></template>
      </el-table-column>
      <el-table-column v-if="isAdmin" label="操作" width="80">
        <template #default="{ row }"><el-button link type="danger" @click="remove(row)">删除</el-button></template>
      </el-table-column>
    </el-table>

    <!-- 新增卡审记录 -->
    <el-dialog v-model="createVisible" title="新增卡审记录" width="560px">
      <el-form label-width="90px">
        <el-form-item label="违规类型">
          <el-select v-model="form.tag" placeholder="选择或输入(如 极限词/夸大功效)" filterable allow-create default-first-option style="width: 100%">
            <el-option v-for="t in PRESET_TAGS" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="文案/说明"><el-input v-model="form.text" type="textarea" :rows="3" placeholder="卡审点说明,如:未成年口播必卡,改家长口播+孩子出镜" /></el-form-item>
        <el-form-item label="产品">
          <el-select v-model="form.product_id" placeholder="可空" clearable filterable style="width: 100%">
            <el-option v-for="p in products" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="关联达人">
          <InfluencerSelect v-model="form.influencer_id" />
        </el-form-item>
        <el-form-item label="视频链接"><el-input v-model="form.video_url" placeholder="违规视频链接(选填)" /></el-form-item>
        <el-form-item label="截图">
          <MultiUpload v-model="form.screenshots" :max="9" prefix="block" />
        </el-form-item>
        <el-form-item label="发生时间">
          <el-date-picker v-model="form.happened_at" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" style="width: 100%" />
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
import InfluencerSelect from '../components/InfluencerSelect.vue'
import MultiUpload from '../components/MultiUpload.vue'
import { formatTime as ft } from '../utils/time'

const PRESET_TAGS = ['极限词', '夸大功效', '未成年口播', '功效词无报告', '异常流量', '医疗宣称', '虚假承诺']
const user = JSON.parse(localStorage.getItem('user') || '{}')
const isAdmin = user.role === 'admin' || user.role === 'bd'

const rows = ref([])
const products = ref([])
const tags = ref([])
const days = ref(7)
const productId = ref(null)
const tag = ref(null)
const onlyStarred = ref(false)
const createVisible = ref(false)
const form = reactive({ product_id: null, influencer_id: null, tag: '', text: '', video_url: '', screenshots: [], happened_at: '' })

async function loadList() {
  const params = {}
  if (days.value) params.days = days.value
  if (productId.value) params.product_id = productId.value
  if (tag.value) params.tag = tag.value
  if (onlyStarred.value) params.starred = true
  rows.value = await api.get('/api/block-records', { params })
}
async function loadTags() { tags.value = await api.get('/api/block-records/tags') }

function openCreate() {
  Object.assign(form, { product_id: null, influencer_id: null, tag: '', text: '', video_url: '', screenshots: [], happened_at: '' })
  createVisible.value = true
}
async function save() {
  if (!form.text && !form.tag) return ElMessage.warning('请至少填写违规类型或说明')
  await api.post('/api/block-records', { ...form })
  createVisible.value = false
  ElMessage.success('已新增')
  loadList(); loadTags()
}
async function toggleStar(row, v) { await api.post(`/api/block-records/${row.id}/star`, { starred: v }); loadList() }
async function remove(row) {
  await ElMessageBox.confirm('确认删除该卡审记录?', '提示', { type: 'warning' })
  await api.delete(`/api/block-records/${row.id}`)
  ElMessage.success('已删除'); loadList()
}

onMounted(async () => { products.value = await api.get('/api/products'); loadTags(); loadList() })
</script>

<style scoped>
.shots { display: flex; gap: 4px; }
.shot { width: 40px; height: 40px; border-radius: 6px; }
</style>
