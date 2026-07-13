<template>
  <div v-if="me" class="home">
    <!-- 资料卡:等级/佣金 高亮,身份信息一键复制 -->
    <section class="card profile">
      <div class="p-head">
        <div class="avatar">{{ (me.nickname || '达')[0] }}</div>
        <div class="p-id">
          <div class="p-name">{{ me.nickname || '达人' }}</div>
          <div class="p-badges">
            <span class="lv">{{ me.level || 'L1' }}</span>
            <span v-if="me.commission_tier != null" class="comm">佣金 {{ me.commission_tier }}%</span>
          </div>
        </div>
      </div>
      <div class="p-grid">
        <button class="p-cell" type="button" @click="copy(me.douyin_id)">
          <span class="k">抖音号</span><span class="v">{{ me.douyin_id || '—' }}</span>
          <el-icon v-if="me.douyin_id" class="cp"><CopyDocument /></el-icon>
        </button>
        <button class="p-cell" type="button" @click="copy(me.cooperation_code)">
          <span class="k">合作码</span><span class="v">{{ me.cooperation_code || '—' }}</span>
          <el-icon v-if="me.cooperation_code" class="cp"><CopyDocument /></el-icon>
        </button>
        <div class="p-cell wide">
          <span class="k">收件人</span><span class="v">{{ me.real_name || '—' }} <span class="muted">{{ me.phone || '' }}</span></span>
        </div>
        <div class="p-cell wide">
          <span class="k">收件地址</span><span class="v">{{ me.default_address || '—' }}</span>
        </div>
      </div>
    </section>

    <!-- 数据概览:点进对应 tab -->
    <section class="stats">
      <router-link to="/h5/products" class="stat">
        <div class="num">{{ products.length }}</div><div class="lbl">开放产品</div>
      </router-link>
      <router-link to="/h5/me" class="stat">
        <div class="num">{{ me.samples.length }}</div><div class="lbl">我的寄样</div>
      </router-link>
      <router-link to="/h5/me" class="stat">
        <div class="num" :class="{ warn: videoNeedFix > 0 }">{{ videos.length }}</div>
        <div class="lbl">我的视频<span v-if="videoNeedFix > 0" class="dot">{{ videoNeedFix }}待改</span></div>
      </router-link>
    </section>

    <button class="notice-entry" type="button" @click="$router.push('/h5/notice')">
      <span>📌 拍摄前必读（卡审避坑）</span><span class="arr">›</span>
    </button>

    <el-empty v-if="!products.length" description="暂无开放产品，完善资料后等待商务开通" :image-size="70" />
  </div>
  <el-empty v-else description="加载中…" :image-size="70" />
</template>

<script setup>
import { CopyDocument } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, onMounted, toRefs } from 'vue'
import { h5store, loadH5 } from './store'

const { me, products, videos } = toRefs(h5store)
const videoNeedFix = computed(() => (videos.value || []).filter((v) => v.need_fix).length)

async function copy(t) {
  if (!t) return
  try { await navigator.clipboard.writeText(String(t)); ElMessage.success('已复制') } catch { ElMessage.info('请长按复制') }
}

onMounted(() => { if (!h5store.loaded) loadH5() })
</script>

<style scoped>
.home { display: flex; flex-direction: column; gap: 14px; }
.card { background: #fff; border-radius: 14px; padding: 16px; box-shadow: 0 6px 18px rgba(24, 31, 67, 0.05); }
/* 资料卡 */
.p-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.avatar { width: 46px; height: 46px; border-radius: 13px; background: linear-gradient(135deg, #6b5cf6, #8b7cf9);
  color: #fff; font-size: 20px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.p-name { font-size: 17px; font-weight: 700; color: #1f2430; }
.p-badges { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.p-badges .lv { background: #fff4e6; color: #e6912b; font-weight: 700; font-size: 12px; padding: 2px 8px; border-radius: 6px; }
.p-badges .comm { color: #2f9f5b; font-weight: 700; font-size: 13px; }
.p-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.p-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; position: relative;
  background: #f7f8fc; border: none; border-radius: 10px; padding: 9px 11px; text-align: left; width: 100%; cursor: default; }
.p-cell.wide { grid-column: 1 / -1; }
.p-cell .k { color: #9aa1b1; font-size: 11px; }
.p-cell .v { color: #2b3143; font-size: 14px; font-weight: 500; word-break: break-all; }
.p-cell .muted { color: #9aa1b1; font-weight: 400; }
button.p-cell { cursor: pointer; }
button.p-cell:hover { background: #f1f0fb; }
.p-cell .cp { position: absolute; top: 9px; right: 9px; color: #b8bfcc; font-size: 14px; }
/* 概览 */
.stats { display: flex; gap: 10px; }
.stat { flex: 1; background: #fff; border-radius: 12px; padding: 14px 8px; text-align: center; text-decoration: none;
  box-shadow: 0 6px 18px rgba(24, 31, 67, 0.05); }
.stat .num { font-size: 22px; font-weight: 700; color: #1f2430; }
.stat .num.warn { color: #e6a23c; }
.stat .lbl { font-size: 12px; color: #8a93a6; margin-top: 2px; }
.stat .dot { display: block; color: #e6a23c; font-size: 11px; margin-top: 1px; }
/* 拍摄前必读 */
.notice-entry { display: flex; align-items: center; justify-content: space-between; width: 100%;
  background: #fff7e8; color: #b9731a; border: 1px solid #ffe4b8; border-radius: 12px; padding: 14px 16px;
  font-size: 14px; font-weight: 600; cursor: pointer; }
.notice-entry .arr { font-size: 20px; color: #d9a45b; }
</style>
