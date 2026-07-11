<template>
  <div>
    <div class="toolbar">
      <el-input v-model="q" placeholder="搜昵称/抖音号/UID/手机号" style="width: 260px" clearable @change="() => { page = 1; load() }" />
      <el-select v-model="level" placeholder="等级" style="width: 100px" clearable @change="() => { page = 1; load() }">
        <el-option label="L1" value="L1" /><el-option label="L2" value="L2" /><el-option label="L3" value="L3" />
      </el-select>
      <el-button type="primary" @click="showPaste = true">+ 粘贴录入达人</el-button>
    </div>

    <el-table :data="rows" @row-click="(r) => $router.push(`/influencers/${r.id}`)" style="cursor: pointer">
      <el-table-column prop="nickname" label="昵称" />
      <el-table-column prop="douyin_id" label="抖音号" />
      <el-table-column prop="fans_count" label="粉丝" width="80" />
      <el-table-column prop="gmv_30d" label="GMV" width="80" />
      <el-table-column label="等级" width="70">
        <template #default="{ row }"><el-tag>{{ row.level }}</el-tag></template>
      </el-table-column>
      <el-table-column label="佣金" width="70">
        <template #default="{ row }">{{ row.commission_tier }}%</template>
      </el-table-column>
      <el-table-column label="标签" width="150">
        <template #default="{ row }">
          <el-tag v-for="t in (row.tags || [])" :key="t" size="small" type="info" style="margin-right: 4px">{{ t }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="owner_bd_name" label="归属商务" width="100" />
      <el-table-column prop="round_count" label="轮次" width="70" />
    </el-table>
    <el-pagination background layout="total, prev, pager, next" :total="total"
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
        <el-alert v-if="parsed && parsed.duplicate" type="warning" :closable="false" style="margin: 12px 0"
          :title="`老达人:${parsed.duplicate.nickname},已合作 ${parsed.duplicate.round_count} 轮,将挂到已有档案`" />
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
        <el-button type="primary" :disabled="!canSave" @click="save">保存建档</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { computed, onMounted, reactive, ref } from 'vue'
import api from '../api'

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

const MODES = [
  { label: '粘贴识别', value: 'paste' },
  { label: '手动填写', value: 'manual' },
]
const rows = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 50
const q = ref('')
const level = ref('')
const showPaste = ref(false)
const mode = ref('paste')
const pasteText = ref('')
const parsing = ref(false)
const parsed = ref(null)
const form = reactive({ level: 'L1' })

const canSave = computed(() => !!(form.nickname && (mode.value === 'manual' || parsed.value)))

function resetDialog() {
  mode.value = 'paste'
  pasteText.value = ''
  parsed.value = null
  Object.keys(form).forEach((k) => delete form[k])
  form.level = 'L1'
}

async function load() {
  const data = await api.get('/api/influencers', {
    params: { q: q.value || undefined, level: level.value || undefined, page: page.value, page_size: pageSize },
  })
  rows.value = data.items
  total.value = data.total
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
  try {
    await api.post('/api/influencers', { ...form })
    ElMessage.success('已建档并开启第1轮合作')
    showPaste.value = false
    load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '保存失败')
  }
}

onMounted(load)
</script>

<style scoped>
.toolbar { display: flex; gap: 12px; margin-bottom: 16px; }
.low-conf :deep(.el-input__wrapper) { background: #fdf6ec; } /* LLM 低置信度标黄待确认 */
</style>
