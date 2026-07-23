<template>
  <div class="plist">
    <p class="hint">全部上架产品，点进去看视频/文案素材、拍摄要求与带货状态</p>
    <button v-for="p in products" :key="p.id" type="button" class="pcard" @click="open(p.id)">
      <el-image v-if="p.product_image" :src="p.product_image" fit="cover" class="pimg" />
      <div v-else class="pimg placeholder" />
      <span v-if="p.unread_badge" class="pb">{{ p.unread_badge }}</span>
      <div class="pmain">
        <div class="pname">{{ p.name }}</div>
        <div class="pmeta">
          <span v-if="p.price_text" class="price">{{ p.price_text }}</span>
          <span v-if="p.default_commission != null" class="comm">自然流 {{ p.default_commission }}%</span>
          <span v-if="p.merchant_promotion_commission != null" class="comm">投流 {{ p.merchant_promotion_commission }}%</span>
          <span v-if="p.cooperation_status" class="status" :class="p.cooperation_status">
            {{ statusLabel(p.cooperation_status) }}
          </span>
        </div>
        <div v-if="p.selling_points" class="pdesc">{{ p.selling_points }}</div>
      </div>
      <span class="arr">›</span>
    </button>
    <el-empty v-if="!products.length" description="暂无上架产品" :image-size="80" />
  </div>
</template>

<script setup>
import { onMounted, toRefs } from 'vue'
import { useRouter } from 'vue-router'
import { h5store, loadH5 } from './store'

const router = useRouter()
const { products } = toRefs(h5store)
const open = (id) => router.push(`/h5/products/${id}`)
const STATUS_LABEL = {
  pending: '审核中',
  approved: '待发货',
  rejected: '已拒绝',
  shipped: '已发货',
  in_transit: '运输中',
  signed: '已签收',
  cancelled: '已取消',
}
const statusLabel = (status) => STATUS_LABEL[status] || status

onMounted(() => { if (!h5store.loaded) loadH5() })
</script>

<style scoped>
.plist { display: flex; flex-direction: column; gap: 10px; }
.hint { color: #8a93a6; font-size: 12px; margin: 2px 2px 4px; }
.pcard { position: relative; display: flex; align-items: center; gap: 12px; width: 100%; background: #fff; border: none; border-radius: 14px;
  padding: 12px; text-align: left; cursor: pointer; box-shadow: 0 6px 18px rgba(24, 31, 67, 0.05); }
.pcard:hover { box-shadow: 0 8px 22px rgba(24, 31, 67, 0.1); }
.pimg { width: 72px; height: 72px; border-radius: 10px; flex-shrink: 0; }
.pimg.placeholder { background: #eef0f5; }
.pb {
  position: absolute;
  left: 72px;
  top: 8px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: #f56c6c;
  color: #fff;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
  font-weight: 700;
}
.pmain { min-width: 0; flex: 1; }
.pname { font-size: 16px; font-weight: 700; color: #1f2430; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pmeta { display: flex; align-items: center; gap: 8px; margin-top: 4px; font-size: 13px; flex-wrap: wrap; }
.pmeta .price { color: #f56c6c; font-weight: 700; }
.pmeta .comm { color: #2f9f5b; font-weight: 600; }
.pmeta .status { padding: 2px 6px; border-radius: 999px; background: #eef0f5; color: #606a7c; font-size: 12px; }
.pmeta .status.pending, .pmeta .status.approved { background: #fff4e5; color: #b36b00; }
.pmeta .status.shipped, .pmeta .status.in_transit { background: #ecf5ff; color: #337ecc; }
.pmeta .status.signed { background: #edf8f0; color: #2f9f5b; }
.pmeta .status.rejected { background: #fff0f0; color: #d93030; }
.pmeta .status.cancelled { background: #f4f5f8; color: #8a93a6; }
.pdesc { margin-top: 6px; color: #6c7485; font-size: 12px; line-height: 1.45;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.arr { color: #b8bfcc; font-size: 26px; flex-shrink: 0; }
</style>
