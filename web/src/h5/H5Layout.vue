<template>
  <div class="h5-root" :class="deviceMode">
    <!-- 未登录:验证码进入 -->
    <H5Login v-if="!token" @logged-in="onLoggedIn" />

    <!-- 已登录:顶栏 + (手机底部 tab / 电脑左侧导航) + 内容 -->
    <template v-else>
      <header class="h5-top">
        <button class="dev-toggle" type="button" @click="toggleDeviceMode">
          <el-icon><Monitor v-if="deviceMode === 'mobile'" /><Iphone v-else /></el-icon>
          <span>{{ deviceMode === 'mobile' ? '电脑版' : '手机版' }}</span>
        </button>
        <div class="top-title">{{ activeLabel }}</div>
        <div class="top-spacer" />
      </header>

      <div class="h5-body">
        <nav v-if="deviceMode === 'desktop'" class="side-nav">
          <router-link v-for="t in TABS" :key="t.key" :to="t.path" class="side-item" :class="{ active: isActive(t) }">
            <el-icon><component :is="t.icon" /></el-icon><span>{{ t.label }}</span>
          </router-link>
        </nav>
        <main class="h5-content">
          <router-view />
        </main>
      </div>

      <nav v-if="deviceMode === 'mobile'" class="tabbar">
        <router-link v-for="t in TABS" :key="t.key" :to="t.path" class="tab-item" :class="{ active: isActive(t) }">
          <el-icon><component :is="t.icon" /></el-icon><span>{{ t.label }}</span>
        </router-link>
      </nav>
    </template>
  </div>
</template>

<script setup>
import { Goods, HomeFilled, Iphone, Monitor, User } from '@element-plus/icons-vue'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import H5Login from './H5Login.vue'
import { deviceMode, toggleDeviceMode } from './useDevice'
import { clearH5, h5store, loadH5 } from './store'

const TABS = [
  { key: 'home', path: '/h5', label: '首页', icon: HomeFilled },
  { key: 'products', path: '/h5/products', label: '产品', icon: Goods },
  { key: 'me', path: '/h5/me', label: '个人', icon: User },
]

const route = useRoute()
const router = useRouter()
const token = ref(localStorage.getItem('h5_token'))

const isActive = (t) => (t.path === '/h5' ? route.path === '/h5' : route.path.startsWith(t.path))
const activeLabel = computed(() => (TABS.find(isActive) || TABS[0]).label)

// 登录/退出通过全局事件同步 token(H5Login 与「个人」页退出都会派发)
function syncToken() {
  token.value = localStorage.getItem('h5_token')
  if (!token.value) clearH5()
}
onMounted(() => {
  window.addEventListener('role-session-changed', syncToken)
  if (token.value && !h5store.loaded) loadH5()
})
onUnmounted(() => window.removeEventListener('role-session-changed', syncToken))

async function onLoggedIn() {
  token.value = localStorage.getItem('h5_token')
  await loadH5()
  if (route.path !== '/h5') router.push('/h5')
}
</script>

<style scoped>
.h5-root { min-height: 100vh; background: #f5f6fa; }
/* 顶栏 */
.h5-top { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; height: 48px; padding: 0 12px;
  background: #fff; border-bottom: 1px solid #eef0f5; }
.top-title { flex: 1; text-align: center; font-weight: 600; font-size: 15px; color: #1f2430; }
.top-spacer, .dev-toggle { min-width: 78px; }
.dev-toggle { display: inline-flex; align-items: center; gap: 4px; border: 1px solid #e3e6ee; background: #fff;
  color: #6b5cf6; font-size: 12px; padding: 5px 9px; border-radius: 16px; cursor: pointer; }
.dev-toggle:hover { background: #f4f2ff; }

/* 手机版:窄居中,底部留出 tab 高度 */
.h5-root.mobile .h5-content { max-width: 480px; margin: 0 auto; padding: 12px 16px calc(64px + env(safe-area-inset-bottom)); }
.tabbar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; display: flex; background: #fff;
  border-top: 1px solid #eef0f5; padding-bottom: env(safe-area-inset-bottom); }
.tab-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 0;
  color: #9aa1b1; font-size: 11px; text-decoration: none; }
.tab-item .el-icon { font-size: 20px; }
.tab-item.active { color: #6b5cf6; }

/* 电脑版:左侧导航 + 宽内容 */
.h5-root.desktop .h5-body { display: flex; max-width: 1080px; margin: 0 auto; gap: 20px; padding: 20px; align-items: flex-start; }
.side-nav { position: sticky; top: 68px; width: 180px; flex-shrink: 0; background: #fff; border: 1px solid #eef0f5;
  border-radius: 12px; padding: 8px; }
.side-item { display: flex; align-items: center; gap: 10px; padding: 11px 12px; border-radius: 8px;
  color: #5a6072; text-decoration: none; font-size: 14px; }
.side-item .el-icon { font-size: 18px; }
.side-item:hover { background: #f6f7fb; }
.side-item.active { background: #f0edff; color: #6b5cf6; font-weight: 600; }
.h5-root.desktop .h5-content { flex: 1; min-width: 0; background: transparent; }
</style>
