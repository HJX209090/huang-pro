<template>
  <div class="page cart-page">
    <div class="page-head">
      <div>
        <h1>选品车</h1>
        <p class="cart-warn">请先登录采集账号后再把选品车交给豆包。可从选品广场加入，也可一次粘贴多条商品链接或商品 ID。</p>
      </div>
      <el-button @click="pane = pane === 'goods' ? 'accounts' : 'goods'">{{ pane === 'goods' ? '采集账号' : '返回商品列表' }}</el-button>
    </div>

    <template v-if="pane === 'goods'">
      <div class="panel cart-import">
        <el-input
          v-model="idText"
          type="textarea"
          :rows="4"
          placeholder="批量导入，一行一条。商品链接、短链或商品 ID 都可以，例如：&#10;https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=3599471665293989864&#10;3681234567890123456"
        />
        <div class="import-actions">
          <el-button type="primary" size="large" @click="importIds">批量导入</el-button>
          <el-button size="large" @click="downloadTemplate">下载模板</el-button>
          <el-button size="large" @click="fileRef.click()">上传表格</el-button>
          <el-checkbox v-model="skipLookup">只记编号，不查商品</el-checkbox>
          <span class="muted">相同商品 ID 已在车里就跳过</span>
        </div>
        <input ref="fileRef" type="file" accept=".csv,.xls,.xlsx,text/csv" hidden @change="onExcel" />
      </div>
      <div class="panel filters">
        <el-input v-model="keyword" clearable placeholder="标题 / 商品 ID / 店铺 / 类目" style="width: 260px" />
        <el-select v-model="source" clearable placeholder="全部来源" style="width: 140px">
          <el-option v-for="item in sources" :key="item" :label="item" :value="item" />
        </el-select>
        <el-select v-model="ready" clearable placeholder="全部状态" style="width: 140px">
          <el-option label="已有提示词" value="ready" />
          <el-option label="无提示词" value="empty" />
        </el-select>
        <el-date-picker v-model="range" type="daterange" value-format="YYYY-MM-DD" start-placeholder="年/月/日" end-placeholder="年/月/日" />
        <el-button type="primary" @click="page = 1">查询</el-button>
        <el-button @click="resetFilters">重置</el-button>
      </div>
      <div class="cart-tools">
        <el-button @click="openBanned">标题违禁词</el-button>
        <span class="muted">当前 {{ (store.settings.bannedWords || []).length }} 个词</span>
        <el-button @click="bgmRef.click()">上传本机配乐</el-button>
        <input ref="bgmRef" type="file" accept="audio/*" multiple hidden @change="onBgm" />
      </div>
      <div class="cart-batch">
        <span>已选 {{ picked.length }} 条</span>
        <el-button @click="pickAll">勾选全部筛选</el-button>
        <el-button type="primary" plain :disabled="!picked.length" @click="makePrompts">批量生成提示词</el-button>
        <el-button type="primary" :disabled="!picked.length" @click="submitDoubao">一键提交（豆包）</el-button>
        <el-button :disabled="!picked.length" @click="clearPrompts">批量重置待提交</el-button>
        <el-button type="danger" plain :disabled="!picked.length" @click="removePicked">批量删除</el-button>
        <el-button @click="picked = []">清空勾选</el-button>
      </div>
      <div class="panel goods-panel">
        <div class="toolbar"><span>商品列表 <b class="count">{{ filtered.length }}</b></span></div>
        <div class="table-scroll">
          <el-table :data="pageRows" @selection-change="onPick">
            <el-table-column type="selection" width="46" />
            <el-table-column label="图片" min-width="220">
              <template #default="{ row }">
                <div v-if="rowShots(row).length" class="thumb-row">
                  <HoverPreview v-for="(src, index) in rowShots(row)" :key="`${row.id}-${index}`" :images="rowShots(row)" :start="index">
                    <img class="cart-thumb" :src="imageUrl(src)" alt="" />
                  </HoverPreview>
                </div>
                <span v-else class="thumb-empty">无图</span>
              </template>
            </el-table-column>
            <el-table-column label="商品" min-width="280">
              <template #default="{ row }">
                <div class="goods-title">{{ row.title }}</div>
                <div class="goods-sub">ID {{ row.id }} · 月销 {{ row.monthlySales || 0 }} · {{ row.shop || '店铺待补充' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="价格" width="100">
              <template #default="{ row }"><b class="price">¥{{ Number(row.price || 0).toFixed(2) }}</b></template>
            </el-table-column>
            <el-table-column label="佣金" width="130">
              <template #default="{ row }">
                <div class="earn-cell">
                  <b>赚 ¥{{ earn(row.price, row.rate) }}</b>
                  <span>佣金率 {{ Number(row.rate) || 0 }}%</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="带货类型" min-width="110">
              <template #default="{ row }">{{ row.category || '电商带货' }}</template>
            </el-table-column>
            <el-table-column label="提示词" width="120">
              <template #default="{ row }">
                <el-tag size="small" :type="row.scriptReady ? 'success' : 'info'">{{ row.scriptReady ? '已有提示词' : '无提示词' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="createdAt" label="时间" width="150" />
            <el-table-column label="操作" min-width="140">
              <template #default="{ row }">
                <div class="row-ops">
                  <el-button type="primary" plain @click="store.openPrompt([row.id])">提交</el-button>
                  <el-button plain @click="removeOne(row)">删除</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>
        <div v-if="filtered.length" class="pager">
          <el-pagination background layout="total, sizes, prev, pager, next" :total="filtered.length" :page-sizes="[10, 20, 50]" v-model:page-size="pageSize" v-model:current-page="page" />
        </div>
        <p v-else class="muted empty-line">车里还没有商品。粘贴链接后点批量导入，或到选品广场取前几条加入。</p>
      </div>
    </template>

    <div v-else class="panel">
      <div class="toolbar">
        <span>采集账号列表 <b class="count">{{ store.collectAccounts.length }}</b></span>
        <div class="grow">
          <span class="muted">每日采集限额</span>
          <el-input-number v-model="store.settings.dailyCollectLimit" :min="1" :max="500" @change="store.persist()" />
          <span class="muted">开始时间</span>
          <el-time-select v-model="store.settings.collectStart" start="00:00" step="00:30" end="23:30" style="width: 120px" @change="onCollectStartChange" />
          <el-button type="primary" @click="edit()">新建采集账号</el-button>
        </div>
      </div>
      <el-table :data="store.collectAccounts">
        <el-table-column prop="name" label="账号名称" min-width="140" />
        <el-table-column prop="group" label="运营分组" width="120" />
        <el-table-column prop="publishAccount" label="发布账号" width="140" />
        <el-table-column label="启用" width="80">
          <template #default="{ row }"><el-switch v-model="row.enabled" @change="store.persist()" /></template>
        </el-table-column>
        <el-table-column label="登录状态" width="110">
          <template #default="{ row }"><el-tag size="small" :type="statusType(row.loginStatus)">{{ row.loginStatus }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="lastCollect" label="最近采集" width="160" />
        <el-table-column prop="createdAt" label="创建时间" width="160" />
        <el-table-column label="操作" min-width="180">
          <template #default="{ row }">
            <el-button link type="primary" @click="openCart(row)">打开选品</el-button>
            <el-button link type="primary" @click="collectNext(row)">同步选品库</el-button>
            <el-button link @click="edit(row)">编辑</el-button>
            <el-button link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="bannedOpen" title="标题违禁词" width="520px">
      <p class="muted">一行一个。拉进商品列表时如果标题命中这些词，会自动删掉再入库。</p>
      <el-input v-model="bannedText" type="textarea" :rows="12" />
      <template #footer>
        <el-button @click="bannedOpen = false">取消</el-button>
        <el-button type="primary" @click="saveBanned">保存词库</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="visible" :title="form.id ? '编辑采集账号' : '新建采集账号'" width="460px">
      <p class="muted">只填写用户名。保存后打开一个达人工作台窗口，扫码登录。</p>
      <el-form label-width="88px">
        <el-form-item label="用户名"><el-input v-model="form.name" placeholder="账号名称" /></el-form-item>
        <el-form-item label="分组">
          <el-select v-model="form.group" style="width: 100%">
            <el-option v-for="item in store.groups" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAppStore } from '@/stores/app'
import HoverPreview from '@/components/HoverPreview.vue'
import { earn, formatTime, imageUrl, keepProductImage, statusType, uid } from '@/utils/format'
import { sanitizeProductTitle } from '@/utils/banned'
import { buildXlsx, readXlsxTexts } from '@/utils/xlsx'

const store = useAppStore()

function onCollectStartChange() {
  const task = store.schedules.find((item) => item.id === 'SYS-collect')
  if (task) {
    task.time = store.settings.collectStart
    task.mode = '定时'
  }
  store.persist()
}
const pane = ref('goods')
const idText = ref('')
const skipLookup = ref(false)
const keyword = ref('')
const source = ref('')
const ready = ref('')
const range = ref([])
const page = ref(1)
const pageSize = ref(10)
const picked = ref([])
const fileRef = ref(null)
const bgmRef = ref(null)
const bannedOpen = ref(false)
const bannedText = ref('')

function rowShots(row) {
  return [...new Set([...(row?.images || []), row?.image].map((item) => String(item || '').trim()).filter(keepProductImage))]
}
const visible = ref(false)
const form = reactive({ id: '', name: '', group: '默认分组', publishAccount: '' })

function guard() {
  if (!store.consumeCollectQuota()) {
    ElMessage.warning('已达到今日采集限额')
    return false
  }
  return true
}

function lookupAccount() {
  return store.publishAccounts.find((item) => item.id === store.activeAccountId)
    || store.publishAccounts.find((item) => item.loginStatus === '已登录')
    || store.publishAccounts[0]
    || null
}

function idsFromText(text) {
  const chunks = String(text || '').split(/[\s,，;；]+/).map((item) => item.trim()).filter(Boolean)
  const ids = []
  chunks.forEach((part) => {
    const fromQuery = part.match(/[?&](?:id|product_id|goods_id)=(\d{6,})/i)
    if (fromQuery) {
      ids.push(fromQuery[1])
      return
    }
    const digits = part.match(/\d{8,}/)
    if (digits) ids.push(digits[0])
  })
  return [...new Set(ids)]
}

async function importIds() {
  const ids = idsFromText(idText.value)
  if (!ids.length) {
    ElMessage.warning('没有识别到商品链接或商品 ID')
    return
  }
  const account = lookupAccount()
  if (!account) return ElMessage.warning('先添加并选择一个发布账号。导入会用它的百应选品车登录态拉商品，不开商品页窗口')
  const accountId = account.id
  let added = 0
  let duplicated = 0
  let limited = false
  let incomplete = 0
  let cleanedTitles = 0
  for (const raw of ids) {
    const id = String(raw || '').trim()
    if (!id) continue
    if (store.products.some((item) => item.id === id && (item.accountId || '') === accountId)) {
      duplicated += 1
      continue
    }
    if (!store.consumeCollectQuota()) {
      limited = true
      break
    }
    if (skipLookup.value) {
      store.products.unshift({
        id,
        accountId,
        title: `商品 ${id}`,
        price: 0,
        rate: 0,
        category: '未分类',
        shop: '待补充',
        source: '手动导入',
        link: `https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=${id}`,
        monthlySales: 0,
        external: true,
        scriptReady: false,
        hue: 200,
        createdAt: formatTime(new Date()),
        image: '',
        images: []
      })
      added += 1
      continue
    }
    let looked = null
    let note = ''
    if (window.tujian?.lookupProduct) {
      try {
        const result = await window.tujian.lookupProduct({
          accountId,
          link: id,
          name: account.name,
          login: account.login,
          mode: account.loginMode || 'password'
        })
        if (result?.product) looked = result.product
        note = result?.message || ''
        if (result && result.ok === false && !looked?.image) incomplete += 1
      } catch { looked = null }
    }
    const images = [...new Set([...(looked?.images || []), looked?.image].map((item) => String(item || '').trim()).filter(keepProductImage))]
    const sanitized = sanitizeProductTitle(looked?.title || '', looked?.id || id, store.settings.bannedWords)
    if (sanitized.isPlaceholder) {
      incomplete += 1
      store.addLog('error', '采集', `${id}：没有拉到真实标题，未入库。请先登录百应并同步选品库后再导入`)
      continue
    }
    const price = Number(looked?.price) || 0
    const rate = Number(looked?.rate) || 0
    const monthlySales = Number(looked?.monthlySales) || 0
    const category = looked?.category && !['链接导入', '未分类'].includes(looked.category) ? looked.category : (looked?.category || '未分类')
    const miss = []
    if (!images.length) miss.push('图片')
    if (!(price > 0)) miss.push('价格')
    if (!(rate > 0)) miss.push('佣金')
    if (!category || ['链接导入', '未分类'].includes(category)) miss.push('类目')
    if (!(monthlySales > 0)) miss.push('销量')
    if (miss.length) incomplete += 1
    store.products.unshift({
      id: looked?.id || id,
      accountId,
      title: sanitized.title,
      rawTitle: sanitized.rawTitle,
      bannedHits: sanitized.bannedHits,
      price,
      rate,
      category,
      shop: looked?.shop || (images.length ? '抖音' : '待补充'),
      source: looked?.source || '手动导入',
      link: looked?.link || `https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=${id}`,
      monthlySales,
      external: true,
      scriptReady: false,
      hue: 200,
      createdAt: formatTime(new Date()),
      image: images[0] || '',
      images
    })
    store.addLog('info', '采集', `${id}：¥${price || 0} · 佣金${rate || 0}% · ${category} · 月销${monthlySales || 0} · 图${images.length}张`)
    if (sanitized.changed) {
      cleanedTitles += 1
      store.addLog('info', '采集', `${id}：标题已去掉违禁词 ${sanitized.bannedHits.join('、')}`)
    }
    if (miss.length) store.addLog('warning', '采集', `${id}：仍缺 ${miss.join('、')}。可再点「同步选品库」补全`)
    if (note) store.addLog('warning', '采集', `${id}：${note}`)
    added += 1
  }
  if (added) {
    store.persist()
    store.addLog('success', '采集', `按编号导入 ${added} 件商品`)
    idText.value = ''
    if (incomplete) {
      ElMessage.warning(`已导入 ${added} 件${cleanedTitles ? `，${cleanedTitles} 件标题已去掉违禁词` : ''}，其中 ${incomplete} 件详情不全。`)
    } else {
      ElMessage.success(cleanedTitles ? `已导入 ${added} 件，其中 ${cleanedTitles} 件标题已去掉违禁词` : `已导入 ${added} 件，标题和图片已写入选品库`)
    }
  } else if (limited) {
    ElMessage.warning('已达到今日采集限额')
  } else if (duplicated) {
    ElMessage.info('这些编号已经在选品库里')
  }
}

function publishOf(account) {
  return store.publishAccounts.find((item) => item.name === account.publishAccount)
    || store.publishAccounts.find((item) => item.id === store.activeAccountId)
    || store.publishAccounts[0]
}

async function openCart(account) {
  if (!window.tujian?.bootstrapPublishLogin) return ElMessage.warning('请在桌面窗口里打开选品页')
  const result = await window.tujian.bootstrapPublishLogin({
    id: account.id,
    name: account.name,
    login: '',
    mode: 'qr',
    scope: 'buyin'
  })
  account.loginStatus = result?.buyinLoginStatus || result?.loginStatus || account.loginStatus
  store.persist()
  ElMessage.success(result?.message || '达人工作台已打开，扫码后点同步选品库。')
}

async function collectNext(account) {
  if (!account.enabled) return ElMessage.warning('这个采集账号没有启用')
  if (!window.tujian?.openAccount) return ElMessage.warning('请在桌面窗口里同步选品')
  try {
    const result = await store.syncCatalog('products', account.id)
    account.lastCollect = formatTime(new Date())
    store.persist()
    const count = result?.count || 0
    if (!count) return ElMessage.warning(result?.message || '选品页没有拉到商品。先在打开的网页里登录，再点一次同步。')
    ElMessage.success(result.message || `已同步 ${count} 件到选品库`)
  } catch (error) {
    store.persist()
    ElMessage.error(error.message || '选品没有同步下来')
  }
}

function edit(row) {
  store.addGroup('默认分组')
  if (row) Object.assign(form, row)
  else Object.assign(form, { id: '', name: '', group: '默认分组', publishAccount: '' })
  visible.value = true
}

async function save() {
  if (!form.name.trim()) return ElMessage.warning('填写用户名')
  let row = null
  if (form.id) {
    row = store.collectAccounts.find((item) => item.id === form.id)
    if (row) Object.assign(row, { name: form.name.trim(), group: form.group, loginMode: 'qr' })
  } else {
    row = {
      id: uid('CA'),
      name: form.name.trim(),
      group: form.group,
      publishAccount: '',
      enabled: true,
      loginStatus: '待登录',
      loginMode: 'qr',
      lastCollect: '-',
      createdAt: formatTime(new Date())
    }
    store.collectAccounts.unshift(row)
  }
  store.persist()
  visible.value = false
  if (row && !form.id) await openCart(row)
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`删除采集账号 ${row.name}？`, '删除', { type: 'warning' })
  } catch { return }
  store.collectAccounts = store.collectAccounts.filter((item) => item.id !== row.id)
  store.persist()
}

const sources = computed(() => [...new Set(store.products.map((item) => item.source).filter(Boolean))])
const filtered = computed(() => store.products.filter((item) => {
  const query = keyword.value.trim()
  if (query && !`${item.title || ''}${item.id || ''}${item.shop || ''}${item.category || ''}`.includes(query)) return false
  if (source.value && item.source !== source.value) return false
  if (ready.value === 'ready' && !item.scriptReady) return false
  if (ready.value === 'empty' && item.scriptReady) return false
  if (range.value?.length === 2) {
    const day = String(item.createdAt || '').slice(0, 10)
    if (day < range.value[0] || day > range.value[1]) return false
  }
  return true
}))
const pageRows = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

function resetFilters() {
  keyword.value = ''
  source.value = ''
  ready.value = ''
  range.value = []
  page.value = 1
}

function onPick(rows) {
  picked.value = rows.map((item) => item.id)
}

function pickAll() {
  picked.value = filtered.value.map((item) => item.id)
  ElMessage.success(`已按当前筛选勾选 ${picked.value.length} 条`)
}

function makePrompts() {
  const count = store.applyPrompts(picked.value)
  ElMessage.success(count ? `已生成 ${count} 条提示词` : '没有可生成的商品')
}

function submitDoubao() {
  if (!picked.value.length) return
  store.openPrompt(picked.value)
}

function clearPrompts() {
  store.products.forEach((item) => {
    if (!picked.value.includes(item.id)) return
    item.scriptReady = false
    item.filledPrompt = ''
  })
  store.persist()
  ElMessage.success('已清掉勾选商品的提示词，回到待提交')
}

function dropProducts(ids) {
  store.products = store.products.filter((item) => !ids.includes(item.id))
  store.plaza.forEach((item) => {
    if (ids.includes(item.id)) item.added = false
  })
  picked.value = picked.value.filter((id) => !ids.includes(id))
  store.persist()
}

async function removePicked() {
  try {
    await ElMessageBox.confirm(`从选品车删除 ${picked.value.length} 件商品？`, '删除', { type: 'warning' })
  } catch { return }
  dropProducts([...picked.value])
}

function removeOne(row) {
  dropProducts([row.id])
}

function openBanned() {
  bannedText.value = (store.settings.bannedWords || []).join('\n')
  bannedOpen.value = true
}

function saveBanned() {
  store.settings.bannedWords = bannedText.value.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean)
  store.persist()
  bannedOpen.value = false
  ElMessage.success('违禁词库已保存，之后入库会按这份词库提示')
}

function downloadTemplate() {
  const bytes = buildXlsx([
    ['商品链接或商品ID'],
    ['在下一行粘贴一条链接或商品 ID，这一行说明可以删掉'],
  ])
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = '选品车导入模板.xlsx'
  link.click()
  URL.revokeObjectURL(link.href)
}

function onExcel(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  const reader = new FileReader()
  reader.onload = async () => {
    const bytes = new Uint8Array(reader.result || new ArrayBuffer())
    let text = ''
    try {
      if (bytes[0] === 0x50 && bytes[1] === 0x4b) text = (await readXlsxTexts(bytes)).join('\n')
      else text = new TextDecoder().decode(bytes)
    } catch {
      return ElMessage.warning('这个表格打不开。请用下载的 xlsx 模板，一列一条链接或商品 ID。')
    }
    const unique = idsFromText(text)
    if (!unique.length) return ElMessage.warning('这个表格里没有读到商品链接或商品 ID。请用下载的 xlsx 模板，一列一条。')
    idText.value = unique.join('\n')
    importIds()
  }
  reader.readAsArrayBuffer(file)
}

function onBgm(event) {
  const files = [...(event.target.files || [])]
  event.target.value = ''
  if (!files.length) return
  const rows = files.map((file) => ({ name: file.name, path: file.path || file.name, at: formatTime(new Date()) }))
  store.settings.localBgm = [...(store.settings.localBgm || []), ...rows].slice(-30)
  store.persist()
  ElMessage.success(`已保存 ${rows.length} 首到本机配乐。当前没有上传到外部 CDN，发布时使用本机文件。`)
}
</script>

<style scoped>
.cart-page { min-width: 0; }
.cart-warn { color: #d97706; line-height: 1.6; }
.cart-import { display: flex; flex-direction: column; gap: 12px; }
.import-actions, .cart-tools, .cart-batch { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.cart-tools, .cart-batch { margin-bottom: 10px; }
.goods-panel { min-width: 0; }
.table-scroll { width: 100%; overflow-x: auto; }
.cart-thumb { width: 56px; height: 56px; object-fit: cover; border-radius: 8px; background: #f3f4f6; display: block; }
.thumb-row { display: flex; flex-wrap: wrap; gap: 6px; max-width: 280px; }
.thumb-btn { border: 0; padding: 0; background: transparent; cursor: zoom-in; }
.thumb-empty { display: grid; place-items: center; width: 56px; height: 56px; border-radius: 8px; background: #f3f4f6; color: #98a2b3; font-size: 12px; }
.shot-preview { width: 100%; max-height: 78vh; object-fit: contain; background: #111; border-radius: 12px; }
.goods-title { font-size: 15px; line-height: 1.45; }
.price { color: #e11d48; }
.earn-cell { display: flex; flex-direction: column; gap: 2px; }
.earn-cell b { color: #16a34a; font-size: 16px; }
.earn-cell span { color: #667085; font-size: 12px; }
.row-ops { display: flex; flex-wrap: wrap; gap: 8px; }
.empty-line { margin: 12px 0 0; }
@media (max-width: 900px) {
  .page-head { flex-direction: column; align-items: stretch; }
}
</style>
