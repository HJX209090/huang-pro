<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>选品广场</h1>
        <p>商品按发布账号分开保存。同步失败时，已经入库的商品不会被清掉。</p>
      </div>
      <el-button type="primary" :loading="syncing" @click="syncNow">同步广场</el-button>
    </div>
    <div class="panel filters">
      <el-select v-model="accountId" placeholder="发布账号" style="width: 180px">
        <el-option v-for="item in store.publishAccounts" :key="item.id" :label="accountLabel(item)" :value="item.id" />
      </el-select>
      <el-input v-model="keywordInput" clearable placeholder="商品名 / 店铺" style="width: 200px" />
      <el-select v-model="category" clearable placeholder="类目" style="width: 150px">
        <el-option v-for="item in categories" :key="item" :label="item" :value="item" />
      </el-select>
      <el-select v-model="source" clearable placeholder="类型" style="width: 130px">
        <el-option v-for="item in sources" :key="item" :label="item" :value="item" />
      </el-select>
      <el-date-picker
        v-model="range"
        type="daterange"
        value-format="YYYY-MM-DD"
        start-placeholder="入库开始"
        end-placeholder="入库结束"
        style="width: 250px"
      />
    </div>
    <div class="panel filters">
      <span class="muted">售价大于</span>
      <el-input-number v-model="minPrice" :min="0" :precision="2" controls-position="right" />
      <span class="muted">佣金率</span>
      <el-select v-model="rateOp" style="width: 90px">
        <el-option label="大于" value="gt" />
        <el-option label="小于" value="lt" />
        <el-option label="等于" value="eq" />
      </el-select>
      <el-input-number v-model="rateValue" :min="0" :max="100" controls-position="right" />
      <span class="muted">%</span>
      <el-button @click="clearFilters">清空筛选</el-button>
      <div class="grow">
        <el-radio-group v-model="viewMode" size="small">
          <el-radio-button value="card">卡片</el-radio-button>
          <el-radio-button value="list">列表</el-radio-button>
        </el-radio-group>
        <el-checkbox :model-value="allChecked" :indeterminate="someChecked" @change="toggleAll">全选本页</el-checkbox>
        <el-button type="primary" :disabled="!selected.length" @click="addSelected">批量入库 {{ selected.length }}</el-button>
      </div>
    </div>
    <div v-if="syncing || progress" class="panel" style="padding: 12px 16px">
      <div class="muted" style="margin-bottom: 8px">{{ syncText }}</div>
      <el-progress :percentage="progress" :stroke-width="10" />
    </div>
    <p v-if="!accountRows.length && !syncing" class="muted">这个账号还没有广场商品。换到已经同步过的发布账号，或者再同步一次。之前同步成功的商品还在对应账号下面。</p>
    <p v-else-if="!filtered.length && !syncing" class="muted">没有符合当前筛选的商品。</p>
    <el-table v-if="viewMode === 'list' && pageRows.length" :data="pageRows" @selection-change="onTableSelect">
      <el-table-column type="selection" width="42" />
      <el-table-column label="商品" min-width="280">
        <template #default="{ row }">
          <div class="plaza-list-goods">
            <img v-if="shotList(row)[0]" class="plaza-list-thumb" :src="imageUrl(shotList(row)[0])" alt="" />
            <div>
              <div class="goods-title">{{ row.title }}</div>
              <div class="goods-sub">{{ goodsShop(row) }} · {{ goodsCategory(row) }}</div>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="售价" width="100">
        <template #default="{ row }">¥{{ Number(row.price).toFixed(2) }}</template>
      </el-table-column>
      <el-table-column label="佣金" width="90">
        <template #default="{ row }"><span class="commission">{{ row.rate }}%</span></template>
      </el-table-column>
      <el-table-column label="预估赚" width="100">
        <template #default="{ row }">¥{{ earn(row.price, row.rate) }}</template>
      </el-table-column>
      <el-table-column prop="createdAt" label="入库" width="150" />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.added" link @click="goLibrary">已在库</el-button>
          <el-button v-else link type="primary" @click="addOne(row.id)">入库</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div v-else-if="viewMode === 'card'" class="plaza-grid plaza-grid-compact">
      <article v-for="item in pageRows" :key="item.id" class="plaza-card plaza-card-compact" :class="{ picked: selected.includes(item.id) }">
        <el-checkbox class="work-pick" :model-value="selected.includes(item.id)" @change="toggle(item.id)" />
        <HoverPreview v-if="shotList(item).length" :images="shotList(item)" block>
          <img class="plaza-cover" :src="imageUrl(shotList(item)[0])" alt="" loading="lazy" decoding="async" />
        </HoverPreview>
        <div v-else class="plaza-cover" :style="coverStyle(item.hue)"></div>
        <div class="plaza-body">
          <div class="goods-title">{{ item.title }}</div>
          <div class="plaza-chips">
            <em>{{ goodsCategory(item) }}</em>
            <em>{{ Number(item.rate) }}%</em>
          </div>
          <div class="plaza-stats">
            <div>
              <span>售价</span>
              <b class="price">¥{{ Number(item.price).toFixed(2) }}</b>
            </div>
            <div>
              <span>预估赚</span>
              <b>¥{{ earn(item.price, item.rate) }}</b>
            </div>
          </div>
          <el-button v-if="item.added" size="small" @click="goLibrary">已在库中</el-button>
          <el-button v-else size="small" type="primary" @click="addOne(item.id)">加入选品库</el-button>
        </div>
      </article>
    </div>
    <el-dialog v-model="trendOpen" :title="trendItem?.title || '商品曲线'" width="760px" @closed="trendHover = -1">
      <div v-if="trendItem" class="trend-panel">
        <div class="plaza-stats">
          <div><span>点数</span><b>{{ trendDots.length }}</b></div>
          <div><span>最低</span><b>{{ trendMin }}</b></div>
          <div><span>最高</span><b>{{ trendMax }}</b></div>
          <div><span>最近</span><b>{{ trendDots[trendDots.length - 1]?.value }}</b></div>
        </div>
        <div class="trend-chart-wrap" @mouseleave="trendHover = -1">
          <svg class="trend-chart" viewBox="0 0 640 280" role="img" aria-label="商品曲线">
            <polyline :points="trendLine" />
            <g v-for="dot in trendDots" :key="dot.index">
              <text class="trend-value" :x="dot.x" :y="dot.y - 10" text-anchor="middle">{{ dot.value }}</text>
              <circle class="trend-dot" :class="{ hot: trendHover === dot.index }" :cx="dot.x" :cy="dot.y" r="3.5" />
              <circle class="trend-hit" :cx="dot.x" :cy="dot.y" r="12" @mouseenter="trendHover = dot.index" />
              <g v-if="dot.date" :transform="`translate(${dot.x}, 214) rotate(-38)`">
                <text class="trend-axis">{{ dot.date }}</text>
                <text v-if="dot.clock" class="trend-axis" y="13">{{ dot.clock }}</text>
              </g>
            </g>
          </svg>
          <p v-if="trendDots.length && trendDots.every((item) => !item.date)" class="muted">这次曲线只有销量。再同步一次后，接口如果带回了时间，横轴会标出年月日和时间。</p>
          <div v-if="hoverDot" class="trend-tip" :style="tipStyle">
            <b>{{ hoverDot.date || '这次没有返回日期' }}</b>
            <span v-if="hoverDot.clock">{{ hoverDot.clock }}</span>
            <span>销量 {{ hoverDot.value }}</span>
          </div>
        </div>
        <el-table :data="trendRows" size="small" max-height="280">
          <el-table-column prop="time" label="时间" min-width="180" />
          <el-table-column prop="value" label="销量" width="120" />
        </el-table>
      </div>
    </el-dialog>
    <div v-if="filtered.length" class="pager">
      <el-pagination
        background
        layout="total, sizes, prev, pager, next"
        :total="filtered.length"
        :page-sizes="[8, 12, 20, 40, 60]"
        v-model:page-size="pageSize"
        v-model:current-page="page"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAppStore } from '@/stores/app'
import HoverPreview from '@/components/HoverPreview.vue'
import { coverStyle, earn, imageUrl } from '@/utils/format'
import { goodsCategory, goodsShop } from '@/utils/goods'

const store = useAppStore()
const router = useRouter()
const accountId = ref(store.activeAccountId || '')
const keywordInput = ref('')
const keyword = ref('')
let keywordTimer = 0
const category = ref('')
const source = ref('')
const range = ref([])
const minPrice = ref(0)
const rateOp = ref('gt')
const rateValue = ref(0)
const selected = ref([])
const viewMode = ref('card')
const page = ref(1)
const pageSize = ref(20)
const trendItem = ref(null)
const trendOpen = ref(false)
const trendHover = ref(-1)
const syncing = ref(false)
const progress = ref(0)
const syncText = ref('')
let progressTimer = 0

watch(() => store.activeAccountId, (id) => {
  if (id && !accountId.value) accountId.value = id
})

if (!accountId.value || !store.plaza.some((item) => item.accountId === accountId.value)) {
  const found = store.publishAccounts.find((item) => store.plaza.some((row) => row.accountId === item.id))
  if (found) accountId.value = found.id
}

function shotList(item) {
  return [...new Set([...(item?.images || []), item?.image].map((src) => String(src || '')).filter(Boolean))]
}

function readTrend(values) {
  return (values || []).map((item) => {
    if (typeof item === 'number') return Number.isFinite(item) ? { value: item, time: '' } : null
    const value = Number(item?.value ?? item?.v)
    if (!Number.isFinite(value)) return null
    return { value, time: String(item.time || item.t || '') }
  }).filter(Boolean)
}

function splitTrendTime(time) {
  const text = String(time || '').trim()
  const matched = text.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/)
  if (!matched) return { date: text, clock: '' }
  return { date: matched[1], clock: matched[2] || '' }
}

function sparkPoints(values) {
  const rows = readTrend(values)
  if (rows.length < 2) return ''
  const max = Math.max(...rows.map((item) => item.value))
  const min = Math.min(...rows.map((item) => item.value))
  const span = max - min || 1
  return rows.map((item, index) => {
    const x = (index / (rows.length - 1)) * 120
    const y = 32 - ((item.value - min) / span) * 28
    return `${x},${y}`
  }).join(' ')
}

function chartPoints(values) {
  const rows = readTrend(values)
  if (rows.length < 2) return []
  const max = Math.max(...rows.map((item) => item.value))
  const min = Math.min(...rows.map((item) => item.value))
  const span = max - min || 1
  const left = 28
  const right = 18
  const top = 24
  const bottom = 86
  const width = 640
  const height = 280
  return rows.map((item, index) => {
    const parts = splitTrendTime(item.time)
    return {
      index,
      value: item.value,
      date: parts.date,
      clock: parts.clock,
      x: left + (index / (rows.length - 1)) * (width - left - right),
      y: top + (1 - (item.value - min) / span) * (height - top - bottom)
    }
  })
}

function openTrend(item) {
  trendHover.value = -1
  trendItem.value = item
  trendOpen.value = true
}

const trendDots = computed(() => chartPoints(trendItem.value?.trend))
const trendMin = computed(() => trendDots.value.length ? Math.min(...trendDots.value.map((item) => item.value)) : 0)
const trendMax = computed(() => trendDots.value.length ? Math.max(...trendDots.value.map((item) => item.value)) : 0)
const trendLine = computed(() => trendDots.value.map((dot) => `${dot.x},${dot.y}`).join(' '))
const hoverDot = computed(() => trendDots.value.find((item) => item.index === trendHover.value) || null)
const tipStyle = computed(() => hoverDot.value ? { left: `${(hoverDot.value.x / 640) * 100}%`, top: `${(hoverDot.value.y / 280) * 100}%` } : {})
const trendRows = computed(() => trendDots.value.map((dot) => ({
  time: [dot.date, dot.clock].filter(Boolean).join(' ') || '未返回时间',
  value: dot.value
})))

const plazaCounts = computed(() => {
  const counts = {}
  store.plaza.forEach((row) => {
    const id = row.accountId || ''
    counts[id] = (counts[id] || 0) + 1
  })
  return counts
})

function accountLabel(item) {
  const count = plazaCounts.value[item.id] || 0
  return count ? `${item.name}（${count}）` : item.name
}

const accountRows = computed(() => store.plaza.filter((item) => (item.accountId || '') === (accountId.value || '')))
const categories = computed(() => [...new Set(accountRows.value.map((item) => goodsCategory(item)))])
const sources = computed(() => [...new Set(accountRows.value.map((item) => item.source).filter(Boolean))])

const filtered = computed(() => accountRows.value.filter((item) => {
  if (keyword.value && !`${item.title}${item.shop}`.includes(keyword.value.trim())) return false
  if (category.value && goodsCategory(item) !== category.value) return false
  if (source.value && item.source !== source.value) return false
  if (Number(item.price) <= Number(minPrice.value || 0) && Number(minPrice.value) > 0) return false
  const rate = Number(item.rate) || 0
  const target = Number(rateValue.value)
  if (target > 0 || rateOp.value === 'eq') {
    if (rateOp.value === 'gt' && target > 0 && rate <= target) return false
    if (rateOp.value === 'lt' && rate >= target) return false
    if (rateOp.value === 'eq' && rate !== target) return false
  }
  if (range.value?.length === 2) {
    const day = String(item.createdAt || '').slice(0, 10)
    if (day < range.value[0] || day > range.value[1]) return false
  }
  return true
}))

const pageRows = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const allChecked = computed(() => pageRows.value.length > 0 && pageRows.value.every((item) => selected.value.includes(item.id)))
const someChecked = computed(() => pageRows.value.some((item) => selected.value.includes(item.id)) && !allChecked.value)

watch(keywordInput, (value) => {
  clearTimeout(keywordTimer)
  keywordTimer = setTimeout(() => {
    keyword.value = value
  }, 200)
})

watch([accountId, keyword, category, source, range, minPrice, rateOp, rateValue, pageSize], () => {
  page.value = 1
  selected.value = []
})

function toggle(id) {
  selected.value = selected.value.includes(id) ? selected.value.filter((item) => item !== id) : selected.value.concat(id)
}

function toggleAll(checked) {
  const ids = pageRows.value.map((item) => item.id)
  selected.value = checked ? [...new Set(selected.value.concat(ids))] : selected.value.filter((id) => !ids.includes(id))
}

function onTableSelect(rows) {
  const pageIds = new Set(pageRows.value.map((item) => item.id))
  const kept = selected.value.filter((id) => !pageIds.has(id))
  selected.value = kept.concat(rows.map((item) => item.id))
}

function clearFilters() {
  keywordInput.value = ''
  keyword.value = ''
  category.value = ''
  source.value = ''
  range.value = []
  minPrice.value = 0
  rateOp.value = 'gt'
  rateValue.value = 0
}

function goLibrary() {
  if (accountId.value) store.activeAccountId = accountId.value
  router.push('/products')
}

function addOne(id) {
  if (accountId.value) store.activeAccountId = accountId.value
  const item = store.addFromPlaza(id)
  if (!item) return ElMessage.info('这件商品已经在选品库里')
  ElMessage.success(`已入库：${item.title}`)
}

function addSelected() {
  if (accountId.value) store.activeAccountId = accountId.value
  let count = 0
  selected.value.forEach((id) => {
    if (store.addFromPlaza(id)) count += 1
  })
  selected.value = []
  ElMessage.success(count ? `已批量入库 ${count} 件` : '选中的商品已经在库里')
}

function startProgress() {
  progress.value = 8
  const limit = String(store.settings.plazaPageLimit || '').trim()
  syncText.value = limit ? `开始同步，最多 ${limit} 页，拉到就先显示` : '开始同步，不限页数，拉到就先显示'
  clearInterval(progressTimer)
  progressTimer = setInterval(() => {
    if (progress.value < 90) progress.value = Math.min(90, progress.value + 4)
    const count = plazaCounts.value[accountId.value] || 0
    syncText.value = count ? `已显示 ${count} 件，还在继续拉` : '正在拉第一页'
  }, 400)
}

function finishProgress(text) {
  clearInterval(progressTimer)
  progress.value = 100
  syncText.value = text
  setTimeout(() => {
    progress.value = 0
    syncText.value = ''
  }, 1600)
}

async function syncNow() {
  if (syncing.value) return
  if (!accountId.value) return ElMessage.warning('先选择一个发布账号')
  syncing.value = true
  startProgress()
  store.activeAccountId = accountId.value
  try {
    const result = await store.syncCatalog('plaza')
    const count = result.count || 0
    finishProgress(count ? `已同步 ${count} 件，已保存在这个账号下` : '这次没有拉到新商品，已有的会继续留着')
    if (count) ElMessage.success(`广场已更新 ${count} 件商品`)
    else ElMessage.warning(result.message || '这次没有拉到广场商品，已有商品还在')
  } catch (error) {
    clearInterval(progressTimer)
    progress.value = 0
    syncText.value = ''
    ElMessage.error(error.message || '同步失败，已有商品还在')
  } finally {
    syncing.value = false
  }
}
</script>
