<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>任务中心</h1>
        <p>查看正在执行的生成、发布、定时任务。卡住时可手动结束，并关闭对应桌面窗口。</p>
      </div>
      <div class="head-tools">
        <el-button @click="refreshSessions">刷新窗口</el-button>
        <el-button type="danger" plain :disabled="!running.length" @click="stopAll">全部结束</el-button>
      </div>
    </div>

    <div class="panel">
      <div class="toolbar">
        <span>执行中 <b class="count">{{ running.length }}</b></span>
        <span class="muted">最近记录 {{ store.runtimeTasks.length }}</span>
      </div>
      <el-table :data="store.runtimeTasks">
        <el-table-column prop="kind" label="类型" width="90" />
        <el-table-column prop="title" label="任务" min-width="200" />
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="statusType(row.status)">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="note" label="说明" min-width="220" />
        <el-table-column prop="startedAt" label="开始" width="160" />
        <el-table-column prop="finishedAt" label="结束" width="160" />
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'running'" link type="danger" @click="stopOne(row)">结束</el-button>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
      </el-table>
      <p v-if="!store.runtimeTasks.length" class="muted">还没有运行记录。点定时任务「立即执行」或重新生成后会出现在这里。</p>
    </div>

    <div class="panel">
      <div class="toolbar">
        <span>桌面浏览器窗口 <b class="count">{{ sessions.length }}</b></span>
        <span class="muted">结束任务时会顺带关掉相关窗口；也可单独关闭</span>
      </div>
      <el-table :data="sessions">
        <el-table-column prop="key" label="窗口键" min-width="220" />
        <el-table-column prop="title" label="标题" min-width="200" />
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="focus(row)">置前</el-button>
            <el-button link type="danger" @click="close(row)">关闭</el-button>
          </template>
        </el-table-column>
      </el-table>
      <p v-if="!sessions.length" class="muted">当前没有打开的豆包/发布/选品窗口。</p>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAppStore } from '@/stores/app'

const store = useAppStore()
const sessions = ref([])
let timer = 0

const running = computed(() => store.runtimeTasks.filter((item) => item.status === 'running'))

function statusText(status) {
  if (status === 'running') return '执行中'
  if (status === 'cancelled') return '已结束'
  if (status === 'failed') return '失败'
  return '完成'
}

function statusType(status) {
  if (status === 'running') return 'warning'
  if (status === 'cancelled') return 'info'
  if (status === 'failed') return 'danger'
  return 'success'
}

async function refreshSessions() {
  if (!window.tujian?.listSessions) {
    sessions.value = []
    return
  }
  sessions.value = await window.tujian.listSessions()
}

async function stopOne(row) {
  const message = await store.cancelRuntimeTask(row.id)
  ElMessage.success(message)
  await refreshSessions()
}

async function stopAll() {
  try {
    await ElMessageBox.confirm(`结束当前 ${running.value.length} 个执行中的任务？`, '全部结束', { type: 'warning' })
  } catch { return }
  const count = await store.cancelAllRuntimeTasks()
  ElMessage.success(count ? `已结束 ${count} 个任务` : '没有执行中的任务')
  await refreshSessions()
}

async function focus(row) {
  if (!window.tujian?.focusDoubaoWindow) return
  await window.tujian.focusDoubaoWindow(row.key)
}

async function close(row) {
  if (!window.tujian?.closeSession) return
  await window.tujian.closeSession(row.key)
  ElMessage.success('窗口已关闭')
  await refreshSessions()
}

onMounted(() => {
  refreshSessions()
  timer = setInterval(refreshSessions, 4000)
})

onUnmounted(() => clearInterval(timer))
</script>
