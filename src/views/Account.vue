<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>账户</h1>
        <p>填写这个软件当前是谁在用。授权码在第一次进入时填写，这里不再显示。</p>
      </div>
    </div>
    <div class="stat-grid">
      <div class="stat-card">
        <span>授权状态</span>
        <strong style="font-size: 22px">{{ statusText }}</strong>
      </div>
      <div class="stat-card"><span>发布序号</span><strong>{{ store.publishNo }}</strong></div>
      <div class="stat-card"><span>版本</span><strong style="font-size: 22px">{{ info.version }}</strong></div>
    </div>
    <div class="panel">
      <el-alert v-if="store.apiError" :title="store.apiError" type="error" show-icon :closable="false" style="margin-bottom: 12px" />
      <div class="filters" style="margin-bottom: 12px">
        <span class="muted">使用用户</span>
        <el-input v-model="displayName" placeholder="填写使用人" style="width: 220px" />
        <el-button type="primary" :loading="savingName" @click="saveName">保存</el-button>
      </div>
      <p>系统时间：{{ store.systemNow ? formatTime(store.systemNow) : '读取中' }}</p>
      <div class="filters" style="margin-top: 12px">
        <span class="muted">数据位置</span>
        <el-input v-model="dataDir" placeholder="选择本机文件夹" />
        <el-button @click="chooseDataDir">选择目录</el-button>
        <el-button type="primary" :loading="moving" @click="saveDataDir">更改并重启</el-button>
      </div>
      <p class="muted">更改后，选品、作品、账号和登录会话会改存到新位置，软件会重新打开。</p>
      <el-button type="danger" plain @click="reset">清空业务数据</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAppStore } from '@/stores/app'
import { getInfo } from '@/services/bridge'
import { formatTime } from '@/utils/format'

const store = useAppStore()
const info = reactive({ userData: '读取中…', version: '0.1.0', platform: '', packaged: false })
const dataDir = ref('')
const displayName = ref('')
const moving = ref(false)
const savingName = ref(false)
const statusText = computed(() => {
  if (!store.license) return '未授权'
  if (store.license.permanent) return '永久'
  if (!store.licenseActive) return '已过期'
  return store.license.label
})

onMounted(async () => {
  Object.assign(info, await getInfo())
  dataDir.value = info.userData
  displayName.value = store.displayName || ''
})

async function saveName() {
  const name = displayName.value.trim()
  if (!name) return ElMessage.warning('请填写使用用户')
  savingName.value = true
  try {
    await store.saveDisplayName(name)
    ElMessage.success('使用用户已保存')
  } catch (error) {
    ElMessage.error(error.message || '没有保存')
  } finally {
    savingName.value = false
  }
}

async function chooseDataDir() {
  if (!window.tujian?.pickDirectory) return ElMessage.info('请在桌面窗口里选择数据位置')
  const dir = await window.tujian.pickDirectory()
  if (dir) dataDir.value = dir
}

async function saveDataDir() {
  const dir = dataDir.value.trim()
  if (!dir) return ElMessage.warning('先选择数据位置')
  if (!window.tujian?.moveDataDir) return ElMessage.info('请在桌面窗口里更改数据位置')
  if (dir === info.userData) return ElMessage.info('已经是这个位置')
  try {
    await ElMessageBox.confirm('数据会复制到新位置，然后软件重新打开。', '更改数据位置', { type: 'warning' })
  } catch { return }
  moving.value = true
  try {
    const result = await window.tujian.moveDataDir(dir)
    if (result && result.ok === false) ElMessage.warning(result.message || '没有改成')
  } catch (error) {
    ElMessage.error(error.message || '更改失败')
  } finally {
    moving.value = false
  }
}

async function reset() {
  try {
    await ElMessageBox.confirm('会清空本机的选品、作品和账号，授权和接口凭证会保留。', '清空业务数据', { type: 'warning' })
  } catch { return }
  await store.reset()
  ElMessage.success('已清空')
}
</script>
