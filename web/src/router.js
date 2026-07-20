import { createRouter, createWebHistory } from 'vue-router'

// 路由级懒加载:各页面拆成独立 chunk,按需加载。首屏只下载入口 + 命中页面的 chunk,
// 内部端与 H5 端互不牵连(达人不必下载后台管理代码,反之亦然)。
// 登录页保持同步,保证落地首屏即时可见。
import Login from './views/Login.vue'

const routes = [
  { path: '/login', component: Login },
  {
    path: '/',
    component: () => import('./views/AdminLayout.vue'),
    children: [
      { path: '', redirect: '/workbench' },
      { path: 'workbench', component: () => import('./views/Workbench.vue') },
      { path: 'influencers', component: () => import('./views/Influencers.vue') },
      { path: 'influencers/:id', component: () => import('./views/InfluencerDetail.vue') },
      { path: 'samples', component: () => import('./views/Samples.vue') },
      { path: 'followups', component: () => import('./views/Followups.vue') },
      { path: 'videos', component: () => import('./views/Videos.vue') },
      { path: 'products', component: () => import('./views/Products.vue') },
      { path: 'block-records', component: () => import('./views/BlockRecords.vue') },
      { path: 'connections', component: () => import('./views/ConnectionRequests.vue'), meta: { adminOnly: true } },
      { path: 'dashboard', component: () => import('./views/Dashboard.vue'), meta: { adminOnly: true } },
      { path: 'settings', component: () => import('./views/Settings.vue'), meta: { adminOnly: true } },
    ],
  },
  // 达人 H5:底部 tab(首页/产品/个人),布局内嵌登录门禁与手机/电脑切换
  {
    path: '/h5',
    component: () => import('./h5/H5Layout.vue'),
    children: [
      { path: '', component: () => import('./h5/Home.vue') },
      { path: 'products', component: () => import('./h5/ProductList.vue') },
      { path: 'me', component: () => import('./h5/Me.vue') },
    ],
  },
  // 详情类页面(全屏,自带返回):产品资料中心 / 拍摄前必读
  { path: '/h5/products/:id', component: () => import('./h5/Materials.vue') },
  { path: '/h5/notice', component: () => import('./h5/Notice.vue') },
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
