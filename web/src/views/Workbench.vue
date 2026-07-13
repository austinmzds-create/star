<template>
  <div v-if="data">
    <div class="hello">
      <h2>你好,{{ user.name }} 👋</h2>
      <p class="muted">{{ user.role === 'admin' ? '管理员' : '商务' }} · 今天有 {{ totalTodo }} 项待办</p>
    </div>

    <div class="section-title">今日待办</div>
    <div class="todo-grid">
      <div class="todo-card" :class="{ hot: data.todos.pending_sample }" @click="go('/samples', { tab: 'pending' })">
        <div class="n">{{ data.todos.pending_sample }}</div><div class="l">待审批寄样</div>
      </div>
      <div class="todo-card" :class="{ hot: data.todos.to_ship }" @click="go('/samples', { tab: 'approved' })">
        <div class="n">{{ data.todos.to_ship }}</div><div class="l">待发货</div>
      </div>
      <div class="todo-card" :class="{ hot: data.todos.pending_video }" @click="go('/videos', { main: 'video', tab: 'submitted' })">
        <div class="n">{{ data.todos.pending_video }}</div><div class="l">待审视频</div>
      </div>
      <div class="todo-card" :class="{ hot: data.todos.followup }" @click="go('/followups')">
        <div class="n">{{ data.todos.followup }}</div><div class="l">催拍待办</div>
      </div>
      <div class="todo-card" :class="{ hot: data.todos.pending_promotion }" @click="go('/videos', { main: 'promotion' })">
        <div class="n">{{ data.todos.pending_promotion }}</div><div class="l">待处理投流</div>
      </div>
    </div>

    <div class="section-title" style="margin-top: 24px">数据速览(近7天)</div>
    <div class="stat-grid">
      <div class="stat-card"><div class="n">{{ data.stats.influencer_total }}</div><div class="l">我的达人</div></div>
      <div class="stat-card"><div class="n">{{ data.stats.week_new }}</div><div class="l">本周新增达人</div></div>
      <div class="stat-card"><div class="n">{{ money(data.stats.week_gmv) }}</div><div class="l">本周产出GMV</div></div>
    </div>

    <div class="quick">
      <div class="section-title">快捷入口</div>
      <el-space wrap>
        <el-button @click="$router.push('/influencers')">达人库</el-button>
        <el-button @click="$router.push('/products')">产品中心</el-button>
        <el-button @click="$router.push('/block-records')">卡审知识库</el-button>
        <el-button v-if="user.role === 'admin'" @click="$router.push('/dashboard')">总览看板</el-button>
      </el-space>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'
import { money } from '../utils/format'

const router = useRouter()
const user = JSON.parse(localStorage.getItem('user') || '{}')
const data = ref(null)
const totalTodo = computed(() => data.value ? Object.values(data.value.todos).reduce((a, b) => a + (Number(b) || 0), 0) : 0)
const go = (path, query) => router.push({ path, query })

onMounted(async () => { data.value = await api.get('/api/dashboard/workbench') })
</script>

<style scoped>
.hello h2 { margin: 0 0 4px; }
.hello { margin-bottom: 24px; }
.todo-grid, .stat-grid { display: flex; gap: 14px; flex-wrap: wrap; }
.todo-card, .stat-card {
  background: #fff; border-radius: 14px; padding: 20px 26px; min-width: 130px;
  box-shadow: 0 2px 14px rgba(20,30,60,.05); cursor: pointer; transition: transform .12s;
}
.todo-card:hover { transform: translateY(-2px); }
.todo-card.hot { background: linear-gradient(135deg, #6b5cf6, #8b7cf9); color: #fff; }
.todo-card.hot .l { color: rgba(255,255,255,.85); }
.todo-card .n, .stat-card .n { font-size: 28px; font-weight: 700; }
.todo-card .l, .stat-card .l { font-size: 13px; color: #8a93a6; margin-top: 6px; }
.stat-card { cursor: default; }
.quick { margin-top: 28px; }
</style>
