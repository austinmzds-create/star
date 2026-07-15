<template>
  <div>
    <el-radio-group v-model="days" @change="load" style="margin-bottom: 16px">
      <el-radio-button :value="7">近7天</el-radio-button>
      <el-radio-button :value="30">近30天</el-radio-button>
      <el-radio-button :value="0">全部</el-radio-button>
    </el-radio-group>

    <el-card header="按商务(维护达人 / 新增达人 / 寄样 / 视频 / GMV,点商务名查看其达人)">
      <el-table :data="byBd" v-loading="loading">
        <el-table-column label="商务" min-width="120">
          <template #default="{ row }">
            <router-link :to="{ path: '/influencers', query: { owner_bd_id: row.bd_id } }" class="link">{{ row.bd_name }}</router-link>
          </template>
        </el-table-column>
        <el-table-column prop="influencer_total" label="维护达人数" />
        <el-table-column prop="influencer_new" label="新增达人" />
        <el-table-column prop="sample_count" label="寄样" />
        <el-table-column prop="video_count" label="视频" />
        <el-table-column label="产出GMV(人工登记)">
          <template #default="{ row }">{{ money(row.gmv) }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && !byBd.length" description="暂无数据" :image-size="60" />
    </el-card>

    <el-card header="佣金档 / 等级分布(全部达人,不随时间范围变化)" style="margin-top: 16px">
      <el-space wrap>
        <el-statistic v-for="t in tiers.by_commission" :key="t.tier"
          :title="`佣金 ${t.tier}%`" :value="t.count" suffix="人" />
        <el-statistic v-for="l in tiers.by_level" :key="l.level"
          :title="l.level" :value="l.count" suffix="人" />
      </el-space>
      <el-empty v-if="!tiers.by_commission.length && !tiers.by_level.length" description="暂无达人" :image-size="60" />
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import api from '../api'
import { money } from '../utils/format'

const days = ref(30)
const byBd = ref([])
const tiers = ref({ by_commission: [], by_level: [] })
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const d = days.value || undefined
    const [nextByBd, nextTiers] = await Promise.all([
      api.get('/api/dashboard/by-bd', { params: { days: d } }),
      api.get('/api/dashboard/by-tier'),
    ])
    byBd.value = nextByBd
    tiers.value = nextTiers
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.link { color: #6b5cf6; text-decoration: none; font-weight: 500; }
.link:hover { text-decoration: underline; }
</style>
