<template>
  <div class="plist">
    <p class="hint">开放给你的产品，点进去看视频/文案素材、拍摄要求与寄样物流</p>
    <button v-for="p in products" :key="p.id" type="button" class="pcard" @click="open(p.id)">
      <el-image v-if="p.product_image" :src="p.product_image" fit="cover" class="pimg" />
      <div v-else class="pimg placeholder" />
      <div class="pmain">
        <div class="pname">{{ p.name }}</div>
        <div class="pmeta">
          <span v-if="p.price_text" class="price">{{ p.price_text }}</span>
          <span v-if="p.default_commission != null" class="comm">佣金 {{ p.default_commission }}%</span>
        </div>
        <div v-if="p.selling_points" class="pdesc">{{ p.selling_points }}</div>
      </div>
      <span class="arr">›</span>
    </button>
    <el-empty v-if="!products.length" description="暂无开放产品，完善资料后等待商务开通" :image-size="80" />
  </div>
</template>

<script setup>
import { onMounted, toRefs } from 'vue'
import { useRouter } from 'vue-router'
import { h5store, loadH5 } from './store'

const router = useRouter()
const { products } = toRefs(h5store)
const open = (id) => router.push(`/h5/products/${id}`)

onMounted(() => { if (!h5store.loaded) loadH5() })
</script>

<style scoped>
.plist { display: flex; flex-direction: column; gap: 10px; }
.hint { color: #8a93a6; font-size: 12px; margin: 2px 2px 4px; }
.pcard { display: flex; align-items: center; gap: 12px; width: 100%; background: #fff; border: none; border-radius: 14px;
  padding: 12px; text-align: left; cursor: pointer; box-shadow: 0 6px 18px rgba(24, 31, 67, 0.05); }
.pcard:hover { box-shadow: 0 8px 22px rgba(24, 31, 67, 0.1); }
.pimg { width: 72px; height: 72px; border-radius: 10px; flex-shrink: 0; }
.pimg.placeholder { background: #eef0f5; }
.pmain { min-width: 0; flex: 1; }
.pname { font-size: 16px; font-weight: 700; color: #1f2430; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pmeta { display: flex; align-items: center; gap: 8px; margin-top: 4px; font-size: 13px; }
.pmeta .price { color: #f56c6c; font-weight: 700; }
.pmeta .comm { color: #2f9f5b; font-weight: 600; }
.pdesc { margin-top: 6px; color: #6c7485; font-size: 12px; line-height: 1.45;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.arr { color: #b8bfcc; font-size: 26px; flex-shrink: 0; }
</style>
