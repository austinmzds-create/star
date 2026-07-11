<template>
  <div v-if="d">
    <el-page-header :content="d.nickname" @back="$router.back()" />
    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :span="14">
        <el-card header="档案">
          <el-descriptions :column="2">
            <el-descriptions-item label="抖音号">{{ d.douyin_id }}</el-descriptions-item>
            <el-descriptions-item label="UID">{{ d.douyin_uid }}</el-descriptions-item>
            <el-descriptions-item label="粉丝">{{ d.fans_count }}</el-descriptions-item>
            <el-descriptions-item label="近30天GMV">{{ d.gmv_30d }}</el-descriptions-item>
            <el-descriptions-item label="品类">{{ (d.category_tags || []).join(' / ') }}</el-descriptions-item>
            <el-descriptions-item label="拍摄">{{ d.shoot_type || '未知' }}</el-descriptions-item>
            <el-descriptions-item label="主页">
              <el-link v-if="d.homepage_url" :href="d.homepage_url" target="_blank" type="primary">打开</el-link>
              <span v-else-if="d.homepage_raw" style="color: #909399">{{ d.homepage_raw }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="合作码">{{ d.cooperation_code }}</el-descriptions-item>
            <el-descriptions-item label="收件人">{{ d.real_name }}</el-descriptions-item>
            <el-descriptions-item label="收件电话">{{ d.phone }}</el-descriptions-item>
            <el-descriptions-item label="收件地址" :span="2">{{ d.default_address }}</el-descriptions-item>
            <el-descriptions-item label="来源">{{ d.source }}</el-descriptions-item>
          </el-descriptions>
          <el-divider>定级与待遇(调整会留痕,历史合作记录不回溯)</el-divider>
          <el-form inline>
            <el-form-item label="等级">
              <el-select v-model="edit.level" style="width: 90px">
                <el-option value="L1" /><el-option value="L2" /><el-option value="L3" />
              </el-select>
            </el-form-item>
            <el-form-item label="佣金%">
              <el-input-number v-model="edit.commission_tier" :min="0" :max="50" :step="0.5" />
            </el-form-item>
            <el-form-item label="投流">
              <el-select v-model="edit.promo_mode" style="width: 120px">
                <el-option label="商家投流" value="merchant" />
                <el-option label="达人自投" value="self" />
              </el-select>
            </el-form-item>
            <el-form-item v-if="isAdmin" label="归属商务">
              <el-select v-model="edit.owner_bd_id" style="width: 120px" placeholder="转移给">
                <el-option v-for="b in bds" :key="b.id" :label="b.display_name" :value="b.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="原因">
              <el-input v-model="edit.reason" placeholder="为什么调整" style="width: 160px" />
            </el-form-item>
            <el-button type="primary" @click="save">保存</el-button>
          </el-form>
          <el-divider>标签</el-divider>
          <el-tag v-for="t in (tags || [])" :key="t" closable style="margin-right: 6px" @close="removeTag(t)">{{ t }}</el-tag>
          <el-input v-if="tagInput !== null" v-model="tagInput" size="small" style="width: 120px"
            @keyup.enter="addTag" @blur="addTag" />
          <el-button v-else size="small" @click="tagInput = ''">+ 标签</el-button>
        </el-card>
        <el-card header="原始自我介绍(留档)" style="margin-top: 16px" v-if="d.raw_intro">
          <pre style="white-space: pre-wrap; margin: 0">{{ d.raw_intro }}</pre>
        </el-card>
      </el-col>
      <el-col :span="10">
        <el-card header="合作轮次(数值为当时快照)">
          <el-timeline>
            <el-timeline-item v-for="c in d.cooperations" :key="c.id" :timestamp="c.created_at">
              第{{ c.round_no }}轮 · {{ c.level_snapshot }} · 佣金{{ c.commission_tier_snapshot }}% · {{ c.status }}
            </el-timeline-item>
          </el-timeline>
        </el-card>
        <el-card header="变更记录" style="margin-top: 16px">
          <el-timeline>
            <el-timeline-item v-for="(l, i) in d.change_logs" :key="i" :timestamp="l.at">
              {{ l.field }}: {{ l.old }} → {{ l.new }} <span v-if="l.reason">({{ l.reason }})</span>
            </el-timeline-item>
          </el-timeline>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import api from '../api'

const route = useRoute()
const user = JSON.parse(localStorage.getItem('user') || '{}')
const isAdmin = user.role === 'admin' || user.role === 'bd'
const d = ref(null)
const edit = reactive({})
const tags = ref([])
const tagInput = ref(null)
const bds = ref([])

async function load() {
  d.value = await api.get(`/api/influencers/${route.params.id}`)
  tags.value = d.value.tags || []
  Object.assign(edit, {
    level: d.value.level,
    commission_tier: d.value.commission_tier,
    promo_mode: d.value.promo_mode,
    owner_bd_id: d.value.owner_bd_id,
    reason: '',
  })
}

async function save() {
  await api.patch(`/api/influencers/${route.params.id}`, edit)
  ElMessage.success('已保存')
  load()
}

async function saveTags() {
  await api.patch(`/api/influencers/${route.params.id}`, { tags: tags.value })
}
function addTag() {
  const v = (tagInput.value || '').trim()
  if (v && !tags.value.includes(v)) {
    tags.value.push(v)
    saveTags()
  }
  tagInput.value = null
}
function removeTag(t) {
  tags.value = tags.value.filter((x) => x !== t)
  saveTags()
}

onMounted(async () => {
  await load()
  if (isAdmin) {
    try { bds.value = await api.get('/api/admin/bd-users') } catch (e) { /* ignore */ }
  }
})
</script>
