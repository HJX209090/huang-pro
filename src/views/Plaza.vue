<template>
  <div class="page plaza-page">
    <div class="plaza-top">
      <div class="plaza-tabs">
        <button v-for="item in plazaTabs" :key="item.id" type="button" :class="{ on: plazaTab === item.id }" @click="plazaTab = item.id">{{ item.label }}</button>
      </div>
      <div class="plaza-views">
        <button type="button" :class="{ on: viewMode === 'table' }" @click="viewMode = 'table'">视图</button>
        <button type="button" :class="{ on: viewMode === 'list' }" @click="viewMode = 'list'">列表</button>
        <button type="button" :class="{ on: viewMode === 'card' }" @click="viewMode = 'card'">卡片</button>
        <el-button type="primary" :loading="syncing" @click="syncNow">同步广场</el-button>
      </div>
    </div>
    <div class="plaza-filters">
      <el-select v-model="accountId" placeholder="发布账号" style="width: 150px">
        <el-option v-for="item in store.publishAccounts" :key="item.id" :label="accountLabel(item)" :value="item.id" />
      </el-select>
      <el-select v-model="category" clearable placeholder="类目" style="width: 130px">
        <el-option label="全部类目" value="" />
        <el-option v-for="item in categories" :key="item" :label="item" :value="item" />
      </el-select>
      <el-input v-model="keywordInput" clearable placeholder="商品名 / ID / 链接 / 短链" style="width: 240px" @keyup.enter="applySearch" />
      <el-select v-model="salesBand" style="width: 120px">
        <el-option label="月销 不限" value="" />
        <el-option label="月销 1万+" value="1w" />
        <el-option label="月销 5万+" value="5w" />
      </el-select>
      <el-select v-model="priceBand" style="width: 120px">
        <el-option label="售价 不限" value="" />
        <el-option label="20元以下" value="low" />
        <el-option label="20-50元" value="mid" />
        <el-option label="50元以上" value="high" />
      </el-select>
      <el-select v-model="rateBand" style="width: 120px">
        <el-option label="佣金 不限" value="" />
        <el-option label="佣金 10%+" value="10" />
        <el-option label="佣金 20%+" value="20" />
        <el-option label="佣金 30%+" value="30" />
      </el-select>
      <el-select v-model="sortKey" style="width: 140px">
        <el-option label="近30天销量" value="sales" />
        <el-option label="售价" value="price" />
        <el-option label="佣金率" value="rate" />
        <el-option label="预估佣金" value="earn" />
      </el-select>
      <el-select v-model="sortDesc" style="width: 90px">
        <el-option label="倒序" :value="true" />
        <el-option label="正序" :value="false" />
      </el-select>
      <el-button type="primary" @click="applySearch">搜索</el-button>
    </div>
    <p class="plaza-hint">月销、售价、佣金和排序按当前账号的广场库计算。可一次取前 50、100 或 200 条加入选品车。点行勾选，点标题打开曲线，按住表头右缘可拖列宽。</p>
    <div v-if="syncing || progress" class="panel" style="padding: 12px 16px">
      <div class="muted" style="margin-bottom: 8px">{{ syncText }}</div>
      <el-progress :percentage="progress" :stroke-width="10" />
    </div>
    <p v-if="!accountRows.length && !syncing" class="muted">这个账号还没有广场商品。换到已经同步过的发布账号，或者再同步一次。之前同步成功的商品还在对应账号下面。</p>
    <p v-else-if="!filtered.length && !syncing" class="muted">没有符合当前筛选的商品。</p>
    <div v-if="viewMode !== 'card' && pageRows.length" class="plaza-table-wrap">
      <table class="plaza-table" :class="{ compact: viewMode === 'table' }">
        <colgroup>
          <col style="width: 42px" />
          <col :style="{ width: colWidths.info + 'px' }" />
          <col :style="{ width: colWidths.price + 'px' }" />
          <col :style="{ width: colWidths.rate + 'px' }" />
          <col :style="{ width: colWidths.earn + 'px' }" />
          <col :style="{ width: colWidths.sales + 'px' }" />
          <col :style="{ width: colWidths.shop + 'px' }" />
          <col :style="{ width: colWidths.op + 'px' }" />
        </colgroup>
        <thead>
          <tr>
            <th><el-checkbox :model-value="allChecked" :indeterminate="someChecked" @change="toggleAll" /></th>
            <th>商品信息<span class="col-resize" @mousedown.prevent="startResize('info', $event)"></span></th>
            <th>售价<span class="col-resize" @mousedown.prevent="startResize('price', $event)"></span></th>
            <th>佣金率<span class="col-resize" @mousedown.prevent="startResize('rate', $event)"></span></th>
            <th>预估佣金<span class="col-resize" @mousedown.prevent="startResize('earn', $event)"></span></th>
            <th>月销<span class="col-resize" @mousedown.prevent="startResize('sales', $event)"></span></th>
            <th>店铺<span class="col-resize" @mousedown.prevent="startResize('shop', $event)"></span></th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in pageRows" :key="row.id" :class="{ picked: selected.includes(row.id) }" @click="toggle(row.id)">
            <td @click.stop><el-checkbox :model-value="selected.includes(row.id)" @change="toggle(row.id)" /></td>
            <td>
              <div class="plaza-goods">
                <HoverPreview v-if="shotList(row).length" :images="shotList(row)" block>
                  <img :src="imageUrl(shotList(row)[0])" alt="" />
                </HoverPreview>
                <div>
                  <button type="button" class="goods-title linkish" @click.stop="openTrend(row)">{{ row.title }}</button>
                  <div class="goods-sub">ID {{ row.id }} · 达人 {{ Number(row.rate) || 0 }}%</div>
                </div>
              </div>
            </td>
            <td class="price">¥{{ Number(row.price || 0).toFixed(2) }}</td>
            <td class="commission">{{ Number(row.rate) || 0 }}%</td>
            <td class="earn">¥{{ earn(row.price, row.rate) }}</td>
            <td>{{ Number(row.monthlySales) || 0 }}</td>
            <td>{{ goodsShop(row) }}</td>
            <td @click.stop>
              <el-button link type="primary" @click="copyLink(row)">复制链接</el-button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
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
    <div v-if="sorted.length" class="plaza-tray">
      <el-checkbox :model-value="allChecked" :indeterminate="someChecked" @change="toggleAll">本页全选</el-checkbox>
      <span>已选 {{ selected.length }}</span>
      <el-button @click="dropInCart">去掉已在车</el-button>
      <el-button @click="selected = []">清空</el-button>
      <el-button type="primary" :disabled="!selected.length" @click="addSelected">加入选品车</el-button>
      <el-button type="primary" plain @click="takeFirst(50)">取前 50 条加入</el-button>
      <el-button type="primary" plain @click="takeFirst(100)">取前 100 条加入</el-button>
      <el-button type="primary" plain @click="takeFirst(200)">取前 200 条加入</el-button>
    </div>
    <div v-if="sorted.length" class="pager">
      <el-pagination
        background
        layout="total, sizes, prev, pager, next"
        :total="sorted.length"
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
import { coverStyle, earn, imageUrl, keepProductImage } from '@/utils/format'
import { cleanTitle } from '@/utils/banned'
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
const viewMode = ref('list')
const plazaTab = ref('search')
const salesBand = ref('')
const priceBand = ref('')
const rateBand = ref('')
const sortKey = ref('sales')
const sortDesc = ref(true)
const colWidths = ref({ info: 460, price: 90, rate: 90, earn: 110, sales: 110, shop: 180, op: 110 })
const plazaTabs = [
  { id: 'search', label: '检索选品' },
  { id: 'hot', label: '爆品单' },
  { id: 'share', label: '可分享库' },
  { id: 'newcat', label: '类目上新' },
  { id: 'recommend', label: '系统推荐' },
  { id: 'recent', label: '用户近期发布' }
]
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
  return [...new Set([...(item?.images || []), item?.image].map((src) => String(src || '').trim()).filter((src) => keepProductImage(src)))]
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
  const query = keyword.value.trim()
  if (query && !`${item.title || ''}${item.shop || ''}${item.id || ''}${item.link || ''}`.includes(query)) return false
  if (category.value && goodsCategory(item) !== category.value) return false
  const sales = Number(item.monthlySales) || 0
  const price = Number(item.price) || 0
  const rate = Number(item.rate) || 0
  if (salesBand.value === '1w' && sales < 10000) return false
  if (salesBand.value === '5w' && sales < 50000) return false
  if (priceBand.value === 'low' && price >= 20) return false
  if (priceBand.value === 'mid' && (price < 20 || price >= 50)) return false
  if (priceBand.value === 'high' && price < 50) return false
  if (rateBand.value === '10' && rate < 10) return false
  if (rateBand.value === '20' && rate < 20) return false
  if (rateBand.value === '30' && rate < 30) return false
  const day = String(item.createdAt || '').slice(0, 10)
  const recent = !day || day >= new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const fresh = !day || day >= new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)
  if (plazaTab.value === 'hot' && sales < 10000) return false
  if (plazaTab.value === 'share' && !item.link) return false
  if (plazaTab.value === 'newcat' && !fresh) return false
  if (plazaTab.value === 'recommend' && rate < 20) return false
  if (plazaTab.value === 'recent' && !recent) return false
  return true
}))

const sorted = computed(() => {
  const dir = sortDesc.value ? -1 : 1
  const valueOf = (row) => {
    if (sortKey.value === 'price') return Number(row.price) || 0
    if (sortKey.value === 'rate') return Number(row.rate) || 0
    if (sortKey.value === 'earn') return (Number(row.price) || 0) * (Number(row.rate) || 0) / 100
    return Number(row.monthlySales) || 0
  }
  return [...filtered.value].sort((a, b) => (valueOf(a) - valueOf(b)) * dir)
})

const pageRows = computed(() => sorted.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const allChecked = computed(() => pageRows.value.length > 0 && pageRows.value.every((item) => selected.value.includes(item.id)))
const someChecked = computed(() => pageRows.value.some((item) => selected.value.includes(item.id)) && !allChecked.value)

watch(keywordInput, (value) => {
  clearTimeout(keywordTimer)
  keywordTimer = setTimeout(() => {
    keyword.value = value
  }, 200)
})

watch([accountId, keyword, category, plazaTab, salesBand, priceBand, rateBand, sortKey, sortDesc, pageSize], () => {
  page.value = 1
  selected.value = []
})

function applySearch() {
  keyword.value = keywordInput.value
}

function inCart(item) {
  return Boolean(item?.added) || store.products.some((row) => row.id === item.id && (row.accountId || '') === (accountId.value || store.activeAccountId || ''))
}

function startResize(key, event) {
  const startX = event.clientX
  const start = colWidths.value[key]
  const move = (e) => { colWidths.value[key] = Math.max(72, start + e.clientX - startX) }
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

async function copyLink(row) {
  const link = row.link || `https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=${row.id}`
  try {
    await navigator.clipboard.writeText(link)
    ElMessage.success('已复制商品链接')
  } catch {
    ElMessage.warning(link)
  }
}

function dropInCart() {
  selected.value = selected.value.filter((id) => {
    const item = store.plaza.find((row) => row.id === id)
    return item && !inCart(item)
  })
}

async function admit(ids) {
  const rows = ids.map((id) => store.plaza.find((row) => row.id === id)).filter((item) => item && !inCart(item))
  if (!rows.length) {
    ElMessage.info('这些商品已经在选品车里')
    return 0
  }
  const risky = rows.filter((item) => cleanTitle(item.title, store.settings.bannedWords).changed).length
  if (accountId.value) store.activeAccountId = accountId.value
  let count = 0
  rows.forEach((item) => {
    if (store.addFromPlaza(item.id)) count += 1
  })
  selected.value = selected.value.filter((id) => !ids.includes(id))
  if (!count) ElMessage.success('选中的商品已经在车里')
  else if (risky) ElMessage.success(`已加入选品车 ${count} 件，其中 ${risky} 件标题已去掉违禁词`)
  else ElMessage.success(`已加入选品车 ${count} 件`)
  return count
}

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
  admit([id])
}

function addSelected() {
  admit([...selected.value])
}

function takeFirst(count) {
  const ids = sorted.value.filter((item) => !inCart(item)).slice(0, count).map((item) => item.id)
  if (!ids.length) return ElMessage.info('当前排序结果里没有还能加入的商品')
  admit(ids)
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

<style scoped>
.plaza-top, .plaza-filters, .plaza-views { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.plaza-top { justify-content: space-between; margin-bottom: 12px; }
.plaza-tabs { display: flex; gap: 18px; border-bottom: 1px solid #eceef3; }
.plaza-tabs button, .plaza-views button { border: 0; background: transparent; color: #667085; cursor: pointer; padding: 8px 2px 10px; }
.plaza-tabs button.on { color: #6d4aff; font-weight: 700; box-shadow: inset 0 -2px 0 #6d4aff; }
.plaza-views button { border-radius: 8px; padding: 6px 12px; background: #f3f4f8; }
.plaza-views button.on { background: #6d4aff; color: #fff; }
.plaza-filters { margin-bottom: 8px; }
.plaza-hint { color: #98a2b3; font-size: 12px; margin: 0 0 10px; }
.plaza-table-wrap { background: #fff; border: 1px solid #eceef3; border-radius: 12px; overflow: auto; }
.plaza-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.plaza-table th, .plaza-table td { padding: 12px 10px; border-bottom: 1px solid #f2f4f7; text-align: left; vertical-align: middle; position: relative; }
.plaza-table th { color: #98a2b3; font-weight: 500; background: #fafbff; }
.plaza-table tr.picked { background: #f6f3ff; }
.plaza-table .compact td { padding: 8px; }
.plaza-goods { display: flex; gap: 10px; align-items: center; }
.plaza-goods img { width: 72px; height: 72px; object-fit: cover; border-radius: 8px; background: #f3f4f6; cursor: zoom-in; }
.plaza-goods .linkish { border: 0; background: transparent; padding: 0; text-align: left; cursor: pointer; color: #344054; }
.price { color: #e11d48; font-weight: 700; }
.commission, .earn { color: #16a34a; font-weight: 700; }
.col-resize { position: absolute; top: 0; right: 0; width: 8px; height: 100%; cursor: col-resize; }
.col-resize:hover { background: #6d4aff; }
.plaza-tray {
  position: sticky; bottom: 8px; z-index: 5; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  margin-top: 12px; padding: 10px 12px; background: #fff; border: 1px solid #eceef3; border-radius: 12px;
  box-shadow: 0 8px 24px rgba(16, 24, 40, .08);
}
</style>
