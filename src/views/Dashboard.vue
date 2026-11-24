<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>经营仪表盘</h1>
        <p>数字来自这台电脑上的作品、选品和日志，按创建日期分成今天和昨天。</p>
      </div>
      <el-button @click="router.push('/works')">我的作品</el-button>
    </div>
    <div class="panel">
      <div class="toolbar">
        <strong>今日 vs 昨日</strong>
        <span class="num-hint">昨天 {{ yesterdayLabel }}</span>
      </div>
      <div class="metric-grid">
        <div v-for="item in compareCards" :key="item.label" class="metric-card">
          <span>{{ item.label }}</span>
          <b>{{ item.today }}</b>
          <em :class="item.delta > 0 ? 'up' : item.delta < 0 ? 'down' : ''">昨日 {{ item.yesterday }} · {{ item.delta > 0 ? '+' : '' }}{{ item.delta }}</em>
        </div>
      </div>
    </div>
    <div class="panel">
      <div class="toolbar"><strong>库存积压</strong><span class="num-hint">当前还压在软件里的数量</span></div>
      <div class="metric-grid">
        <div v-for="item in stockCards" :key="item.label" class="metric-card">
          <span>{{ item.label }}</span>
          <b>{{ item.value }}</b>
        </div>
      </div>
    </div>
    <div class="two-col">
      <div class="panel">
        <div class="toolbar">
          <strong>热卖 Top</strong>
          <span class="num-hint">按选品库月销排序</span>
        </div>
        <div v-if="!hotRows.length" class="muted">选品库还没有带月销的商品。</div>
        <div v-else class="hot-list">
          <div v-for="item in hotRows" :key="item.id" class="hot-row">
            <div class="hot-meta">
              <strong>{{ item.title }}</strong>
              <span>月销 {{ item.monthlySales }} · 佣金 {{ item.rate }}%</span>
            </div>
            <div class="hot-bar">
              <i :style="{ width: `${item.percent}%` }"></i>
            </div>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="toolbar">
          <strong>近期任务</strong>
          <el-button class="grow" link type="primary" @click="router.push('/works')">查看未完成作品</el-button>
        </div>
        <el-table :data="recentTasks">
          <el-table-column prop="title" label="任务名" min-width="180" />
          <el-table-column prop="kind" label="类型" width="100" />
          <el-table-column prop="status" label="状态" width="100" />
          <el-table-column prop="time" label="时间" width="150" />
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'

const store = useAppStore()
const router = useRouter()

function dayStamp(offset) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

const today = dayStamp(0)
const yesterday = dayStamp(-1)
const yesterdayLabel = yesterday

function onDay(list, day, status) {
  return list.filter((item) => String(item.createdAt || item.time || '').slice(0, 10) === day && (!status || item.status === status)).length
}

const compareCards = computed(() => {
  const rows = [
    ['待审核', '已生成'],
    ['审核通过', '审核通过'],
    ['发布成功', '已发布'],
    ['发布失败', '发布失败'],
    ['生成成功', '已生成'],
    ['生成失败', '生成失败'],
    ['生成中', '生成中'],
    ['待生成', '待生成']
  ]
  return rows.map(([label, status]) => {
    const todayCount = onDay(store.works, today, status)
    const yesterdayCount = onDay(store.works, yesterday, status)
    return { label, today: todayCount, yesterday: yesterdayCount, delta: todayCount - yesterdayCount }
  })
})

const stockCards = computed(() => [
  { label: '待审核', value: store.works.filter((item) => item.status === '已生成').length },
  { label: '已通过待发布', value: store.works.filter((item) => item.status === '审核通过').length },
  { label: '未生成文案', value: store.products.filter((item) => !item.scriptReady).length },
  { label: '制作中', value: store.works.filter((item) => item.status === '生成中').length },
  { label: '待生成', value: store.works.filter((item) => item.status === '待生成').length },
  { label: '发布失败', value: store.works.filter((item) => item.status === '发布失败' || item.status === '审核失败').length }
])

const hotRows = computed(() => {
  const rows = [...store.products]
    .map((item) => ({
      id: item.id,
      title: item.title,
      monthlySales: Number(item.monthlySales) || 0,
      rate: Number(item.rate) || 0
    }))
    .filter((item) => item.monthlySales > 0)
    .sort((a, b) => b.monthlySales - a.monthlySales)
    .slice(0, 8)
  const max = Math.max(...rows.map((item) => item.monthlySales), 1)
  return rows.map((item) => ({ ...item, percent: Math.max(8, Math.round((item.monthlySales / max) * 100)) }))
})

const recentTasks = computed(() => store.works.slice(0, 8).map((item) => ({
  title: item.title,
  kind: item.kind || item.model || '视频',
  status: item.status,
  time: item.createdAt
})))
</script>

<style scoped>
.hot-list { display: grid; gap: 12px; }
.hot-row { display: grid; gap: 6px; }
.hot-meta { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
.hot-meta strong {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.hot-meta span { color: #98a2b3; font-size: 12px; flex: none; }
.hot-bar {
  height: 8px;
  border-radius: 999px;
  background: #f2f4f7;
  overflow: hidden;
}
.hot-bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #3b6cff, #6aa1ff);
}
</style>
