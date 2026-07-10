<template>
  <div>
    <div class="toolbar">
      <el-input v-model="q" placeholder="搜昵称/抖音号/UID/手机号" style="width: 260px" clearable @change="load" />
      <el-select v-model="level" placeholder="等级" style="width: 100px" clearable @change="load">
        <el-option label="L1" value="L1" /><el-option label="L2" value="L2" /><el-option label="L3" value="L3" />
      </el-select>
      <el-button type="primary" @click="showPaste = true">+ 粘贴录入达人</el-button>
    </div>

    <el-table :data="rows" @row-click="(r) => $router.push(`/influencers/${r.id}`)" style="cursor: pointer">
      <el-table-column prop="nickname" label="昵称" />
      <el-table-column prop="douyin_id" label="抖音号" />
      <el-table-column prop="fans_count" label="粉丝" />
      <el-table-column prop="gmv_30d" label="近30天GMV" />
      <el-table-column label="等级" width="80">
        <template #default="{ row }"><el-tag>{{ row.level }}</el-tag></template>
      </el-table-column>
      <el-table-column label="佣金" width="80">
        <template #default="{ row }">{{ row.commission_tier }}%</template>
      </el-table-column>
      <el-table-column label="投流" width="100">
        <template #default="{ row }">{{ row.promo_mode === 'merchant' ? '商家投流' : '达人自投' }}</template>
      </el-table-column>
      <el-table-column prop="round_count" label="合作轮次" width="90" />
    </el-table>

    <!-- 智能粘贴录入:核心交互(R1) -->
    <el-dialog v-model="showPaste" title="粘贴录入达人" width="620px">
      <el-input v-model="pasteText" type="textarea" :rows="6"
        placeholder="把达人在微信里发来的自我介绍整段粘贴到这里(含抖音号/UID/主页链接/粉丝数等)" />
      <el-button type="primary" style="margin-top: 12px" :loading="parsing" @click="doParse">识别</el-button>

      <template v-if="parsed">
        <el-alert v-if="parsed.duplicate" type="warning" :closable="false" style="margin-top: 12px"
          :title="`老达人:${parsed.duplicate.nickname},已合作 ${parsed.duplicate.round_count} 轮,将挂到已有档案`" />
        <el-form label-width="90px" style="margin-top: 12px">
          <el-form-item v-for="f in FIELDS" :key="f.key" :label="f.label">
            <el-input v-model="form[f.key]"
              :class="{ 'low-conf': parsed.source[f.key] === 'llm' }" />
          </el-form-item>
          <el-form-item label="等级">
            <el-radio-group v-model="form.level">
              <el-radio value="L1">L1(佣金5%)</el-radio>
              <el-radio value="L2">L2(6%)</el-radio>
              <el-radio value="L3">L3(7%)</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="form.homepage_url">
            <el-link :href="form.homepage_url" target="_blank" type="primary">↗ 打开主页人工审核</el-link>
          </el-form-item>
        </el-form>
        <el-button type="success" @click="save">保存建档</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { onMounted, reactive, ref } from 'vue'
import api from '../api'

const FIELDS = [
  { key: 'nickname', label: '昵称' },
  { key: 'douyin_id', label: '抖音号' },
  { key: 'douyin_uid', label: 'UID' },
  { key: 'homepage_url', label: '主页链接' },
  { key: 'phone', label: '手机号' },
  { key: 'fans_count', label: '粉丝数' },
]

const rows = ref([])
const q = ref('')
const level = ref('')
const showPaste = ref(false)
const pasteText = ref('')
const parsing = ref(false)
const parsed = ref(null)
const form = reactive({ level: 'L1' })

async function load() {
  rows.value = await api.get('/api/influencers', { params: { q: q.value || undefined, level: level.value || undefined } })
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
  await api.post('/api/influencers', form)
  ElMessage.success('已建档并开启第1轮合作')
  showPaste.value = false
  parsed.value = null
  pasteText.value = ''
  load()
}

onMounted(load)
</script>

<style scoped>
.toolbar { display: flex; gap: 12px; margin-bottom: 16px; }
.low-conf :deep(.el-input__wrapper) { background: #fdf6ec; } /* LLM 低置信度标黄待确认 */
</style>
