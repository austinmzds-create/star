<template>
  <TestRoleSwitcher v-if="isDev" />
  <router-view />
</template>

<script setup>
import TestRoleSwitcher from './components/TestRoleSwitcher.vue'

const isDev = import.meta.env.DEV
</script>

<style>
body { margin: 0; background: #f5f7fa; }
</style>
