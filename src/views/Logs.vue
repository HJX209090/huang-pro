<template>
  <div class="page logs-page">
    <div class="page-head">
      <div>
        <h1>运行日志</h1>
        <p>记录代码真实执行过程（类似终端）。主进程步骤会实时刷到下方黑窗，并写入本机 huang.log。</p>
      </div>
      <el-button @click="openFile">打开日志文件</el-button>
      <el-button @click="clearLogs">清空</el-button>
    </div>

    <div class="panel terminal-wrap">
      <div class="terminal-bar">
        <span>runtime · live</span>
        <el-switch v-model="autoScroll" active-text="自动滚到底" />
      </div>
      <pre ref="termRef" class="terminal">{{ terminalText || '等待主进程输出… 导入商品 / 打开豆包 / 发布时会在这里刷日志' }}</pre>
    </div>

    <div class="panel filters">
      <el-select v-model="moduleName" clearable placeholder="全部模块" style="width: 140px" @change="page = 1">
        <el-option v-for="item in modules" :key="item" :label="item" :value="item" />
      </el-select>
      <el-select v-model="level" clearable placeholder="全部级别" style="width: 140px" @change="page = 1">
        <el-option label="信息" value="info" />
        <el-option label="成功" value="success" />
        <el-option label="警告" value="warning" />
        <el-option label="错误" value="error" />
      </el-select>
    </div>
    <div class="panel">
      <el-table :data="pageRows">
        <el-table-column prop="time" label="时间" width="170" />
        <el-table-column prop="module" label="模块" width="120" />
        <el-table-column label="级别" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="levelType(row.level)">{{ levelText(row.level) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="message" label="内容" min-width="320" />
      </el-table>
      <div class="pager">
        <el-pagination
          background
          layout="total, sizes, prev, pager, next"
          :total="rows.length"
          :page-sizes="[20, 50, 100]"
          v-model:page-size="pageSize"
          v-model:current-page="page"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAppStore } from '@/stores/app'

const store = useAppStore()
const moduleName = ref('')
const level = ref('')
const page = ref(1)
const pageSize = ref(50)
const autoScroll = ref(true)
const termRef = ref(null)
const liveLines = ref([])
let offRuntime = null

const modules = computed(() => [...new Set(store.logs.map((item) => item.module))])
watch([moduleName, level, pageSize], () => { page.value = 1 })

const terminalText = computed(() => liveLines.value.join('\n'))

function levelType(value) {
  if (value === 'success') return 'success'
  if (value === 'warning') return 'warning'
  if (value === 'error') return 'danger'
  return 'info'
}

function levelText(value) {
  if (value === 'success') return '成功'
  if (value === 'warning') return '警告'
  if (value === 'error') return '错误'
  return '信息'
}

const rows = computed(() => store.logs.filter((item) => {
  if (moduleName.value && item.module !== moduleName.value) return false
  if (level.value && item.level !== level.value) return false
  return true
}))

const pageRows = computed(() => rows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

async function scrollTerm() {
  if (!autoScroll.value) return
  await nextTick()
  const el = termRef.value
  if (el) el.scrollTop = el.scrollHeight
}

function pushLive(line) {
  liveLines.value.push(String(line || ''))
  if (liveLines.value.length > 800) liveLines.value.splice(0, liveLines.value.length - 800)
  scrollTerm()
}

onMounted(() => {
  if (window.tujian?.onRuntimeLog) {
    offRuntime = window.tujian.onRuntimeLog((payload) => {
      const line = payload?.line || `${payload?.time || ''} ${payload?.level || 'I'} | ${payload?.scope || ''}: ${payload?.message || ''}`
      pushLive(line)
    })
  }
  pushLive(`${new Date().toISOString().replace('T', ' ').slice(0, 23)} I | logs: 运行日志页已打开`)
})

onUnmounted(() => {
  if (typeof offRuntime === 'function') offRuntime()
})

async function openFile() {
  if (!window.tujian?.openLogFile) return ElMessage.warning('请在桌面窗口里打开')
  const result = await window.tujian.openLogFile()
  if (result?.file) ElMessage.success('已定位到日志文件')
}

async function clearLogs() {
  try { await ElMessageBox.confirm('清空全部日志？', '清空', { type: 'warning' }) } catch { return }
  store.logs = []
  liveLines.value = []
  page.value = 1
  store.persist()
}
</script>

<style scoped>
.logs-page { display: flex; flex-direction: column; gap: 12px; }
.terminal-wrap { padding: 0; overflow: hidden; }
.terminal-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; background: #1f2430; color: #9aa4b2; font-size: 12px;
}
.terminal {
  margin: 0; min-height: 260px; max-height: 420px; overflow: auto;
  background: #0b0f14; color: #d7e0ea; font-family: Consolas, 'Cascadia Mono', 'Courier New', monospace;
  font-size: 12px; line-height: 1.55; padding: 12px 14px; white-space: pre-wrap; word-break: break-all;
}
.filters { display: flex; gap: 10px; }
.pager { margin-top: 12px; display: flex; justify-content: flex-end; }
</style>
