<template>
  <Teleport to="body">
    <Transition name="upd-fade">
      <div v-if="visible" class="upd-mask" @click.self="onMaskClick">
        <div class="upd-card" :class="status">
          <button type="button" class="upd-close" aria-label="关闭" @click="close">×</button>
          <div class="upd-visual">
            <div v-if="status === 'checking'" class="orbit">
              <span /><span /><span />
              <i class="core" />
            </div>
            <div v-else-if="status === 'downloading'" class="ring">
              <svg viewBox="0 0 120 120">
                <circle class="track" cx="60" cy="60" r="52" />
                <circle
                  class="bar"
                  cx="60"
                  cy="60"
                  r="52"
                  :style="{ strokeDashoffset: ringOffset }"
                />
              </svg>
              <strong>{{ Math.floor(percent) }}%</strong>
            </div>
            <div v-else-if="status === 'available'" class="pulse-badge">新</div>
            <div v-else-if="status === 'downloaded'" class="done-badge">✓</div>
            <div v-else-if="status === 'error'" class="err-badge">!</div>
            <div v-else class="ok-badge">OK</div>
          </div>

          <h3>{{ title }}</h3>
          <p v-if="channelLabel" class="ver channel">{{ channelLabel }}</p>
          <p>{{ message }}</p>
          <p v-if="remoteVersion" class="ver">
            当前 {{ currentVersion || '—' }}
            <template v-if="remoteVersion && remoteVersion !== currentVersion"> → {{ remoteVersion }}</template>
          </p>

          <div class="upd-actions">
            <el-button v-if="status === 'available'" type="primary" :loading="busy" @click="download">
              立即更新
            </el-button>
            <el-button v-if="status === 'downloaded'" type="primary" :loading="busy" @click="install">
              重启安装
            </el-button>
            <el-button v-if="status === 'error'" type="primary" :loading="busy" @click="recheck">
              再试一次
            </el-button>
            <el-button v-if="canOpenRelease" @click="openRelease">打开下载页</el-button>
            <el-button v-if="canCloseNow" @click="close">稍后再说</el-button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage } from 'element-plus'

const visible = ref(false)
const status = ref('idle')
const message = ref('')
const currentVersion = ref('')
const remoteVersion = ref('')
const percent = ref(0)
const busy = ref(false)
const manual = ref(false)
let offStatus = null

const title = computed(() => {
  const map = {
    checking: '正在检查更新',
    available: '发现新版本',
    downloading: '正在下载更新包',
    downloaded: '更新已就绪',
    'not-available': '已是最新版',
    error: '更新失败',
    dev: '开发模式'
  }
  return map[status.value] || '软件更新'
})

const ringOffset = computed(() => {
  const c = 2 * Math.PI * 52
  const p = Math.max(0, Math.min(100, percent.value)) / 100
  return c * (1 - p)
})

const channelLabel = computed(() => {
  if (!['available', 'downloading', 'downloaded'].includes(status.value)) return ''
  return '更新通道：完整安装包。主程序有变化，下载的是 Setup 整包，不是组件增量。'
})
const canCloseNow = computed(() => status.value !== 'downloading')
const canOpenRelease = computed(() => ['error', 'available', 'dev'].includes(status.value))

function applyPayload(payload = {}) {
  status.value = payload.status || 'idle'
  message.value = payload.message || ''
  if (payload.version) remoteVersion.value = String(payload.version)
  if (typeof payload.percent === 'number') percent.value = payload.percent
  if (payload.manual) manual.value = true

  // 自动检查：只有发现新版本 / 正在下载 / 下载完成才弹；已是最新保持安静
  // 手动检查：最新版也弹一下提示；错误才弹失败
  if (status.value === 'available' || status.value === 'downloading' || status.value === 'downloaded') {
    visible.value = true
  } else if (status.value === 'checking') {
    visible.value = Boolean(manual.value)
  } else if (status.value === 'not-available') {
    if (manual.value) {
      visible.value = true
      setTimeout(() => {
        if (status.value === 'not-available') visible.value = false
      }, 1600)
    } else {
      visible.value = false
    }
  } else if (status.value === 'error') {
    visible.value = true
  } else if (status.value === 'dev') {
    visible.value = Boolean(manual.value)
  }
}

async function refreshInfo() {
  try {
    const info = await window.tujian?.getInfo?.()
    currentVersion.value = info?.version || ''
  } catch { /* ignore */ }
  try {
    const st = await window.tujian?.updateStatus?.()
    if (st?.currentVersion) currentVersion.value = st.currentVersion
  } catch { /* ignore */ }
}

async function recheck() {
  busy.value = true
  manual.value = true
  try {
    await window.tujian?.checkUpdate?.({ manual: true })
  } catch (error) {
    ElMessage.error(error?.message || '检查更新失败')
  } finally {
    busy.value = false
  }
}

async function download() {
  busy.value = true
  try {
    const res = await window.tujian?.downloadUpdate?.()
    if (res && res.ok === false) ElMessage.error(res.message || '下载失败')
  } catch (error) {
    ElMessage.error(error?.message || '下载失败')
  } finally {
    busy.value = false
  }
}

async function install() {
  busy.value = true
  try {
    await window.tujian?.installUpdate?.()
  } catch (error) {
    busy.value = false
    ElMessage.error(error?.message || '安装失败')
  }
}

async function openRelease() {
  await window.tujian?.openUpdatePage?.()
}

function close() {
  visible.value = false
}

function onMaskClick() {
  close()
}

onMounted(async () => {
  await refreshInfo()
  offStatus = window.tujian?.onUpdateStatus?.((payload) => applyPayload(payload || {}))
  // 打包版启动后由主进程自动检查；这里只挂监听
})

onUnmounted(() => {
  if (typeof offStatus === 'function') offStatus()
})

defineExpose({ recheck, showManual: () => { manual.value = true; recheck() } })
</script>

<style scoped>
.upd-mask {
  position: fixed;
  inset: 0;
  z-index: 4000;
  display: grid;
  place-items: center;
  background: rgba(15, 23, 42, 0.42);
  backdrop-filter: blur(6px);
}
.upd-card {
  position: relative;
  width: min(420px, calc(100vw - 32px));
  padding: 28px 24px 22px;
  border-radius: 20px;
  background: linear-gradient(165deg, #ffffff 0%, #f3f7ff 55%, #eef6ff 100%);
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22);
  text-align: center;
}
.upd-close {
  position: absolute;
  top: 10px;
  right: 12px;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 999px;
  background: #eef2ff;
  color: #334155;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
.upd-card h3 {
  margin: 14px 0 8px;
  font-size: 20px;
  color: #0f172a;
}
.upd-card p {
  margin: 0;
  color: #475569;
  line-height: 1.5;
  font-size: 14px;
}
.upd-card .ver {
  margin-top: 8px;
  color: #64748b;
  font-size: 12px;
}
.upd-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-top: 18px;
  flex-wrap: wrap;
}
.upd-visual {
  height: 108px;
  display: grid;
  place-items: center;
}
.orbit {
  position: relative;
  width: 88px;
  height: 88px;
}
.orbit span {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid transparent;
  border-top-color: #2563eb;
  animation: spin 1s linear infinite;
}
.orbit span:nth-child(2) {
  inset: 10px;
  border-top-color: #38bdf8;
  animation-duration: 1.4s;
  animation-direction: reverse;
}
.orbit span:nth-child(3) {
  inset: 20px;
  border-top-color: #93c5fd;
  animation-duration: 1.8s;
}
.orbit .core {
  position: absolute;
  inset: 32px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #60a5fa, #1d4ed8);
  box-shadow: 0 0 18px rgba(37, 99, 235, 0.45);
  animation: breath 1.6s ease-in-out infinite;
}
.ring {
  position: relative;
  width: 108px;
  height: 108px;
}
.ring svg {
  width: 108px;
  height: 108px;
  transform: rotate(-90deg);
}
.ring circle {
  fill: none;
  stroke-width: 8;
}
.ring .track {
  stroke: #dbeafe;
}
.ring .bar {
  stroke: #2563eb;
  stroke-linecap: round;
  stroke-dasharray: 326.7256;
  transition: stroke-dashoffset 0.25s ease;
}
.ring strong {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 22px;
  color: #1e3a8a;
}
.pulse-badge,
.done-badge,
.err-badge,
.ok-badge {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 28px;
  font-weight: 700;
  color: #fff;
}
.pulse-badge {
  background: linear-gradient(135deg, #2563eb, #06b6d4);
  animation: pop 1.2s ease-in-out infinite;
}
.done-badge {
  background: linear-gradient(135deg, #16a34a, #22c55e);
  animation: pop 0.8s ease;
}
.err-badge {
  background: linear-gradient(135deg, #dc2626, #f97316);
}
.ok-badge {
  background: linear-gradient(135deg, #0ea5e9, #2563eb);
}
.upd-fade-enter-active,
.upd-fade-leave-active {
  transition: opacity 0.25s ease;
}
.upd-fade-enter-from,
.upd-fade-leave-to {
  opacity: 0;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
@keyframes breath {
  0%, 100% { transform: scale(1); opacity: 0.9; }
  50% { transform: scale(1.08); opacity: 1; }
}
@keyframes pop {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.06); }
}
</style>
