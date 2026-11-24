<template>
  <div class="page library-page">
    <MatrixTabs />
    <div class="panel library-head">
      <div class="library-account">
        <span class="muted">当前抖音账号</span>
        <el-select v-model="store.activeAccountId" placeholder="先添加发布账号" style="width: 240px" @change="store.persist()">
          <el-option v-for="item in store.publishAccounts" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
        <span class="muted">每个账号的选品分开保存</span>
      </div>
      <div class="library-actions">
        <el-button type="primary" plain @click="openTalent">打开达人选品</el-button>
        <el-button type="primary" plain :loading="syncing" @click="syncNow">同步选品车</el-button>
        <el-button @click="router.push({ path: '/products', query: { tab: 'cart' } })">去采集账号</el-button>
        <el-button @click="drawerOpen = true">提示词模板</el-button>
        <el-button @click="templateVisible = true">视频选品词</el-button>
      </div>
    </div>

    <div class="panel library-filter">
      <el-input v-model="keyword" clearable placeholder="标题 / 商品 ID / 店铺" class="filter-search" />
      <el-select v-model="source" clearable placeholder="来源" style="width: 120px">
        <el-option v-for="item in sources" :key="item" :label="item" :value="item" />
      </el-select>
      <el-select v-model="category" clearable placeholder="类目" style="width: 120px">
        <el-option v-for="item in categories" :key="item" :label="item" :value="item" />
      </el-select>
      <el-select v-model="shipping" clearable placeholder="包邮" style="width: 100px">
        <el-option label="包邮" value="yes" />
        <el-option label="非包邮" value="no" />
      </el-select>
      <el-select v-model="coupon" clearable placeholder="优惠" style="width: 120px">
        <el-option v-for="item in coupons" :key="item" :label="item" :value="item" />
      </el-select>
      <el-date-picker
        v-model="range"
        type="daterange"
        value-format="YYYY-MM-DD"
        start-placeholder="入库起"
        end-placeholder="入库止"
        style="width: 240px"
      />
      <div class="filter-sales">
        <span class="muted">月销</span>
        <el-select v-model="salesOp" style="width: 84px">
          <el-option label="大于" value="gt" />
          <el-option label="小于" value="lt" />
          <el-option label="等于" value="eq" />
        </el-select>
        <el-input-number v-model="salesValue" :min="0" controls-position="right" style="width: 110px" />
      </div>
      <el-button type="primary" @click="page = 1">查询</el-button>
      <el-button @click="resetFilters">重置</el-button>
    </div>

    <div class="panel library-import">
      <el-input v-model="linkText" type="textarea" :rows="2" placeholder="粘贴商品链接或商品 ID，一行一个。精选联盟、商品详情链接都可以。" />
      <div class="import-side">
        <el-button type="primary" :loading="addingLinks" @click="addLinks">加入选品</el-button>
        <el-button @click="fileRef.click()">导入模板</el-button>
        <el-button @click="downloadTemplate">下载模板</el-button>
        <el-button @click="clearTemplate">清除自定义模板</el-button>
      </div>
      <input ref="fileRef" type="file" accept=".csv,text/csv,.json,application/json" hidden @change="onImport" />
    </div>

    <div v-if="syncing || progress" class="panel" style="padding: 12px 16px">
      <div class="muted" style="margin-bottom: 8px">{{ syncText }}</div>
      <el-progress :percentage="progress" :stroke-width="10" />
    </div>

    <div class="panel">
      <p v-if="!filtered.length && !syncing" class="muted">这个账号还没有选品。同步选品车，或粘贴商品 ID 导入。</p>
      <div class="toolbar library-toolbar">
        <span>商品列表 <b class="count">{{ filtered.length }}</b></span>
        <el-radio-group v-model="scriptFilter" size="small">
          <el-radio-button value="全部">全部</el-radio-button>
          <el-radio-button value="外部同步">外部同步</el-radio-button>
          <el-radio-button value="未生成提示词">未生成提示词</el-radio-button>
          <el-radio-button value="已生成提示词">已生成提示词</el-radio-button>
        </el-radio-group>
        <div class="grow">
          <el-button type="primary" plain :disabled="!selection.length" @click="makePrompts">生成提示词（{{ selection.length }}）</el-button>
          <el-button type="primary" :disabled="!selection.length" @click="generateSelected">批量生成视频（{{ selection.length }}）</el-button>
          <el-button :disabled="!selection.length" @click="removeSelected">批量删除</el-button>
        </div>
      </div>
      <el-table :data="pageRows" @selection-change="onSelect">
        <el-table-column type="selection" width="42" />
        <el-table-column label="商品" min-width="280">
          <template #default="{ row }">
            <div class="goods">
              <div v-if="shotList(row).length" class="shot-strip">
                <img v-for="src in shotList(row).slice(0, 5)" :key="src" class="thumb" :src="imageUrl(src)" alt="" @click="openShots(row)" />
                <el-button v-if="shotList(row).length > 5" link type="primary" @click="openShots(row)">更多 {{ shotList(row).length - 5 }}</el-button>
              </div>
              <div v-else class="thumb" :style="coverStyle(row.hue)"></div>
              <div>
                <div class="goods-title">{{ row.title }}</div>
                <div class="goods-sub">ID {{ row.id }} · {{ row.shop }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="价格" width="90">
          <template #default="{ row }"><span class="price">¥{{ Number(row.price).toFixed(2) }}</span></template>
        </el-table-column>
        <el-table-column label="佣金" width="110">
          <template #default="{ row }">
            <div class="commission">
              <b>{{ row.rate }}%</b>
              <span>预估赚 ¥{{ earn(row.price, row.rate) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="类目" width="100">
          <template #default="{ row }">{{ goodsCategory(row) }}</template>
        </el-table-column>
        <el-table-column label="优惠" width="140">
          <template #default="{ row }">{{ goodsTags(row).join(' ') || '无' }}</template>
        </el-table-column>
        <el-table-column prop="monthlySales" label="月销" width="80" />
        <el-table-column prop="source" label="来源" width="100" />
        <el-table-column label="文案" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="row.scriptReady ? 'success' : 'info'">{{ row.scriptReady ? '已生成提示词' : '未生成提示词' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="入库时间" width="150" />
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="store.openPrompt([row.id])">确定生成视频</el-button>
            <el-button link @click="openEdit(row)">编辑</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pager">
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

    <PromptDrawer v-model="drawerOpen" />
    <el-dialog v-model="shotVisible" :title="shotRow?.title || '商品图片'" width="720px">
      <div class="shot-grid">
        <div v-for="src in shotList(shotRow)" :key="src" class="shot-cell">
          <img :src="imageUrl(src)" alt="" />
          <el-button type="danger" plain size="small" @click="removeShot(src)">删除</el-button>
        </div>
      </div>
    </el-dialog>
    <el-dialog v-model="templateVisible" title="提示词模板" width="780px" top="4vh">
      <div style="max-height: calc(100vh - 230px); overflow: auto; padding-right: 6px">
      <p class="muted" style="margin-top: 0">可以存多套模板，生成时选一套。「商品标题」会换成每件商品的名称。</p>
      <PromptTemplateBar
        :prompt-text="store.settings.promptText"
        :model="store.settings.model"
        :duration="store.settings.duration"
        :ratio="store.settings.ratio"
        :voice="store.settings.voice"
        @apply="(item) => { store.settings.promptText = item.promptText || '' }"
      />
      <el-input v-model="store.settings.promptText" type="textarea" :rows="16" placeholder="直接粘贴完整提示词" />
      </div>
      <template #footer>
        <el-button @click="downloadPromptTemplates">下载提示词模板</el-button>
        <el-button @click="promptFileRef.click()">导入提示词模板</el-button>
        <el-button type="primary" @click="templateVisible = false; store.persist()">保存到本机</el-button>
      </template>
      <input ref="promptFileRef" type="file" accept=".json,application/json" hidden @change="onImportPrompt" />
    </el-dialog>

    <el-dialog v-model="editVisible" title="编辑商品" width="480px">
      <el-form label-width="72px">
        <el-form-item label="标题"><el-input v-model="editForm.title" /></el-form-item>
        <el-form-item label="价格"><el-input-number v-model="editForm.price" :min="0" :precision="2" /></el-form-item>
        <el-form-item label="佣金"><el-input-number v-model="editForm.rate" :min="0" :max="100" /></el-form-item>
        <el-form-item label="类目"><el-input v-model="editForm.category" /></el-form-item>
        <el-form-item label="店铺"><el-input v-model="editForm.shop" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import MatrixTabs from '@/components/MatrixTabs.vue'
import { useAppStore } from '@/stores/app'
import HoverPreview from '@/components/HoverPreview.vue'
import { coverStyle, earn, formatTime, imageUrl } from '@/utils/format'
import { sanitizeProductTitle } from '@/utils/banned'
import { couponTags, goodsCategory, goodsTags, isFreeShipping } from '@/utils/goods'
import { defaultPromptSettings, upgradePromptSettings } from '@/mock/data'
import PromptTemplateBar from '@/components/PromptTemplateBar.vue'
import PromptDrawer from '@/components/PromptDrawer.vue'

const store = useAppStore()
const router = useRouter()
const keyword = ref('')
const source = ref('')
const category = ref('')
const shipping = ref('')
const coupon = ref('')
const salesOp = ref('gt')
const salesValue = ref(0)
const range = ref([])
const scriptFilter = ref('全部')
const page = ref(1)
const pageSize = ref(8)
const syncing = ref(false)
const progress = ref(0)
const syncText = ref('')
let progressTimer = 0
const selection = ref([])
const fileRef = ref()
const promptFileRef = ref()
const linkText = ref('')
const addingLinks = ref(false)
const templateVisible = ref(false)
const drawerOpen = ref(false)
const shotVisible = ref(false)
const shotRow = ref(null)
watch(templateVisible, (visible) => {
  if (!visible) return
  const before = store.settings.productLock
  upgradePromptSettings(store.settings)
  if (store.settings.productLock !== before) store.persist()
})
const editVisible = ref(false)
const editForm = reactive({ id: '', title: '', price: 0, rate: 0, category: '', shop: '' })

function shotList(item) {
  return [...new Set([...(item?.images || []), item?.image].map((src) => String(src || '')).filter(Boolean))]
}

const accountProducts = computed(() => store.products.filter((item) => (item.accountId || '') === (store.activeAccountId || '')))
const sources = computed(() => [...new Set(accountProducts.value.map((item) => item.source))])
const categories = computed(() => [...new Set(accountProducts.value.map((item) => goodsCategory(item)))])
const coupons = computed(() => [...new Set(accountProducts.value.flatMap((item) => couponTags(item)))])

const filtered = computed(() => accountProducts.value.filter((item) => {
  const text = `${item.title}${item.id}${item.shop}`
  if (keyword.value && !text.includes(keyword.value.trim())) return false
  if (source.value && item.source !== source.value) return false
  if (category.value && goodsCategory(item) !== category.value) return false
  if (shipping.value === 'yes' && !isFreeShipping(item)) return false
  if (shipping.value === 'no' && isFreeShipping(item)) return false
  if (coupon.value && !couponTags(item).includes(coupon.value)) return false
  const sales = Number(item.monthlySales) || 0
  const salesTarget = Number(salesValue.value) || 0
  if (salesOp.value === 'gt' && salesTarget > 0 && sales <= salesTarget) return false
  if (salesOp.value === 'lt' && salesTarget > 0 && sales >= salesTarget) return false
  if (salesOp.value === 'eq' && sales !== salesTarget) return false
  if (scriptFilter.value === '外部同步' && !item.external) return false
  if ((scriptFilter.value === '未生成提示词' || scriptFilter.value === '未生成文案') && item.scriptReady) return false
  if ((scriptFilter.value === '已生成提示词' || scriptFilter.value === '已生成文案') && !item.scriptReady) return false
  if (range.value?.length === 2) {
    const day = String(item.createdAt).slice(0, 10)
    if (day < range.value[0] || day > range.value[1]) return false
  }
  return true
}))

const pageRows = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
watch(pageSize, () => { page.value = 1 })

function onSelect(rows) { selection.value = rows }

function resetFilters() {
  keyword.value = ''
  source.value = ''
  category.value = ''
  shipping.value = ''
  coupon.value = ''
  salesOp.value = 'gt'
  salesValue.value = 0
  range.value = []
  scriptFilter.value = '全部'
  page.value = 1
}

function startProgress() {
  progress.value = 8
  syncText.value = '正在把达人工作台的选品同步进软件'
  clearInterval(progressTimer)
  progressTimer = setInterval(() => {
    if (progress.value < 90) progress.value = Math.min(90, progress.value + 4)
  }, 400)
}

async function syncNow() {
  if (syncing.value) return
  syncing.value = true
  startProgress()
  try {
    const result = await store.syncCatalog('products')
    const count = result.count || 0
    clearInterval(progressTimer)
    progress.value = 100
    syncText.value = count ? `已同步 ${count} 件，已保存在软件里` : '这次没有拉到新商品，已有的会继续留着'
    setTimeout(() => {
      progress.value = 0
      syncText.value = ''
    }, 1600)
    if (count) ElMessage.success(`已同步 ${count} 件商品`)
    else ElMessage.warning('这次没有拉到选品')
  } catch (error) {
    clearInterval(progressTimer)
    progress.value = 0
    ElMessage.error(error.message || '同步失败')
  } finally {
    syncing.value = false
  }
}

function openShots(row) {
  shotRow.value = row
  shotVisible.value = true
}

function removeShot(src) {
  if (!shotRow.value) return
  store.removeProductImage(shotRow.value.id, src)
  if (!shotList(shotRow.value).length) shotVisible.value = false
}

function makePrompts() {
  const count = store.applyPrompts(selection.value.map((item) => item.id))
  if (!count) return ElMessage.warning('先在提示词模板里选一套文案')
  ElMessage.success(`已生成 ${count} 条提示词`)
}

async function openTalent() {
  const account = store.publishAccounts.find((item) => item.id === store.activeAccountId) || store.publishAccounts[0]
  if (!account) return ElMessage.warning('先添加一个发布账号，用来登录达人选品')
  if (!window.tujian?.openAccount) return ElMessage.warning('请在桌面窗口里打开达人选品')
  await window.tujian.openAccount({
    kind: 'publish',
    id: account.id,
    name: account.name,
    login: account.login,
    mode: account.loginMode || 'password',
    url: 'https://buyin.jinritemai.com/dashboard/merch-picking-library'
  })
  ElMessage.success('达人选品已打开。在网页里手动加入后，回到这里点同步商品。')
}

function generateSelected() {
  if (!selection.value.length) {
    ElMessage.warning('先勾选商品')
    return
  }
  store.openPrompt(selection.value.map((item) => item.id))
}

async function removeSelected() {
  try {
    await ElMessageBox.confirm(`从选品库移除 ${selection.value.length} 件商品？`, '批量删除', { type: 'warning' })
  } catch { return }
  const ids = new Set(selection.value.map((item) => item.id))
  store.products = store.products.filter((item) => !ids.has(item.id))
  store.addLog('info', '选品', `移除 ${ids.size} 件商品`)
}

function clearTemplate() {
  const fresh = defaultPromptSettings()
  upgradePromptSettings(fresh)
  store.settings.promptText = fresh.promptText
  const active = (store.settings.promptTemplates || []).find((item) => item.id === store.settings.activePromptTemplateId)
  if (active) active.promptText = fresh.promptText
  store.persist()
  ElMessage.success('当前模板已恢复默认提示词')
}

function downloadBlob(name, text, type) {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

function downloadTemplate() {
  const text = '\uFEFF标题,价格,佣金,类目,店铺,链接\n护腰靠垫,39.9,20,居家,示例店,https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=1234567890123\n'
  downloadBlob('选品导入模板.csv', text, 'text/csv;charset=utf-8')
}

function downloadPromptTemplates() {
  const list = store.settings.promptTemplates || []
  downloadBlob('提示词模板.json', JSON.stringify(list, null, 2), 'application/json')
  ElMessage.success(`已下载 ${list.length} 套提示词模板`)
}

function productIdFrom(text) {
  const raw = String(text || '').trim()
  const query = raw.match(/(?:id|product_id|promotion_id|goods_id)=(\d{6,})/i)
  if (query) return query[1]
  if (/^\d{8,}$/.test(raw)) return raw
  const digits = raw.match(/(\d{10,})/)
  return digits ? digits[1] : ''
}

async function addLinks() {
  const lines = [...new Set(linkText.value.split(/\s+/).map((item) => item.trim()).filter(Boolean))]
  if (!lines.length) return ElMessage.warning('先粘贴商品链接')
  if (!store.activeAccountId) return ElMessage.warning('先在上方选择已登录的发布账号，再用它的登录态拉标题')
  const account = store.publishAccounts.find((item) => item.id === store.activeAccountId)
  if (!account) return ElMessage.warning('找不到这个发布账号')
  addingLinks.value = true
  let added = 0
  let failed = 0
  try {
    for (const line of lines) {
      let remote = null
      let note = ''
      if (window.tujian?.lookupProduct) {
        try {
          const result = await window.tujian.lookupProduct({
            accountId: store.activeAccountId,
            link: line,
            name: account.name,
            login: account.login,
            mode: account.loginMode || 'password'
          })
          if (result?.product) remote = result.product
          note = result?.message || ''
        } catch (error) {
          note = error?.message || '查询失败'
        }
      }
      const id = remote?.id || productIdFrom(line)
      if (!id) {
        ElMessage.warning(`没有识别出商品编号：${line.slice(0, 48)}`)
        failed += 1
        continue
      }
      if (store.products.some((item) => item.id === id && (item.accountId || '') === (store.activeAccountId || ''))) continue
      const sanitized = sanitizeProductTitle(remote?.title || '', id, store.settings.bannedWords)
      if (sanitized.isPlaceholder) {
        failed += 1
        const tip = note || '没有拉到真实标题，未入库。请确认百应已登录后再试'
        ElMessage.warning(`${id}：${tip}`)
        store.addLog('error', '选品', `${id}：${tip}`)
        continue
      }
      const images = [...new Set([...(remote?.images || []), remote?.image]
        .map((item) => String(item || '').trim())
        .filter((item) => /^https?:\/\//.test(item)))].slice(0, 6)
      store.products.unshift({
        id,
        title: sanitized.title,
        rawTitle: sanitized.rawTitle,
        bannedHits: sanitized.bannedHits,
        price: Number(remote?.price) || 0,
        rate: Number(remote?.rate) || 0,
        category: remote?.category || '链接导入',
        shop: remote?.shop || '抖音',
        source: remote?.source || '链接导入',
        link: remote?.link || line,
        accountId: store.activeAccountId,
        monthlySales: Number(remote?.monthlySales) || 0,
        external: true,
        scriptReady: false,
        hue: Math.floor(Math.random() * 360),
        createdAt: formatTime(new Date()),
        image: images[0] || '',
        images
      })
      if (sanitized.changed) store.addLog('info', '选品', `${id}：标题已去掉违禁词 ${sanitized.bannedHits.join('、')}`)
      store.addLog('info', '选品', `${id}：图${images.length}张 · ¥${Number(remote?.price) || 0} · 佣金${Number(remote?.rate) || 0}% · ${remote?.category || '未分类'} · 月销${Number(remote?.monthlySales) || 0}`)
      if (note) store.addLog('warning', '选品', `${id}：${note}`)
      added += 1
    }
    if (added) {
      await store.flush()
      store.addLog('success', '选品', `链接加入 ${added} 件`)
      ElMessage.success(`已加入 ${added} 件${failed ? `，失败 ${failed} 件` : ''}`)
      linkText.value = ''
    } else if (failed) ElMessage.warning(`没有入库：${failed} 件没拉到真实标题。请先登录百应再导入`)
    else ElMessage.info('这些链接已经在选品库里，或没有识别出商品编号')
  } finally {
    addingLinks.value = false
  }
}

function onImportPrompt(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    let parsed = null
    try { parsed = JSON.parse(String(reader.result || '')) } catch { parsed = null }
    const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.promptTemplates) ? parsed.promptTemplates : [])
    const usable = list.filter((item) => item && String(item.promptText || item.text || '').trim())
    if (!usable.length) return ElMessage.warning('文件里没有提示词模板')
    const current = store.settings.promptTemplates || []
    usable.forEach((item) => {
      current.push({
        id: `tpl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
        name: item.name || '导入模板',
        promptText: item.promptText || item.text,
        model: item.model || store.settings.model,
        duration: item.duration || '',
        ratio: item.ratio || store.settings.ratio,
        voice: item.voice || store.settings.voice
      })
    })
    store.settings.promptTemplates = current
    store.persist()
    ElMessage.success(`已导入 ${usable.length} 套提示词模板`)
  }
  reader.readAsText(file, 'utf-8')
}

function onImport(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    if (String(file.name || '').toLowerCase().endsWith('.json')) {
      onImportPrompt({ target: { files: [file], value: '' } })
      return
    }
    const lines = String(reader.result || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const rows = lines.slice(lines[0].includes('标题') ? 1 : 0).map((line) => {
      const [title, price, rate, categoryName, shop, link] = line.split(/,|，/).map((cell) => cell.trim())
      return { title, price, rate, category: categoryName, shop, link }
    }).filter((row) => row.title && !String(row.link || '').includes('1234567890123'))
    const count = store.importProducts(rows)
    const linked = rows.filter((row) => row.link)
    if (linked.length) linkText.value = linked.map((row) => row.link).join('\n')
    ElMessage.success(count ? `导入 ${count} 条` : '没有识别到标题列')
  }
  reader.readAsText(file, 'utf-8')
}

function openEdit(row) {
  Object.assign(editForm, row)
  editVisible.value = true
}

function saveEdit() {
  const target = store.products.find((item) => item.id === editForm.id)
  if (!target) return
  Object.assign(target, {
    title: editForm.title,
    price: editForm.price,
    rate: editForm.rate,
    category: editForm.category,
    shop: editForm.shop
  })
  store.persist()
  editVisible.value = false
}
</script>

<style scoped>
.library-page { display: flex; flex-direction: column; gap: 12px; }
.library-head,
.library-filter,
.library-import,
.library-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.library-account,
.filter-sales,
.import-side {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.library-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-left: auto; }
.filter-search { width: min(280px, 100%); }
.library-import { align-items: stretch; }
.library-import :deep(.el-textarea) { flex: 1; min-width: 280px; }
.import-side { flex-direction: column; justify-content: flex-start; min-width: 120px; }
.import-side .el-button { width: 100%; margin: 0; }
.library-toolbar .grow { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.shot-strip { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.shot-strip .thumb { width: 42px; height: 42px; object-fit: cover; border-radius: 6px; cursor: pointer; }
.shot-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.shot-cell { display: flex; flex-direction: column; gap: 6px; }
.shot-cell img { width: 100%; height: 120px; object-fit: cover; border-radius: 8px; background: #f2f4f7; }
@media (max-width: 1100px) {
  .library-actions { margin-left: 0; width: 100%; }
  .import-side { flex-direction: row; width: 100%; }
  .import-side .el-button { width: auto; }
}
</style>
