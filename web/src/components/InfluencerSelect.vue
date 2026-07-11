<!-- 达人选择器:输入昵称/抖音号/手机号模糊搜索,选中回填 {id, name} -->
<template>
  <el-select
    v-model="inner"
    filterable
    remote
    reserve-keyword
    :remote-method="search"
    :loading="loading"
    placeholder="搜索达人昵称 / 抖音号 / 手机号"
    style="width: 100%"
    @change="onChange"
  >
    <el-option
      v-for="o in options"
      :key="o.id"
      :label="`${o.nickname}${o.douyin_id ? ' · ' + o.douyin_id : ''}`"
      :value="o.id"
    />
  </el-select>
</template>

<script setup>
import { ref, watch } from 'vue'
import api from '../api'

const props = defineProps({ modelValue: { type: [Number, null], default: null } })
const emit = defineEmits(['update:modelValue', 'selected'])

const inner = ref(props.modelValue)
const options = ref([])
const loading = ref(false)

watch(() => props.modelValue, (v) => { inner.value = v })

async function search(q) {
  if (!q) { options.value = []; return }
  loading.value = true
  try {
    const data = await api.get('/api/influencers', { params: { q, page_size: 20 } })
    options.value = data.items || []
  } finally {
    loading.value = false
  }
}

function onChange(id) {
  emit('update:modelValue', id)
  const picked = options.value.find((o) => o.id === id)
  emit('selected', picked ? { id: picked.id, name: picked.nickname } : null)
}
</script>
