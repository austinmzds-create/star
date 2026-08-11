<template>
  <div v-if="me" class="me">
    <!-- 资料编辑 -->
    <section class="card">
      <div class="sec-head">
        <div class="title">我的资料</div>
        <el-button size="small" text type="primary" @click="editing = !editing">
          {{ editing ? '收起' : (me.has_profile ? '更新资料' : '完善资料') }}
        </el-button>
      </div>
      <div class="kv"><span class="k">昵称</span><span class="v">{{ me.nickname || '—' }}</span></div>
      <div class="kv"><span class="k">等级/佣金</span><span class="v">{{ me.level || 'L1' }} · 佣金 {{ me.commission_tier ?? '—' }}%</span></div>
      <div class="kv"><span class="k">收件人</span><span class="v">{{ me.real_name || '—' }} {{ me.phone || '' }}</span></div>
      <div class="kv"><span class="k">收件地址</span><span class="v">{{ me.default_address || '—' }}</span></div>
      <div v-if="editing || !me.has_profile" class="edit">
        <div class="form-grid">
          <el-input v-model="profileForm.nickname" placeholder="达人昵称" />
          <el-input v-model="profileForm.douyin_id" placeholder="抖音号" />
          <el-input v-model="profileForm.real_name" placeholder="收件人姓名" />
          <el-input v-model="profileForm.default_address" placeholder="收件地址" />
          <el-input v-model="profileForm.homepage_url" placeholder="主页链接（可选）" />
          <el-input v-model="profileForm.cooperation_code" placeholder="合作码（可选）" />
        </div>
        <el-input v-model="profileForm.category_tags_text" placeholder="内容品类，多个用逗号隔开（可选）" />
        <el-input v-model="intro" type="textarea" :rows="4"
          placeholder="也可以把自我介绍粘贴到这里，系统会辅助识别；上面的字段会优先保存。" />
        <el-button type="primary" style="width:100%;margin-top:10px" :loading="submitting" @click="submit">保存资料</el-button>
      </div>
    </section>

    <!-- 我的视频（审核 / 卡审反馈） -->
    <section class="card">
      <div class="sec-head"><div class="title">我的视频</div></div>
      <el-empty v-if="!videos.length" description="暂无视频，商务代录或你在此提交后可见审核结果" :image-size="56" />
      <div v-for="v in videos" :key="v.id" class="vrow" :class="{ warn: v.need_fix }">
        <div class="vtop">
          <el-image v-if="v.product_image" :src="v.product_image" fit="cover" class="vimg" />
          <div v-else class="vimg placeholder" />
          <div class="vinfo">
            <div class="vname">{{ v.product_name }}</div>
            <div class="vsub muted">
              {{ fmt(v.created_at) }}
              <span v-if="v.unread_comment_count" class="comment-dot">{{ v.unread_comment_count }}新反馈</span>
            </div>
          </div>
          <el-tag size="small" :type="videoTagType(v.status)">{{ v.status_label }}</el-tag>
        </div>
        <div v-if="v.submit_note" class="vnote">备注：{{ v.submit_note }}</div>
        <!-- 卡审/未通过：原因 + 时间点问题，达人照此整改 -->
        <div v-if="v.need_fix" class="vfix">
          <div v-if="v.reject_reason" class="vreason">整改要求：{{ v.reject_reason }}</div>
          <ul v-if="v.time_comments.length" class="vtc">
            <li v-for="(tc, i) in v.time_comments" :key="i">{{ tc }}</li>
          </ul>
          <div class="video-links">
            <el-link v-if="v.dy_url" :href="v.dy_url" target="_blank" type="primary" class="vlink">查看分享链接</el-link>
            <el-link v-if="v.uploaded_url" :href="v.uploaded_url" target="_blank" type="primary" class="vlink">查看上传视频</el-link>
          </div>
        </div>
        <div v-else class="video-links">
          <el-link v-if="v.dy_url" :href="v.dy_url" target="_blank" type="primary" class="vlink">查看分享链接</el-link>
          <el-link v-if="v.uploaded_url" :href="v.uploaded_url" target="_blank" type="primary" class="vlink">查看上传视频</el-link>
        </div>
        <div v-if="v.comments?.length" class="feedback-list">
          <div v-for="c in v.comments" :key="c.id" class="feedback-item">
            <div class="feedback-meta">{{ c.author_name || '内部人员' }} · {{ fmt(c.created_at) }}</div>
            <div v-if="c.body" class="feedback-body">{{ c.body }}</div>
            <div v-if="c.attachments?.length" class="feedback-files">
              <a v-for="a in c.attachments" :key="a.id" :href="a.download_url || a.url" target="_blank" rel="noopener">
                {{ a.filename || '附件' }}
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 我的寄样（物流） -->
    <section class="card">
      <div class="sec-head"><div class="title">我的寄样</div></div>
      <el-empty v-if="!me.samples.length" description="暂无寄样" :image-size="56" />
      <div v-for="s in me.samples" :key="s.id" class="srow">
        <div class="stop">
          <el-image v-if="s.product_image" :src="s.product_image" fit="cover" class="vimg" />
          <div v-else class="vimg placeholder" />
          <div class="vinfo">
            <div class="vname">{{ s.product_name }}</div>
            <div v-if="s.tracking_no" class="vsub muted">{{ courierName(s.courier_company) }} {{ s.tracking_no }}</div>
          </div>
          <el-tag size="small" :type="sampleTagType(s)">{{ sampleLabel(s) }}</el-tag>
        </div>
        <div v-if="s.status === 'rejected' && s.reject_reason" class="vreason">未通过：{{ s.reject_reason }}</div>
        <div v-if="logiLast(s)" class="logi">
          <el-icon><Van /></el-icon>
          <span class="ctx">{{ logiLast(s).context }}</span>
          <span class="tm">{{ logiLast(s).ftime || logiLast(s).time }}</span>
        </div>
        <div v-else-if="s.tracking_no" class="logi-empty">{{ logiMessage(s) }}</div>
        <el-timeline v-if="expanded === s.id" class="logi-tl">
          <el-timeline-item v-for="(e, i) in logiEvents(s)" :key="i" :timestamp="e.ftime || e.time"
            :type="i === 0 ? 'primary' : ''" size="small">{{ e.context }}</el-timeline-item>
        </el-timeline>
        <div v-if="s.tracking_no" class="logi-actions">
          <el-button size="small" text :loading="tracking === s.id" @click="refresh(s)">刷新物流</el-button>
          <el-button v-if="logiEvents(s).length > 1" size="small" text @click="expanded = expanded === s.id ? null : s.id">
            {{ expanded === s.id ? '收起' : `全部${logiEvents(s).length}条` }}
          </el-button>
        </div>
      </div>
    </section>

    <button class="logout" type="button" @click="logout">退出登录</button>
  </div>
  <el-empty v-else description="加载中…" :image-size="70" />
</template>

<script setup>
import { Van } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { onMounted, reactive, ref, toRefs, watch } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'
import { formatTime as fmt } from '../utils/time'
import { courierName, logiEvents, logiLast, logiMessage, sampleLabel, sampleTagType, VIDEO_STATUS_TYPE } from './format'
import { clearH5, h5store, loadH5, refreshMe } from './store'

const router = useRouter()
const { me, videos } = toRefs(h5store)
const intro = ref('')
const editing = ref(false)
const submitting = ref(false)
const expanded = ref(null)
const tracking = ref(null)
const profileForm = reactive({
  nickname: '',
  douyin_id: '',
  real_name: '',
  default_address: '',
  homepage_url: '',
  cooperation_code: '',
  category_tags_text: '',
})

const videoTagType = (st) => VIDEO_STATUS_TYPE[st] || 'info'

async function submit() {
  const body = buildProfileBody()
  if (!Object.keys(body).length) return ElMessage.warning('请至少填写一项资料')
  submitting.value = true
  try {
    await api.post('/api/h5/profile', body)
    ElMessage.success('资料已保存')
    intro.value = ''
    editing.value = false
    await refreshMe()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '提交失败')
  } finally {
    submitting.value = false
  }
}

function buildProfileBody() {
  const body = {}
  const current = me.value || {}
  const text = intro.value.trim()
  if (text) body.text = text
  for (const field of ['nickname', 'douyin_id', 'real_name', 'default_address', 'homepage_url', 'cooperation_code']) {
    const value = String(profileForm[field] || '').trim()
    const oldValue = String(current[field] || '').trim()
    if (value || oldValue) body[field] = value
  }
  const tags = profileForm.category_tags_text
    .split(/[,，;；、|\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  if (tags.length || (current.category_tags || []).length) body.category_tags = [...new Set(tags)]
  return body
}

function syncProfileForm() {
  const current = me.value || {}
  profileForm.nickname = current.nickname || ''
  profileForm.douyin_id = current.douyin_id || ''
  profileForm.real_name = current.real_name || ''
  profileForm.default_address = current.default_address || ''
  profileForm.homepage_url = current.homepage_url || ''
  profileForm.cooperation_code = current.cooperation_code || ''
  profileForm.category_tags_text = (current.category_tags || []).join('，')
}

async function refresh(s) {
  tracking.value = s.id
  try {
    const r = await api.post(`/api/h5/samples/${s.id}/track`)
    if (r.ok || r.events?.length) ElMessage.success('物流已更新')
    else if (r.code === 'CONFIG_MISSING') ElMessage.warning(r.message || '物流接口未配置')
    else ElMessage.info(r.message || '暂无轨迹')
    await refreshMe()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '查询失败')
  } finally {
    tracking.value = null
  }
}

function logout() {
  localStorage.removeItem('token')
  localStorage.removeItem('h5_token')
  localStorage.removeItem('user')
  clearH5()
  window.dispatchEvent(new Event('role-session-changed'))
  router.push('/h5')
}

watch(me, syncProfileForm, { immediate: true })

onMounted(() => { if (!h5store.loaded) loadH5() })
</script>

<style scoped>
.me { display: flex; flex-direction: column; gap: 14px; }
.card { background: #fff; border-radius: 14px; padding: 16px; box-shadow: 0 6px 18px rgba(24, 31, 67, 0.05); }
.sec-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.sec-head .title { font-size: 15px; font-weight: 700; color: #1f2430; }
.kv { display: flex; gap: 10px; padding: 4px 0; font-size: 13px; }
.kv .k { color: #9aa1b1; min-width: 62px; flex-shrink: 0; }
.kv .v { color: #2b3143; word-break: break-all; }
.edit { margin-top: 12px; padding-top: 12px; border-top: 1px solid #f2f3f7; }
.form-grid { display: grid; grid-template-columns: 1fr; gap: 8px; margin-bottom: 8px; }
.edit > .el-input { margin-bottom: 8px; }
.muted { color: #9aa1b1; }
/* 视频 / 寄样 行 */
.vrow, .srow { padding: 10px 0; border-top: 1px solid #f3f4f8; }
.vrow:first-of-type, .srow:first-of-type { border-top: none; }
.vrow.warn { background: #fff9f0; border-radius: 10px; padding: 10px; margin: 4px 0; border-top: none; }
.vtop, .stop { display: flex; align-items: center; gap: 10px; }
.vimg { width: 44px; height: 44px; border-radius: 8px; flex-shrink: 0; }
.vimg.placeholder { background: #eef0f5; }
.vinfo { min-width: 0; flex: 1; }
.vname { font-weight: 600; color: #2b3143; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vsub { font-size: 12px; }
.comment-dot { margin-left: 6px; color: #f56c6c; font-weight: 700; }
.vnote { margin-top: 8px; font-size: 12px; color: #606a7c; line-height: 1.5; white-space: pre-wrap; }
.vfix { margin-top: 8px; }
.vreason { font-size: 13px; color: #e6572b; font-weight: 600; }
.vtc { margin: 6px 0 0; padding-left: 18px; color: #9a5a2b; font-size: 12px; line-height: 1.6; }
.video-links { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; }
.vlink { margin-top: 0; }
.feedback-list { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.feedback-item { padding: 8px; border-radius: 8px; background: #f8f9fc; border: 1px solid #eef0f5; }
.feedback-meta { color: #8a93a6; font-size: 11px; }
.feedback-body { margin-top: 4px; color: #4f566b; white-space: pre-wrap; font-size: 12px; line-height: 1.5; }
.feedback-files { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.feedback-files a { color: #6254e8; font-size: 12px; text-decoration: none; }
/* 物流 */
.logi { display: flex; align-items: center; gap: 6px; margin-top: 8px; padding: 6px 10px; background: #f6f8fc;
  border-radius: 8px; font-size: 12px; color: #5a6072; }
.logi .ctx { flex: 1; min-width: 0; }
.logi .tm { color: #98a0b0; white-space: nowrap; }
.logi-empty { margin-top: 8px; font-size: 12px; color: #e6a23c; }
.logi-tl { margin-top: 8px; padding-left: 4px; }
.logi-actions { margin-top: 4px; display: flex; gap: 8px; }
/* 退出 */
.logout { width: 100%; background: #fff; color: #f56c6c; border: 1px solid #f6d3d3; border-radius: 12px;
  padding: 12px; font-size: 14px; cursor: pointer; }
.logout:hover { background: #fef4f4; }
</style>
