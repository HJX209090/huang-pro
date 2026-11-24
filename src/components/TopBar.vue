<template>
  <header class="topbar">
    <div class="brand" @click="tapBrand">
      <img class="brand-mark" :src="brand" alt="" width="28" height="28" />
      <div class="brand-name">huang++<em>pro</em></div>
      <span class="chip" :class="store.licenseActive ? '' : 'warn'">{{ licenseText }}</span>
    </div>
    <div class="top-actions">
      <span class="chip warn">未发布 {{ store.unpublishedCount }}</span>
      <span class="chip">发布 {{ store.publishNo }} 号</span>
      <el-button size="small" @click="finish">我发完成</el-button>
      <el-button size="small" type="primary" plain @click="store.queueOpen = true">作品队列</el-button>
      <el-button size="small" @click="toggleLog">日志</el-button>
      <el-button size="small" @click="checkUpdate">检查更新</el-button>
      <el-button size="small" @click="openAnotherWindow">新窗口</el-button>
    </div>
  </header>

  <el-drawer v-model="store.queueOpen" title="作品队列" size="380px">
    <div v-if="!store.queueWorks.length" class="muted">队列是空的。去选品库勾选商品后生成。</div>
    <div v-for="work in store.queueWorks" :key="work.id" class="queue-item">
      <div class="toolbar" style="margin: 0">
        <strong>{{ work.title }}</strong>
        <el-tag size="small" :type="statusType(work.status)">{{ work.status }}</el-tag>
      </div>
      <div class="sub-line">{{ work.model }} · {{ work.duration ? `${work.duration} 秒` : '时长未填' }} · {{ work.ratio }}</div>
      <div v-if="work.confirmNote" class="sub-line">{{ work.confirmNote }}</div>
      <el-progress v-if="work.status === '生成中'" :percentage="work.progress" :stroke-width="8" style="margin-top: 8px" />
      <el-button v-if="work.status === '待生成'" link type="primary" @click="store.kickGenerate(work.id)">开始生成</el-button>
    </div>
  </el-drawer>

  <el-dialog v-model="adminVisible" title="进入管理" width="360px">
    <el-input v-model="adminPassword" type="password" show-password placeholder="输入管理密码" @keyup.enter="enterAdmin" />
    <template #footer>
      <el-button @click="adminVisible = false">取消</el-button>
      <el-button type="primary" :loading="adminLoading" @click="enterAdmin">进入</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAppStore } from '@/stores/app'
import brand from '@/assets/brand.png'
import { formatTime, statusType } from '@/utils/format'

const store = useAppStore()
const router = useRouter()
const adminVisible = ref(false)
const adminPassword = ref('')
const adminLoading = ref(false)
let taps = 0
let tapTimer = 0

function tapBrand() {
  taps += 1
  clearTimeout(tapTimer)
  tapTimer = setTimeout(() => {
    taps = 0
  }, 4000)
  if (taps < 6) return
  taps = 0
  adminPassword.value = ''
  adminVisible.value = true
}

function toggleLog() {
  window.dispatchEvent(new CustomEvent('huang-toggle-log'))
}

function checkUpdate() {
  window.dispatchEvent(new CustomEvent('huang-check-update'))
}

async function openAnotherWindow() {
  if (!window.tujian?.openAppWindow) return ElMessage.warning('请在桌面版里新开窗口')
  await window.tujian.openAppWindow()
}

async function enterAdmin() {
  adminLoading.value = true
  try {
    await store.unlockAdmin(adminPassword.value)
    adminVisible.value = false
    router.push('/license')
  } catch (error) {
    ElMessage.error(error.message || '没有进入管理')
  } finally {
    adminLoading.value = false
  }
}
const licenseText = computed(() => {
  if (!store.license) return '未授权'
  if (store.license.permanent) return '永久授权'
  if (!store.licenseActive) return '授权已过期'
  return `授权至 ${formatTime(store.license.expiresAt)}`
})

function finish() {
  const count = store.finishPublish()
  if (count) ElMessage.success(`已完成 ${count} 条发布中的作品`)
  else ElMessage.info('当前没有发布中的作品')
}
</script>
