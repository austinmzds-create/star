import { createRouter, createWebHistory } from 'vue-router'

// 内部端(管理员/商务)
import AdminLayout from './views/AdminLayout.vue'
import Dashboard from './views/Dashboard.vue'
import InfluencerDetail from './views/InfluencerDetail.vue'
import Influencers from './views/Influencers.vue'
import Login from './views/Login.vue'
import Products from './views/Products.vue'
import Samples from './views/Samples.vue'
import Settings from './views/Settings.vue'

// 达人端 H5(task.jisheng.yun)
import H5Entry from './h5/Entry.vue'
import H5Materials from './h5/Materials.vue'

const routes = [
  { path: '/login', component: Login },
  {
    path: '/',
    component: AdminLayout,
    children: [
      { path: '', redirect: '/influencers' },
      { path: 'influencers', component: Influencers },
      { path: 'influencers/:id', component: InfluencerDetail },
      { path: 'samples', component: Samples },
      { path: 'products', component: Products },
      { path: 'dashboard', component: Dashboard },
      { path: 'settings', component: Settings },
    ],
  },
  // 达人 H5:发朋友圈的入口
  { path: '/h5', component: H5Entry },
  { path: '/h5/products/:id', component: H5Materials },
]

const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach((to) => {
  const isH5 = to.path.startsWith('/h5')
  const token = localStorage.getItem(isH5 ? 'h5_token' : 'token')
  if (!isH5 && to.path !== '/login' && !token) return '/login'
})

export default router
