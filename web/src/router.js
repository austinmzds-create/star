import { createRouter, createWebHistory } from 'vue-router'

// 内部端(管理员/商务)
import AdminLayout from './views/AdminLayout.vue'
import BlockRecords from './views/BlockRecords.vue'
import ConnectionRequests from './views/ConnectionRequests.vue'
import Dashboard from './views/Dashboard.vue'
import Followups from './views/Followups.vue'
import InfluencerDetail from './views/InfluencerDetail.vue'
import Influencers from './views/Influencers.vue'
import Login from './views/Login.vue'
import Products from './views/Products.vue'
import Samples from './views/Samples.vue'
import Settings from './views/Settings.vue'
import Videos from './views/Videos.vue'
import Workbench from './views/Workbench.vue'

// 达人端 H5(task.jisheng.yun)
import H5Layout from './h5/H5Layout.vue'
import H5Home from './h5/Home.vue'
import H5ProductList from './h5/ProductList.vue'
import H5Me from './h5/Me.vue'
import H5Materials from './h5/Materials.vue'
import H5Notice from './h5/Notice.vue'

const routes = [
  { path: '/login', component: Login },
  {
    path: '/',
    component: AdminLayout,
    children: [
      { path: '', redirect: '/workbench' },
      { path: 'workbench', component: Workbench },
      { path: 'influencers', component: Influencers },
      { path: 'influencers/:id', component: InfluencerDetail },
      { path: 'samples', component: Samples },
      { path: 'followups', component: Followups },
      { path: 'videos', component: Videos },
      { path: 'products', component: Products },
      { path: 'block-records', component: BlockRecords },
      { path: 'connections', component: ConnectionRequests, meta: { adminOnly: true } },
      { path: 'dashboard', component: Dashboard, meta: { adminOnly: true } },
      { path: 'settings', component: Settings, meta: { adminOnly: true } },
    ],
  },
  // 达人 H5:底部 tab(首页/产品/个人),布局内嵌登录门禁与手机/电脑切换
  {
    path: '/h5',
    component: H5Layout,
    children: [
      { path: '', component: H5Home },
      { path: 'products', component: H5ProductList },
      { path: 'me', component: H5Me },
    ],
  },
  // 详情类页面(全屏,自带返回):产品资料中心 / 拍摄前必读
  { path: '/h5/products/:id', component: H5Materials },
  { path: '/h5/notice', component: H5Notice },
]

const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach((to) => {
  const isH5 = to.path.startsWith('/h5')
  if (isH5) return true
  if (to.path === '/login') return true
  const token = localStorage.getItem('token')
  if (!token) return '/login'
  // 达人不得进入内部端页面
  const user = JSON.parse(localStorage.getItem('user') || '{}')
  if (user.role === 'influencer') return '/h5'
  // 仅管理员页面(配置中心 / 全员看板):商务不可进
  if (to.meta?.adminOnly && user.role !== 'admin') return '/workbench'
})

export default router
