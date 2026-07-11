<!-- 可复制文本:显示值 + 复制图标,点击复制到剪贴板(商务往千川/百应粘) -->
<template>
  <span class="copy-text" :class="{ block }">
    <span v-if="label" class="ct-label">{{ label }}</span>
    <span class="ct-value" :title="value">{{ value || '—' }}</span>
    <el-icon v-if="value" class="ct-icon" @click.stop="copy"><DocumentCopy /></el-icon>
  </span>
</template>

<script setup>
import { DocumentCopy } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

const props = defineProps({
  value: { type: [String, Number], default: '' },
  label: { type: String, default: '' },
  block: { type: Boolean, default: false }, // 块级(label 左、value 右、图标末尾)
})

async function copy() {
  try {
    await navigator.clipboard.writeText(String(props.value))
    ElMessage.success('已复制')
  } catch {
    // 兼容非 https / 老浏览器
    const ta = document.createElement('textarea')
    ta.value = String(props.value)
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    ElMessage.success('已复制')
  }
}
</script>

<style scoped>
.copy-text { display: inline-flex; align-items: center; gap: 6px; }
.copy-text.block { display: flex; width: 100%; }
.ct-label { color: #8a93a6; font-size: 13px; min-width: 64px; }
.ct-value { color: #1f2637; word-break: break-all; }
.copy-text.block .ct-value { flex: 1; }
.ct-icon { color: #b3bac9; cursor: pointer; transition: color 0.15s; }
.ct-icon:hover { color: #6b5cf6; }
</style>
