// 达人 H5 共享数据:多个 tab 复用同一份 me/products/videos,避免各自重复拉取。
import { reactive } from 'vue'
import api from '../api'

export const h5store = reactive({
  me: null,
  products: [],
  videos: [],
  loaded: false,
  loading: false,
})

// 拉全量(登录后 / 首次进入)。三个接口互不依赖,并行拉取。
export async function loadH5() {
  h5store.loading = true
  try {
    const [me, products, videos] = await Promise.all([
      api.get('/api/h5/me'),
      api.get('/api/h5/products'),
      api.get('/api/h5/videos'),
    ])
    h5store.me = me
    h5store.products = products
    h5store.videos = videos
    h5store.loaded = true
  } finally {
    h5store.loading = false
  }
}

// 只刷新档案 + 寄样(改资料 / 刷新物流后用)
export async function refreshMe() {
  h5store.me = await api.get('/api/h5/me')
}

// 只刷新视频(审核状态变化后用)
export async function refreshVideos() {
  h5store.videos = await api.get('/api/h5/videos')
}

export async function refreshProducts() {
  h5store.products = await api.get('/api/h5/products')
}

export function clearH5() {
  h5store.me = null
  h5store.products = []
  h5store.videos = []
  h5store.loaded = false
}
