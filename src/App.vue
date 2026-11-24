<template>
  <el-config-provider :locale="zhCn">
    <div v-if="booting" class="boot">
      <div class="boot-card">
        <div class="boot-mark">huang++<em>pro</em></div>
        <p>{{ store.apiError || '正在加载' }}</p>
        <el-progress :percentage="bootProgress" :stroke-width="8" :show-text="false" />
      </div>
    </div>
    <div v-else-if="store.user && store.userStatus === '停用'" class="boot">
      <div class="boot-card">
        <div class="boot-mark">huang++<em>pro</em></div>
        <p>这个账号已停用。请让管理员在软件管理里改回正常。</p>
      </div>
    </div>
    <div v-else-if="store.user && !store.license?.unlocked" class="boot">
      <div class="boot-card">
        <div class="boot-mark">huang++<em>pro</em></div>
        <p>请填写授权码</p>
        <el-input v-model="authCode" placeholder="授权码" @keyup.enter="submitCode" />
        <el-button type="primary" style="margin-top: 12px" :loading="activating" @click="submitCode">进入</el-button>
        <p v-if="codeError" style="color: #cf1322">{{ codeError }}</p>
      </div>
    </div>
    <div v-else-if="store.user" class="shell">
      <TopBar />
      <div class="shell-body">
        <SideNav />
        <main class="shell-main">
          <router-view v-slot="{ Component }">
            <keep-alive :max="12">
              <component :is="Component" />
            </keep-alive>
          </router-view>
        </main>
      </div>
      <LogFloat />
    </div>
    <div v-else class="boot">{{ store.apiError || '正在打开…' }}</div>
    <PromptDialog />
    <UpdateOverlay ref="updateOverlay" />
    <el-dialog
      :model-value="Boolean(store.doneNotice)"
      title="生成完成"
      width="420px"
      align-center
      append-to-body
      @close="closeDone"
    >
      <p>{{ store.doneNotice }}</p>
      <template #footer>
        <el-button type="primary" @click="closeDone">我知道了（{{ doneLeft }}秒关闭）</el-button>
      </template>
    </el-dialog>
  </el-config-provider>
</template>

<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { useAppStore } from '@/stores/app'
import TopBar from '@/components/TopBar.vue'
import SideNav from '@/components/SideNav.vue'
import PromptDialog from '@/components/PromptDialog.vue'
import LogFloat from '@/components/LogFloat.vue'
import UpdateOverlay from '@/components/UpdateOverlay.vue'

const store = useAppStore()
const booting = ref(true)
const bootProgress = ref(6)
const doneLeft = ref(5)
const authCode = ref('')
const activating = ref(false)
const codeError = ref('')
const updateOverlay = ref(null)
let doneTimer = 0

function onManualUpdate() {
  updateOverlay.value?.showManual?.()
}

async function submitCode() {
  const code = authCode.value.trim()
  if (!code) {
    codeError.value = '请填写授权码'
    return
  }
  activating.value = true
  codeError.value = ''
  try {
    await store.activateLicense(code)
  } catch (error) {
    codeError.value = error.message || '授权码不正确'
  } finally {
    activating.value = false
  }
}

onMounted(() => {
  window.addEventListener('huang-check-update', onManualUpdate)
  const timer = setInterval(() => {
    if (!store.user) {
      if (bootProgress.value < 92) bootProgress.value += 3
      return
    }
    bootProgress.value = Math.min(100, bootProgress.value + 8)
    if (bootProgress.value < 100) return
    clearInterval(timer)
    setTimeout(() => { booting.value = false }, 320)
  }, 90)
})

onUnmounted(() => {
  window.removeEventListener('huang-check-update', onManualUpdate)
})

function closeDone() {
  clearInterval(doneTimer)
  store.doneNotice = ''
}

watch(() => store.doneNotice, (text) => {
  clearInterval(doneTimer)
  if (!text) return
  doneLeft.value = 5
  doneTimer = setInterval(() => {
    doneLeft.value -= 1
    if (doneLeft.value <= 0) closeDone()
  }, 1000)
})
</script>
