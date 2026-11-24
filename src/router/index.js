import { createRouter, createWebHashHistory } from 'vue-router'
import { useAppStore } from '@/stores/app'

const routes = [
  { path: '/', redirect: '/dashboard' },
  { path: '/dashboard', component: () => import('@/views/Dashboard.vue') },
  { path: '/messages', component: () => import('@/views/Messages.vue') },
  { path: '/works', component: () => import('@/views/Works.vue') },
  { path: '/workbench', component: () => import('@/views/Workbench.vue') },
  { path: '/plaza', component: () => import('@/views/Plaza.vue') },
  { path: '/products', component: () => import('@/views/Products.vue') },
  { path: '/digital', component: () => import('@/views/DigitalHuman.vue') },
  { path: '/doubao', component: () => import('@/views/Doubao.vue') },
  { path: '/publish', component: () => import('@/views/Publish.vue') },
  { path: '/rpa', component: () => import('@/views/Rpa.vue') },
  { path: '/schedules', component: () => import('@/views/Schedules.vue') },
  { path: '/tasks', component: () => import('@/views/Tasks.vue') },
  { path: '/toolbox', component: () => import('@/views/Toolbox.vue') },
  { path: '/remix', component: () => import('@/views/Remix.vue') },
  { path: '/browser', component: () => import('@/views/BrowserEnv.vue') },
  { path: '/proxy', component: () => import('@/views/Proxy.vue') },
  { path: '/logs', component: () => import('@/views/Logs.vue') },
  { path: '/settings', component: () => import('@/views/Settings.vue') },
  { path: '/account', component: () => import('@/views/Account.vue') },
  { path: '/license', component: () => import('@/views/License.vue') }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

router.beforeEach((to) => {
  const store = useAppStore()
  if (!store.ready) return true
  if (['/license', '/browser', '/proxy', '/rpa'].includes(to.path) && !store.adminMode) return store.licenseActive ? '/dashboard' : '/account'
  if (!store.licenseActive && to.path !== '/account' && !(store.adminMode && to.path === '/license')) return '/account'
  return true
})

export default router
