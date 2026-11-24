<template>
  <button
    v-if="collapsed"
    type="button"
    class="log-dot"
    :title="`运行日志 · ${unread || store.logs.length}`"
    @click="expand"
  >
    <span class="log-dot-core" :class="{ pulse: unread }"></span>
    <em v-if="unread">{{ unread > 99 ? '99+' : unread }}</em>
  </button>

  <aside
    v-else
    class="log-panel"
    :style="{ width: `${width}px`, height: `${height}px` }"
  >
    <header class="log-head" @pointerdown="startDrag">
      <strong>运行日志</strong>
      <span class="muted">{{ filtered.length }}/{{ processLogs.length }}</span>
      <div class="log-head-actions" @pointerdown.stop>
        <el-select v-model="level" size="small" style="width: 96px">
          <el-option label="全部" value="all" />
          <el-option label="info" value="info" />
          <el-option label="warning" value="warning" />
          <el-option label="error" value="error" />
          <el-option label="success" value="success" />
        </el-select>
        <el-button size="small" link @click="clear">清空</el-button>
        <el-button size="small" link @click="collapse">隐藏</el-button>
      </div>
    </header>
    <div ref="listRef" class="log-body">
      <div v-if="!filtered.length" class="muted log-empty">还没有流程日志。打开豆包、发布、定时任务等步骤会出现在这里。</div>
      <div v-for="item in filtered" :key="item.id" class="log-row" :class="item.level">
        <span class="log-level">{{ item.level }}</span>
        <span class="log-mod">{{ item.module }}</span>
        <span class="log-msg">{{ item.message }}</span>
        <span class="log-time">{{ item.time }}</span>
      </div>
    </div>
    <div class="log-resize" title="拖动缩放" @pointerdown.stop.prevent="startResize"></div>
  </aside>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAppStore } from '@/stores/app'

const store = useAppStore()
const STORAGE_KEY = 'huang-log-float'

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}
  } catch {
    return {}
  }
}

const PROCESS_MODULES = new Set([
  '豆包', '定时', '发布', '任务', '采集', '同步', '选品', '作品', '提示词',
  'RPA', '去水印', '剪辑', '视频二创', '关注', '清理', '审核', '系统'
])
const NOISE_MODULES = new Set(['导航', '操作'])

const saved = loadState()
const collapsed = ref(saved.collapsed !== false)
const width = ref(Math.min(720, Math.max(320, Number(saved.width) || 420)))
const height = ref(Math.min(560, Math.max(180, Number(saved.height) || 280)))
const level = ref(saved.level || 'all')
const unread = ref(0)
const listRef = ref(null)
const seenId = ref('')

function isProcessLog(item) {
  if (!item || NOISE_MODULES.has(item.module)) return false
  if (PROCESS_MODULES.has(item.module)) return true
  // 兼容旧日志：带步骤语义的也留下
  return /打开|发送|生成|发布|挂车|定时|验证码|失败|成功|执行|同步|导入|排队|额度|成片/.test(String(item.message || ''))
}

const processLogs = computed(() => store.logs.filter(isProcessLog))

const filtered = computed(() => {
  const rows = processLogs.value
  if (level.value === 'all') return rows
  if (level.value === 'error') {
    return rows.filter((item) => item.level === 'error' || item.level === 'warning')
  }
  return rows.filter((item) => item.level === level.value)
})

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    collapsed: collapsed.value,
    width: width.value,
    height: height.value,
    level: level.value
  }))
}

function expand() {
  collapsed.value = false
  unread.value = 0
  seenId.value = store.logs[0]?.id || ''
  persist()
  nextTick(scrollTop)
}

function collapse() {
  collapsed.value = true
  unread.value = 0
  seenId.value = store.logs[0]?.id || ''
  persist()
}

function clear() {
  store.logs = []
  unread.value = 0
  seenId.value = ''
  store.persist()
}

function scrollTop() {
  if (listRef.value) listRef.value.scrollTop = 0
}

watch(() => processLogs.value[0]?.id, (id) => {
  if (!id || id === seenId.value) return
  if (collapsed.value) {
    unread.value += 1
  } else {
    seenId.value = id
    nextTick(scrollTop)
  }
})

watch(level, persist)

let drag = null
let resize = null

function startDrag(event) {
  if (event.button !== 0) return
  const panel = event.currentTarget?.parentElement
  if (!panel) return
  const rect = panel.getBoundingClientRect()
  drag = {
    ox: event.clientX,
    oy: event.clientY,
    left: rect.left,
    top: rect.top,
    panel
  }
  panel.style.right = 'auto'
  panel.style.bottom = 'auto'
  panel.style.left = `${rect.left}px`
  panel.style.top = `${rect.top}px`
  window.addEventListener('pointermove', onDrag)
  window.addEventListener('pointerup', endDrag)
}

function onDrag(event) {
  if (!drag) return
  const left = Math.max(8, Math.min(window.innerWidth - 80, drag.left + event.clientX - drag.ox))
  const top = Math.max(8, Math.min(window.innerHeight - 80, drag.top + event.clientY - drag.oy))
  drag.panel.style.left = `${left}px`
  drag.panel.style.top = `${top}px`
}

function endDrag() {
  drag = null
  window.removeEventListener('pointermove', onDrag)
  window.removeEventListener('pointerup', endDrag)
}

function startResize(event) {
  resize = { ox: event.clientX, oy: event.clientY, w: width.value, h: height.value }
  window.addEventListener('pointermove', onResize)
  window.addEventListener('pointerup', endResize)
}

function onResize(event) {
  if (!resize) return
  width.value = Math.min(860, Math.max(300, resize.w + event.clientX - resize.ox))
  height.value = Math.min(720, Math.max(160, resize.h + event.clientY - resize.oy))
}

function endResize() {
  resize = null
  persist()
  window.removeEventListener('pointermove', onResize)
  window.removeEventListener('pointerup', endResize)
}

function onToggle() {
  if (collapsed.value) expand()
  else collapse()
}

onMounted(() => {
  seenId.value = processLogs.value[0]?.id || ''
  window.addEventListener('huang-toggle-log', onToggle)
})

onBeforeUnmount(() => {
  window.removeEventListener('huang-toggle-log', onToggle)
  endDrag()
  endResize()
})
</script>

<style scoped>
.log-dot {
  position: fixed;
  z-index: 4200;
  right: 18px;
  top: 58px;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 999px;
  background: #111827;
  color: #fff;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(15, 23, 42, .28);
  display: grid;
  place-items: center;
}
.log-dot-core {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #67e8f9;
}
.log-dot-core.pulse {
  background: #fb7185;
  box-shadow: 0 0 0 0 rgba(251, 113, 133, .7);
  animation: log-pulse 1.4s infinite;
}
.log-dot em {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 999px;
  background: #ef4444;
  color: #fff;
  font-style: normal;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}
@keyframes log-pulse {
  70% { box-shadow: 0 0 0 10px rgba(251, 113, 133, 0); }
  100% { box-shadow: 0 0 0 0 rgba(251, 113, 133, 0); }
}

.log-panel {
  position: fixed;
  z-index: 4200;
  right: 16px;
  top: 56px;
  display: flex;
  flex-direction: column;
  background: rgba(17, 24, 39, .94);
  color: #e5e7eb;
  border: 1px solid rgba(255, 255, 255, .08);
  border-radius: 12px;
  box-shadow: 0 18px 48px rgba(15, 23, 42, .35);
  overflow: hidden;
  backdrop-filter: blur(8px);
}
.log-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, .08);
  cursor: move;
  user-select: none;
}
.log-head strong { font-size: 13px; }
.log-head .muted { color: #94a3b8; font-size: 12px; }
.log-head-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
}
.log-head-actions :deep(.el-button) { color: #cbd5e1; }
.log-body {
  flex: 1;
  overflow: auto;
  padding: 6px 0;
  font-family: Consolas, "Sarasa Mono SC", "Microsoft YaHei", monospace;
  font-size: 12px;
  line-height: 1.45;
}
.log-empty { padding: 16px; }
.log-row {
  display: grid;
  grid-template-columns: 64px 56px 1fr auto;
  gap: 8px;
  padding: 5px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, .04);
}
.log-row:hover { background: rgba(255, 255, 255, .04); }
.log-level { text-transform: uppercase; font-weight: 700; color: #93c5fd; }
.log-row.warning .log-level,
.log-row.error .log-level { color: #fb7185; }
.log-row.success .log-level { color: #4ade80; }
.log-mod { color: #a5b4fc; }
.log-msg { color: #e2e8f0; word-break: break-word; }
.log-time { color: #64748b; white-space: nowrap; }
.log-resize {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  background:
    linear-gradient(135deg, transparent 50%, rgba(255,255,255,.35) 50%) bottom right / 10px 10px no-repeat;
}
</style>
