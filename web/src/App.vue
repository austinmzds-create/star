<template>
  <TestRoleSwitcher v-if="showRoleSwitcher" />
  <router-view />
</template>

<script setup>
import TestRoleSwitcher from './components/TestRoleSwitcher.vue'

const showRoleSwitcher = import.meta.env.DEV || import.meta.env.VITE_ENABLE_TEST_ROLE_SWITCHER === 'true'
</script>

<style>
body { margin: 0; background: #f5f7fa; }
</style>
