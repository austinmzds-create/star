<template>
  <div>
    <el-radio-group v-model="days" @change="load" style="margin-bottom: 16px">
      <el-radio-button :value="7">近7天</el-radio-button>
      <el-radio-button :value="30">近30天</el-radio-button>
      <el-radio-button :value="0">全部</el-radio-button>
    </el-radio-group>

    <el-card header="按商务(维护达人 / 新增达人 / 寄样 / 视频 / GMV)">
      <el-table :data="byBd">
        <el-table-column prop="bd_name" label="商务" />
        <el-table-column prop="influencer_total" label="维护达人数" />
        <el-table-column prop="influencer_new" label="新增达人" />
        <el-table-column prop="sample_count" label="寄样" />
        <el-table-column prop="video_count" label="视频" />
        <el-table-column prop="gmv" label="产出GMV(人工登记)" />
      </el-table>
    </el-card>

    <el-card header="佣金档 / 等级分布" style="margin-top: 16px">
      <el-space wrap>
        <el-statistic v-for="t in tiers.by_commission" :key="t.tier"
          :title="`佣金 ${t.tier}%`" :value="t.count" suffix="人" />
        <el-statistic v-for="l in tiers.by_level" :key="l.level"
          :title="l.level" :value="l.count" suffix="人" />
      </el-space>
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import api from '../api'

const days = ref(30)
const byBd = ref([])
const tiers = ref({ by_commission: [], by_level: [] })

async function load() {
  const d = days.value || undefined
  byBd.value = await api.get('/api/dashboard/by-bd', { params: { days: d } })
  tiers.value = await api.get('/api/dashboard/by-tier')
}

onMounted(load)
</script>
