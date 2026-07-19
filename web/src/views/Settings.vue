<template>
  <div>
    <el-card header="等级权益配置(改动只影响之后新产生的合作/寄样/投流记录,历史快照不回溯)">
      <el-table :data="configs">
        <el-table-column prop="level" label="等级" width="80" />
        <el-table-column label="默认佣金%">
          <template #default="{ row }">
            <el-input-number v-model="row.commission_tier" :min="0" :max="50" :step="0.5" size="small" />
          </template>
        </el-table-column>
        <el-table-column label="可寄品数(0=全品类)">
          <template #default="{ row }">
            <el-input-number v-model="row.max_sample_products" :min="0" :max="99" size="small" />
          </template>
        </el-table-column>
        <el-table-column label="视频必审">
          <template #default="{ row }"><el-switch v-model="row.video_audit_required" /></template>
        </el-table-column>
        <el-table-column prop="version" label="当前版本" width="90" />
        <el-table-column width="100">
          <template #default="{ row }">
            <el-button size="small" type="primary" @click="saveLevel(row)">保存新版本</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card header="催拍设置" style="margin-top: 16px">
      签收后
      <el-input-number v-model="followUpDays" :min="1" :max="60" size="small" />
      天无视频 → 自动生成催拍待办
      <el-button size="small" type="primary" @click="saveFollowUp">保存</el-button>
    </el-card>

    <el-card header="商务管理" style="margin-top: 16px">
      <p style="color: #909399; font-size: 13px; margin-top: 0">
        填手机号直接添加,该手机号可从「商务/管理员」入口登录内部后台。
      </p>
      <div class="bd-add">
        <el-input v-model="newBd.display_name" placeholder="姓名" style="width: 140px" />
        <el-input v-model="newBd.phone" placeholder="手机号" style="width: 160px" maxlength="11" />
        <el-button type="primary" @click="createBd">添加商务</el-button>
      </div>
      <el-table :data="bds">
        <el-table-column prop="display_name" label="姓名" />
        <el-table-column prop="phone" label="手机号" />
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-switch v-model="row.is_active" @change="(v) => toggleBd(row, v)" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="openBdEdit(row)">编辑</el-button>
            <el-button size="small" text type="danger" @click="deleteBd(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="bdEditVisible" title="编辑商务" width="420px">
      <el-form label-width="72px">
        <el-form-item label="姓名"><el-input v-model="bdEdit.display_name" /></el-form-item>
        <el-form-item label="手机号"><el-input v-model="bdEdit.phone" maxlength="11" /></el-form-item>
        <el-form-item label="状态"><el-switch v-model="bdEdit.is_active" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="bdEditVisible = false">取消</el-button>
        <el-button type="primary" :loading="savingBd" @click="saveBdEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus'
import { onMounted, reactive, ref } from 'vue'
import api from '../api'

const configs = ref([])
const bds = ref([])
const followUpDays = ref(7)
const newBd = reactive({ display_name: '', phone: '' })
const bdEditVisible = ref(false)
const bdEdit = reactive({ id: null, display_name: '', phone: '', is_active: true })
const savingBd = ref(false)

async function load() {
  const [nextConfigs, nextBds, fu] = await Promise.all([
    api.get('/api/admin/level-configs'),
    api.get('/api/admin/bd-users'),
    api.get('/api/admin/system-configs/follow_up_days'),
  ])
  configs.value = nextConfigs
  bds.value = nextBds
  if (fu.value?.days) followUpDays.value = fu.value.days
}

async function saveLevel(row) {
  await api.put(`/api/admin/level-configs/${row.level}`, {
    commission_tier: row.commission_tier,
    max_sample_products: row.max_sample_products,
    video_audit_required: row.video_audit_required,
  })
  ElMessage.success(`${row.level} 配置已生效(仅影响新数据)`)
  load()
}

async function saveFollowUp() {
  await api.put('/api/admin/system-configs/follow_up_days', { value: { days: followUpDays.value } })
  ElMessage.success('已保存')
}

async function createBd() {
  if (!newBd.phone || !newBd.display_name) {
    ElMessage.warning('请填写姓名和手机号')
    return
  }
  try {
    await api.post('/api/admin/bd-users', { ...newBd })
    ElMessage.success('已添加商务')
    newBd.display_name = newBd.phone = ''
    load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '添加失败')
  }
}

async function toggleBd(row, v) {
  try {
    await api.patch(`/api/admin/bd-users/${row.id}`, { is_active: v })
  } catch (e) {
    row.is_active = !v
    ElMessage.error('操作失败')
  }
}

function openBdEdit(row) {
  Object.assign(bdEdit, {
    id: row.id,
    display_name: row.display_name,
    phone: row.phone,
    is_active: row.is_active,
  })
  bdEditVisible.value = true
}

async function saveBdEdit() {
  if (!bdEdit.display_name || !bdEdit.phone) return ElMessage.warning('请填写姓名和手机号')
  savingBd.value = true
  try {
    await api.patch(`/api/admin/bd-users/${bdEdit.id}`, {
      display_name: bdEdit.display_name,
      phone: bdEdit.phone,
      is_active: bdEdit.is_active,
    })
    ElMessage.success('已保存')
    bdEditVisible.value = false
    load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '保存失败')
  } finally {
    savingBd.value = false
  }
}

async function deleteBd(row) {
  try {
    await ElMessageBox.confirm(`确认删除商务「${row.display_name}」?已有业务记录时系统会阻止删除。`, '删除商务', {
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    await api.delete(`/api/admin/bd-users/${row.id}`)
    ElMessage.success('已删除')
    load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '删除失败')
  }
}

onMounted(load)
</script>
