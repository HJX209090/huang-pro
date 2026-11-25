<template>
  <div class="page dash">
    <div class="page-head">
      <div>
        <h1>经营仪表盘</h1>
        <p>审核通过、发布结果按真实发生时间统计 · 库存是当前积压 <em class="live">实时汇总</em></p>
      </div>
      <el-button @click="router.push('/works')">我的作品</el-button>
    </div>

    <div class="panel dash-toolbar">
      <el-checkbox v-model="auto">自动刷新</el-checkbox>
      <span>间隔</span>
      <el-select v-model="intervalSec" style="width: 120px">
        <el-option label="30 秒" :value="30" />
        <el-option label="1 分钟" :value="60" />
        <el-option label="5 分钟" :value="300" />
        <el-option label="10 分钟" :value="600" />
      </el-select>
      <span class="muted">上次刷新 {{ lastRefresh }}</span>
      <el-button type="primary" plain @click="refresh">立即刷新</el-button>
    </div>

    <div class="range-tabs">
      <button v-for="item in rangeOptions" :key="item.id" type="button" :class="{ on: rangeKey === item.id }" @click="rangeKey = item.id">{{ item.label }}</button>
      <el-date-picker v-if="rangeKey === 'custom'" v-model="customRange" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期" />
    </div>

    <div class="section-title">{{ period.title }}</div>
    <div class="metric-grid">
      <div v-for="item in compareCards" :key="item.label" class="metric-card">
        <span>{{ item.label }}</span>
        <b>{{ item.current }}</b>
        <em>{{ period.prevLabel }} {{ item.previous }}</em>
      </div>
      <div class="metric-card metric-wide">
        <span>新建作品</span>
        <b>{{ createdNow }}</b>
        <em>{{ period.prevLabel }} {{ createdPrev }}</em>
        <div class="spark">
          <i v-for="bar in createdBars" :key="bar.day" :style="{ height: `${bar.height}%` }" :title="`${bar.day} ${bar.count}`"></i>
        </div>
      </div>
    </div>

    <div class="section-title">库存积压</div>
    <div class="metric-grid stock-grid">
      <button v-for="item in stockCards" :key="item.label" type="button" class="metric-card stock-card" @click="item.to && router.push(item.to)">
        <span>{{ item.label }}</span>
        <b>{{ item.value }}</b>
      </button>
    </div>

    <div class="info-grid">
      <div class="panel info-card">
        <span>豆包今日用量</span>
        <b>{{ doubaoText }}</b>
        <div class="usage-bar"><i :style="{ width: `${doubaoPercent}%` }"></i></div>
        <button type="button" class="text-link" @click="router.push('/doubao')">账号配额</button>
        <p>每个豆包账号每天 {{ doubaoLimitLabel }}，过了零点已用次数归零。</p>
      </div>
      <div class="panel info-card">
        <span>今日发布（账号合计）</span>
        <b>{{ publishedToday }}</b>
        <button type="button" class="text-link" @click="router.push('/publish')">{{ store.publishAccounts.length }} 个发布号</button>
      </div>
      <div class="panel info-card">
        <span>视频购物车已满</span>
        <b>{{ cartFull }}</b>
        <button type="button" class="text-link" @click="router.push('/publish')">当前标记 · 发布账号</button>
        <p>只有抖音页面明确返回购物车已满时才记 1，过了当天就清掉。</p>
      </div>
    </div>

    <div class="section-title">选品漏斗</div>
    <div class="funnel">
      <div v-for="item in funnel" :key="item.label" class="funnel-card">
        <b>{{ item.value }}</b>
        <span>{{ item.label }}</span>
      </div>
    </div>

    <div class="two-col">
      <div class="panel">
        <div class="toolbar"><strong>今日趋势</strong><span class="muted">{{ trendCaption }}</span></div>
        <div v-if="!trend.length" class="muted">选一个日期范围后显示每天的发布和成片。</div>
        <div v-else class="trend">
          <div v-for="day in trend" :key="day.key" class="trend-col">
            <div class="trend-bars">
              <i class="pub" :style="{ height: `${day.publishHeight}%` }"></i>
              <i class="gen" :style="{ height: `${day.generateHeight}%` }"></i>
            </div>
            <span>{{ day.label }}</span>
          </div>
          <div class="trend-side">{{ trendTotals }}</div>
        </div>
        <div class="legend"><i class="pub"></i>发布成功 <i class="gen"></i>收成成功</div>
      </div>
      <div class="panel">
        <div class="toolbar">
          <strong>发布失败原因 Top</strong>
          <el-button link type="primary" @click="router.push('/works')">查看发布失败作品</el-button>
        </div>
        <div v-if="!failTop.length" class="muted">所选区间暂无失败归因</div>
        <div v-else class="fail-list">
          <div v-for="item in failTop" :key="item.reason" class="fail-row">
            <span>{{ item.reason }}</span>
            <b>{{ item.count }}</b>
          </div>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="toolbar"><strong>近期任务</strong></div>
      <el-table :data="recentTasks" empty-text="暂无近期任务">
        <el-table-column prop="title" label="任务名" min-width="180" />
        <el-table-column prop="kind" label="类型" width="120" />
        <el-table-column prop="status" label="状态" width="120" />
        <el-table-column prop="time" label="时间" width="170" />
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { formatTime } from '@/utils/format'

const store = useAppStore()
const router = useRouter()
const auto = ref(true)
const intervalSec = ref(60)
const lastRefresh = ref(formatTime(new Date()))
const rangeKey = ref('today')
const customRange = ref([])
const tick = ref(0)
let timer = 0

const rangeOptions = [
  { id: 'today', label: '今日' },
  { id: 'yesterday', label: '昨日' },
  { id: '7', label: '近7天' },
  { id: '30', label: '近30天' },
  { id: 'custom', label: '自定义' }
]

function startOfDay(offset) {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + offset)
  return date
}

function endOfDay(offset) {
  const date = startOfDay(offset)
  date.setHours(23, 59, 59, 999)
  return date
}

function parseStamp(value) {
  const matched = String(value || '').match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?/)
  if (!matched) return 0
  return new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]), Number(matched[4] || 0), Number(matched[5] || 0)).getTime()
}

function dayKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

const period = computed(() => {
  tick.value
  if (rangeKey.value === 'yesterday') {
    return { start: startOfDay(-1), end: endOfDay(-1), prevStart: startOfDay(-2), prevEnd: endOfDay(-2), title: '昨日 vs 前日', prevLabel: '前日' }
  }
  if (rangeKey.value === '7') {
    return { start: startOfDay(-6), end: endOfDay(0), prevStart: startOfDay(-13), prevEnd: endOfDay(-7), title: '近7天 vs 前7天', prevLabel: '前7天' }
  }
  if (rangeKey.value === '30') {
    return { start: startOfDay(-29), end: endOfDay(0), prevStart: startOfDay(-59), prevEnd: endOfDay(-30), title: '近30天 vs 前30天', prevLabel: '前30天' }
  }
  if (rangeKey.value === 'custom' && customRange.value?.length === 2) {
    const start = new Date(`${customRange.value[0]}T00:00:00`)
    const end = new Date(`${customRange.value[1]}T23:59:59`)
    const span = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000))
    const prevEnd = new Date(start.getTime() - 1)
    const prevStart = new Date(prevEnd)
    prevStart.setDate(prevStart.getDate() - span + 1)
    prevStart.setHours(0, 0, 0, 0)
    return { start, end, prevStart, prevEnd, title: '自定义 vs 上一段', prevLabel: '上一段' }
  }
  return { start: startOfDay(0), end: endOfDay(0), prevStart: startOfDay(-1), prevEnd: endOfDay(-1), title: '今日 vs 昨日', prevLabel: '昨日' }
})

function inSpan(stamp, start, end) {
  const time = parseStamp(stamp)
  return time >= start.getTime() && time <= end.getTime()
}

function countWhere(start, end, pick) {
  return store.works.filter((work) => inSpan(pick(work), start, end)).length
}

const compareCards = computed(() => {
  const { start, end, prevStart, prevEnd } = period.value
  const rows = [
    ['审核通过', (work) => work.reviewedAt && ['审核通过', '发布中', '已发布'].includes(work.status) ? work.reviewedAt : ''],
    ['审核驳回', (work) => work.status === '审核失败' ? (work.rejectedAt || work.finishedAt || work.createdAt) : ''],
    ['发布成功', (work) => work.status === '已发布' ? (work.publishedAt || work.finishedAt) : ''],
    ['发布失败', (work) => work.publishFailAt || ''],
    ['收成成功', (work) => work.videoPath ? (work.generatedAt || work.finishedAt) : ''],
    ['收成失败', (work) => work.status === '生成失败' ? (work.finishedAt || work.createdAt) : '']
  ]
  return rows.map(([label, pick]) => ({
    label,
    current: countWhere(start, end, pick),
    previous: countWhere(prevStart, prevEnd, pick)
  }))
})

const createdNow = computed(() => countWhere(period.value.start, period.value.end, (work) => work.createdAt))
const createdPrev = computed(() => countWhere(period.value.prevStart, period.value.prevEnd, (work) => work.createdAt))

const createdBars = computed(() => {
  const days = []
  const cursor = new Date(period.value.start)
  cursor.setHours(0, 0, 0, 0)
  const end = period.value.end.getTime()
  while (cursor.getTime() <= end && days.length < 31) {
    const key = dayKey(cursor)
    days.push({
      day: key.slice(5),
      count: store.works.filter((work) => String(work.createdAt || '').slice(0, 10) === key).length
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  const max = Math.max(...days.map((item) => item.count), 1)
  return days.map((item) => ({ ...item, height: Math.max(8, Math.round((item.count / max) * 100)) }))
})

const stockCards = computed(() => [
  { label: '待审核', value: store.works.filter((work) => work.status === '已生成').length, to: '/works' },
  { label: '已审核待发', value: store.works.filter((work) => work.status === '审核通过' || work.status === '发布中').length, to: '/works' },
  { label: '未发布', value: store.works.filter((work) => work.status === '待生成').length, to: '/works' },
  { label: '制作中', value: store.works.filter((work) => work.status === '生成中').length, to: '/works' },
  { label: '剪辑失败', value: store.works.filter((work) => work.status === '生成失败').length, to: '/works' },
  { label: '发布失败', value: store.works.filter((work) => work.publishFailAt && work.status !== '已发布').length, to: '/works' }
])

const doubaoText = computed(() => {
  const usage = store.doubaoToday
  if (!usage.accounts) return '0 / —'
  return `${usage.used} / ${usage.limit}`
})
const doubaoPercent = computed(() => {
  const usage = store.doubaoToday
  if (!usage.limit) return 0
  return Math.min(100, Math.round((usage.used / usage.limit) * 100))
})
const doubaoLimitLabel = computed(() => {
  const limits = [...new Set((store.doubaoAccounts || []).map((account) => Number(account.quotaLimit) || 5))]
  if (!limits.length) return '5 个额度'
  if (limits.length === 1) return `${limits[0]} 个额度`
  return '各自的每日上限'
})

const publishedToday = computed(() => store.works.filter((work) => work.status === '已发布' && String(work.publishedAt || work.finishedAt || '').slice(0, 10) === dayKey(new Date())).length)

const cartFull = computed(() => (store.publishAccounts || []).filter((account) => account.cartFull && String(account.cartFullAt || '').slice(0, 10) === dayKey(new Date())).length)

const funnel = computed(() => {
  const products = store.products || []
  const works = store.works || []
  const submitted = (product) => works.some((work) => work.productId === product.id && work.status !== '待生成')
  const failedOnly = (product) => {
    const mine = works.filter((work) => work.productId === product.id)
    return mine.length > 0 && mine.every((work) => work.status === '生成失败')
  }
  return [
    { label: '选品入库', value: products.length },
    { label: '无提示词', value: products.filter((item) => !item.scriptReady).length },
    { label: '待提交', value: products.filter((item) => item.scriptReady && !works.some((work) => work.productId === item.id)).length },
    { label: '已提交', value: products.filter((item) => submitted(item) && !failedOnly(item)).length },
    { label: '提示词失败', value: products.filter((item) => failedOnly(item)).length }
  ]
})

const trend = computed(() => {
  const days = []
  const cursor = new Date(period.value.start)
  cursor.setHours(0, 0, 0, 0)
  while (cursor.getTime() <= period.value.end.getTime() && days.length < 31) {
    const key = dayKey(cursor)
    days.push({
      key,
      label: `${cursor.getMonth() + 1}-${cursor.getDate()}`,
      publish: store.works.filter((work) => work.status === '已发布' && String(work.publishedAt || work.finishedAt || '').slice(0, 10) === key).length,
      generate: store.works.filter((work) => work.videoPath && String(work.generatedAt || work.finishedAt || '').slice(0, 10) === key).length
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  const max = Math.max(...days.map((item) => Math.max(item.publish, item.generate)), 1)
  return days.map((item) => ({
    ...item,
    publishHeight: Math.max(item.publish ? 12 : 4, Math.round((item.publish / max) * 100)),
    generateHeight: Math.max(item.generate ? 12 : 4, Math.round((item.generate / max) * 100))
  }))
})

const trendTotals = computed(() => {
  const publish = trend.value.reduce((sum, item) => sum + item.publish, 0)
  const generate = trend.value.reduce((sum, item) => sum + item.generate, 0)
  return `${publish} / ${generate}`
})
const trendCaption = computed(() => trend.value.length === 1 ? trend.value[0].label : `${trend.value.length} 天`)

const failTop = computed(() => {
  const { start, end } = period.value
  const map = new Map()
  store.works.forEach((work) => {
    if (!work.publishFailAt || !inSpan(work.publishFailAt, start, end)) return
    const reason = String(work.publishFailReason || '未记录原因').trim()
    map.set(reason, (map.get(reason) || 0) + 1)
  })
  return [...map.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 5)
})

const recentTasks = computed(() => (store.runtimeTasks || []).slice(0, 8).map((item) => ({
  title: item.title,
  kind: item.kind || '任务',
  status: item.status === 'running' ? '执行中' : (item.note || item.status),
  time: item.finishedAt || item.startedAt
})))

function refresh() {
  store.syncDoubaoStats()
  lastRefresh.value = formatTime(new Date())
  tick.value += 1
}

function armTimer() {
  if (timer) clearInterval(timer)
  timer = 0
  if (!auto.value) return
  timer = setInterval(refresh, Math.max(15, intervalSec.value) * 1000)
}

watch([auto, intervalSec], armTimer)
onMounted(() => {
  refresh()
  armTimer()
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<style scoped>
.dash { min-width: 0; }
.live { margin-left: 8px; color: #6d4aff; font-style: normal; font-weight: 700; }
.dash-toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.dash-toolbar .el-button { margin-left: auto; }
.range-tabs { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 12px 0; }
.range-tabs button { border: 0; background: #f4f5f7; color: #475467; border-radius: 999px; padding: 6px 14px; cursor: pointer; }
.range-tabs button.on { background: #efeaff; color: #6d4aff; font-weight: 700; }
.section-title { margin: 8px 0; font-weight: 700; }
.metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.stock-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); margin-bottom: 12px; }
.metric-wide { grid-column: span 1; }
.stock-card { text-align: left; cursor: pointer; }
.spark { display: flex; align-items: flex-end; gap: 3px; height: 28px; margin-top: 8px; }
.spark i { flex: 1; min-width: 4px; border-radius: 3px 3px 0 0; background: #c4b5fd; display: block; }
.info-grid { display: grid; grid-template-columns: 1fr 1.4fr 1fr; gap: 10px; margin-bottom: 12px; }
.info-card { min-height: 132px; }
.info-card b { display: block; margin: 8px 0; font-size: 28px; }
.info-card p, .info-card span { color: #667085; }
.text-link { border: 0; background: transparent; color: #6d4aff; padding: 0; cursor: pointer; }
.usage-bar { height: 8px; border-radius: 999px; background: #f2f4f7; overflow: hidden; margin: 8px 0; }
.usage-bar i { display: block; height: 100%; background: #6d4aff; }
.funnel { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin-bottom: 12px; }
.funnel-card { background: #f5f3ff; border-radius: 12px; padding: 14px; }
.funnel-card b { display: block; font-size: 28px; }
.funnel-card span { color: #667085; }
.trend { display: flex; align-items: flex-end; gap: 8px; min-height: 120px; }
.trend-col { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 36px; }
.trend-bars { display: flex; align-items: flex-end; gap: 3px; height: 88px; }
.trend-bars i { width: 8px; border-radius: 4px 4px 0 0; display: block; }
.trend-side { margin-left: auto; color: #98a2b3; }
.legend { display: flex; gap: 12px; align-items: center; color: #667085; margin-top: 8px; }
.legend i { width: 8px; height: 8px; border-radius: 99px; display: inline-block; }
.trend-bars i.pub, .legend i.pub { background: #7c3aed; }
.trend-bars i.gen, .legend i.gen { background: #22c55e; }
.fail-list { display: grid; gap: 8px; }
.fail-row { display: flex; justify-content: space-between; gap: 12px; }
.fail-row span { min-width: 0; }
@media (max-width: 1100px) {
  .metric-grid, .stock-grid, .info-grid, .funnel { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dash-toolbar .el-button { margin-left: 0; }
}
</style>
