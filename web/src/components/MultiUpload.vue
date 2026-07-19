<!-- 多图上传:上传到 /api/upload,v-model 绑定 oss_key 数组 -->
<template>
  <div class="multi-upload">
    <div v-for="(k, i) in keys" :key="k" class="thumb">
      <img :src="urlOf(k)" />
      <el-icon class="del" @click="remove(i)"><Close /></el-icon>
    </div>
    <!-- 上传中:占位显示进度;空闲:透明原生 input 盖在「+」上,点击直接弹出选择框 -->
    <div v-if="uploading" class="add uploading">
      <el-icon class="spin"><Loading /></el-icon>
      <span class="pct">{{ uploadProgress }}%</span>
    </div>
    <div v-else-if="keys.length < max" class="add">
      <el-icon><Plus /></el-icon>
      <input class="file-overlay-input" type="file" accept="image/*" @change="onPick" />
    </div>
  </div>
</template>

<script setup>
import { Close, Loading, Plus } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, reactive, ref, watch } from 'vue'
import api from '../api'
import { uploadMaterialFile } from '../services/materialUpload'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  max: { type: Number, default: 9 },
  prefix: { type: String, default: 'screenshots' },
  // 编辑已存在数据时:传入 {oss_key: 签名URL} 让旧图正常预览(OSS 场景必需)
  initialPreviews: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:modelValue'])

const keys = computed(() => props.modelValue || [])
// 上传后记录 key→预览URL(OSS 走签名URL,本地走 /api/files);未知则回退本地代理
const previews = reactive({ ...props.initialPreviews })
function mergePreviews(incoming = {}) {
  for (const [key, url] of Object.entries(incoming)) {
    if (url) previews[key] = url
  }
}
watch(() => props.initialPreviews, mergePreviews)
const urlOf = (k) => previews[k] || `/api/files/${k}`

const uploading = ref(false)
const uploadProgress = ref(0)

async function onPick(event) {
  const file = event.target.files?.[0]
  event.target.value = ''            // 清空以便重复选同一文件也能触发 change
  if (!file || uploading.value) return
  uploading.value = true
  uploadProgress.value = 0
  try {
    // 与素材一致:优先直传 OSS(大图分片并行),卡住/不可用回退后端中转
    const r = await uploadMaterialFile(api, file, (percent) => { uploadProgress.value = percent }, {
      direct: true, allowBackendFallback: true, prefix: props.prefix,
    })
    if (r.url) previews[r.key] = r.url
    emit('update:modelValue', [...keys.value, r.key])
    ElMessage.success('已上传')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || e.message || '上传失败,请重试')
  } finally {
    uploading.value = false
  }
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
  position: relative;
  width: 72px; height: 72px; border: 1px dashed #cdd2de; border-radius: 8px;
  display: flex; align-items: center; justify-content: center; color: #b3bac9; cursor: pointer;
}
.add:hover { border-color: #6b5cf6; color: #6b5cf6; }
.add.uploading { flex-direction: column; gap: 2px; border-color: #6b5cf6; color: #6b5cf6; cursor: default; }
.add.uploading .pct { font-size: 12px; }
.add .spin { animation: mu-spin 0.9s linear infinite; }
@keyframes mu-spin { to { transform: rotate(360deg); } }
.file-overlay-input {
  position: absolute; inset: 0; width: 100%; height: 100%;
  opacity: 0; cursor: pointer; font-size: 0;
}
</style>
