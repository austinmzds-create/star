<!-- 多图上传:上传到 /api/upload,v-model 绑定 oss_key 数组 -->
<template>
  <div class="multi-upload">
    <div v-for="(k, i) in keys" :key="k" class="thumb">
      <img :src="urlOf(k)" />
      <el-icon class="del" @click="remove(i)"><Close /></el-icon>
    </div>
    <el-upload
      v-if="keys.length < max"
      :show-file-list="false"
      :before-upload="() => true"
      :http-request="doUpload"
      accept="image/*"
    >
      <div class="add"><el-icon><Plus /></el-icon></div>
    </el-upload>
  </div>
</template>

<script setup>
import { Close, Plus } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, reactive } from 'vue'
import api from '../api'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  max: { type: Number, default: 9 },
  prefix: { type: String, default: 'screenshots' },
})
const emit = defineEmits(['update:modelValue'])

const keys = computed(() => props.modelValue || [])
// 上传后记录 key→预览URL(OSS 走签名URL,本地走 /api/files);未知则回退本地代理
const previews = reactive({})
const urlOf = (k) => previews[k] || `/api/files/${k}`

async function doUpload({ file }) {
  const fd = new FormData()
  fd.append('file', file)
  const r = await api.post(`/api/upload?prefix=${props.prefix}`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  if (r.url) previews[r.key] = r.url
  emit('update:modelValue', [...keys.value, r.key])
  ElMessage.success('已上传')
}

function remove(i) {
  const next = [...keys.value]
  next.splice(i, 1)
  emit('update:modelValue', next)
}
</script>

<style scoped>
.multi-upload { display: flex; flex-wrap: wrap; gap: 8px; }
.thumb { position: relative; width: 72px; height: 72px; border-radius: 8px; overflow: hidden; border: 1px solid #eceef3; }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.del {
  position: absolute; top: 2px; right: 2px; background: rgba(0, 0, 0, 0.5);
  color: #fff; border-radius: 50%; padding: 2px; cursor: pointer; font-size: 12px;
}
.add {
  width: 72px; height: 72px; border: 1px dashed #cdd2de; border-radius: 8px;
  display: flex; align-items: center; justify-content: center; color: #b3bac9; cursor: pointer;
}
.add:hover { border-color: #6b5cf6; color: #6b5cf6; }
</style>
