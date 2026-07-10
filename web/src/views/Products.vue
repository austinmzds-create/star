<template>
  <div>
    <el-card header="产品中心">
      <el-table :data="rows">
        <el-table-column prop="name" label="产品" />
        <el-table-column prop="shop_name" label="店铺" />
        <el-table-column prop="price_text" label="价格" width="100" />
        <el-table-column prop="material_count" label="素材数" width="90" />
        <el-table-column prop="status" label="状态" width="80" />
      </el-table>
      <p style="color: #909399">
        每个产品挂五类素材:AI生成视频 / 爆款参考(丢抖音链接自动转存+解析)/ 达人成片 /
        图片 / 质检PDF(含报告ID)+ 卖点文案。达人 H5 只见被开放的产品,下载留痕。
      </p>
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import api from '../api'

const rows = ref([])
onMounted(async () => { rows.value = await api.get('/api/products') })
</script>
