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

    <el-card header="商务账号" style="margin-top: 16px">
      <div class="bd-add">
        <el-input v-model="newBd.display_name" placeholder="姓名" style="width: 120px" />
        <el-input v-model="newBd.username" placeholder="登录账号" style="width: 140px" />
        <el-input v-model="newBd.password" placeholder="初始密码" style="width: 140px" />
        <el-button type="primary" @click="createBd">新建商务</el-button>
      </div>
      <el-table :data="bds">
        <el-table-column prop="display_name" label="姓名" />
        <el-table-column prop="username" label="账号" />
        <el-table-column prop="is_active" label="启用" />
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { onMounted, ref } from 'vue'
import api from '../api'

const configs = ref([])
const bds = ref([])
const followUpDays = ref(7)
const newBd = reactive({ display_name: '', username: '', password: '' })

async function load() {
  configs.value = await api.get('/api/admin/level-configs')
  bds.value = await api.get('/api/admin/bd-users')
  const fu = await api.get('/api/admin/system-configs/follow_up_days')
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
  if (!newBd.username || !newBd.password || !newBd.display_name) {
    ElMessage.warning('请填写完整')
    return
  }
  await api.post('/api/admin/bd-users', { ...newBd })
  ElMessage.success('已新建商务账号')
  newBd.display_name = newBd.username = newBd.password = ''
  load()
}

onMounted(load)
</script>
