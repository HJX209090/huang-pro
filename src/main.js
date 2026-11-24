import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as Icons from '@element-plus/icons-vue'
import 'element-plus/dist/index.css'
import '@/styles/global.css'
import App from './App.vue'
import router from './router'
import { useAppStore } from '@/stores/app'
import { onCatalogPage, onTaskProgress } from '@/services/bridge'
import { installActivityLog } from '@/services/activityLog'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)
app.use(ElementPlus, { locale: zhCn })

for (const [name, component] of Object.entries(Icons)) {
  app.component(name, component)
}

const store = useAppStore()
onTaskProgress((payload) => store.applyProgress(payload))
onCatalogPage((payload) => store.mergePlazaPage(payload))
installActivityLog()
store.hydrate().finally(() => {
  app.mount('#app')
  setInterval(() => {
    store.refreshClock().catch(() => {}).finally(() => store.runDueSchedules())
  }, 10000)
})
