import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  build: {
    rollupOptions: {
      output: {
        // 把体积大且低频变动的第三方库拆成独立 vendor chunk:
        // 业务代码发版时不必让用户重新下载 element-plus / vue(命中长期缓存)。
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('element-plus') || id.includes('@element-plus')) return 'element-plus'
          if (id.includes('/@vue/') || id.includes('/vue/') || id.includes('/vue-router/')
              || id.includes('/vue-demi/') || id.includes('/@vue')) return 'vue'
          return 'vendor'
        },
      },
    },
  },
})
