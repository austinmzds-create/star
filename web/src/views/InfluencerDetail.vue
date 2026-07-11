<template>
  <div v-if="d">
    <el-page-header :content="d.nickname" @back="$router.back()" />

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
          <div class="kv"><span class="k">抖音号</span><CopyText :value="d.douyin_id" /></div>
          <div class="kv"><span class="k">UID</span><CopyText :value="d.douyin_uid" /></div>
          <div class="kv"><span class="k">合作码</span><CopyText :value="d.cooperation_code" /></div>
          <div class="kv"><span class="k">收件人</span><span>{{ d.real_name || '—' }}</span></div>
          <div class="kv"><span class="k">手机</span><CopyText :value="d.phone" /></div>
          <div class="kv"><span class="k">收件地址</span><span>{{ d.default_address || '—' }}</span></div>
          <div class="kv"><span class="k">品类</span><span>{{ (d.category_tags || []).join(' / ') || '—' }}</span></div>
          <div class="kv"><span class="k">拍摄</span><span>{{ d.shoot_type || '未知' }}</span></div>
          <div class="kv"><span class="k">主页</span>
            <el-link v-if="d.homepage_url" :href="d.homepage_url" target="_blank" type="primary">打开</el-link>
            <span v-else>{{ d.homepage_raw || '—' }}</span>
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
      </el-col>

      <!-- 右:动态(寄样/视频/投流/合作/留痕) -->
      <el-col :span="14">
        <el-card>
          <el-tabs v-model="tab">
            <el-tab-pane :label="`寄样 ${act.samples.length}`" name="samples">
              <el-empty v-if="!act.samples.length" description="暂无寄样" :image-size="60" />
              <div v-for="s in act.samples" :key="s.id" class="row-card">
                <div class="rc-main">
                  <span class="rc-title">{{ s.product_name }}</span>
                  <el-tag size="small" :type="sampleTag(s.status).type">{{ sampleTag(s.status).label }}</el-tag>
                </div>
                <div class="rc-sub muted">
                  <span v-if="s.tracking_no">{{ s.courier_company }} {{ s.tracking_no }}</span>
                  <span v-if="s.logistics_status">· {{ logi(s.logistics_status.status) }}</span>
                  <span v-if="s.signed_at">· 签收 {{ ft(s.signed_at) }}</span>
                  <span v-if="s.reject_reason">· {{ s.reject_reason }}</span>
                  <span>· {{ ft(s.created_at) }}</span>
                </div>
              </div>
            </el-tab-pane>

            <el-tab-pane :label="`视频 ${act.videos.length}`" name="videos">
              <el-empty v-if="!act.videos.length" description="暂无视频" :image-size="60" />
              <div v-for="v in act.videos" :key="v.id" class="row-card">
                <div class="rc-main">
                  <span class="rc-title">{{ v.product_name }}</span>
                  <el-tag size="small" :type="videoTag(v.status).type">{{ videoTag(v.status).label }}</el-tag>
                  <el-link v-if="v.dy_url" :href="v.dy_url" target="_blank" type="primary" style="margin-left:auto">查看</el-link>
                </div>
                <div class="rc-sub muted">{{ ft(v.created_at) }}</div>
              </div>
            </el-tab-pane>

            <el-tab-pane :label="`投流 ${act.promotions.length}`" name="promotions">
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

            <el-tab-pane label="合作轮次" name="coop">
              <el-timeline>
                <el-timeline-item v-for="c in d.cooperations" :key="c.id" :timestamp="ft(c.created_at)">
                  第{{ c.round_no }}轮 · {{ c.level_snapshot }} · 佣金{{ c.commission_tier_snapshot }}% · {{ c.status }}
                </el-timeline-item>
              </el-timeline>
            </el-tab-pane>

            <el-tab-pane label="变更记录" name="logs">
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
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import api from '../api'
import CopyText from '../components/CopyText.vue'
import { formatTime as ft } from '../utils/time'
import { LOGISTICS_STATUS, PROMO_STATUS, SAMPLE_STATUS, VIDEO_STATUS, tag } from '../utils/status'

const route = useRoute()
const user = JSON.parse(localStorage.getItem('user') || '{}')
const isStaff = user.role === 'admin' || user.role === 'bd'
const d = ref(null)
const act = ref({ samples: [], videos: [], promotions: [] })
const edit = reactive({})
const tags = ref([])
const tagInput = ref(null)
const bds = ref([])
const tab = ref('samples')

const sampleTag = (s) => tag(SAMPLE_STATUS, s)
const videoTag = (s) => tag(VIDEO_STATUS, s)
const promoTag = (s) => tag(PROMO_STATUS, s)
const logi = (s) => LOGISTICS_STATUS[s] || s

async function load() {
  d.value = await api.get(`/api/influencers/${route.params.id}`)
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
async function saveTags() { await api.patch(`/api/influencers/${route.params.id}`, { tags: tags.value }) }
function addTag() {
  const v = (tagInput.value || '').trim()
  if (v && !tags.value.includes(v)) { tags.value.push(v); saveTags() }
  tagInput.value = null
}
function removeTag(t) { tags.value = tags.value.filter((x) => x !== t); saveTags() }

onMounted(async () => {
  await load()
  if (isStaff) { try { bds.value = await api.get('/api/admin/bd-users') } catch (e) { /* ignore */ } }
})
</script>

<style scoped>
.stats { display: flex; gap: 12px; margin: 16px 0; flex-wrap: wrap; }
.stat { background: #fff; border-radius: 12px; padding: 14px 22px; box-shadow: 0 2px 12px rgba(20,30,60,.04); text-align: center; min-width: 96px; }
.stat .v { font-size: 20px; font-weight: 600; color: #1f2637; }
.stat .k { font-size: 12px; color: #8a93a6; margin-top: 4px; }
.kv { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
.kv .k { color: #8a93a6; font-size: 13px; min-width: 64px; }
.raw { white-space: pre-wrap; margin: 0; font-size: 13px; color: #5a6072; }
.row-card { padding: 10px 0; border-bottom: 1px solid #f2f3f7; }
.row-card:last-child { border-bottom: none; }
.rc-main { display: flex; align-items: center; gap: 8px; }
.rc-title { font-weight: 500; }
.rc-sub { font-size: 12px; margin-top: 4px; }
</style>
