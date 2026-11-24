<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>剪辑中心 · 选品车</h1>
        <p>请先用采集账号登录后再把选品车交给豆包。账号被限制或封停不可操作。同一账号每 5 秒内只开一个窗口。</p>
      </div>
    </div>
    <ClipTabs tab="cart" />
    <div class="banner">开账号后，可以从选品广场收录商品，也可以直接粘贴商品编号。重复编号会自动跳过。</div>
    <div class="panel filters">
      <el-input v-model="idText" type="textarea" :rows="2" placeholder="导入商品 ID，一行一个" style="width: 360px" />
      <el-button type="primary" @click="importIds">采集</el-button>
      <span class="muted">每日采集限额</span>
      <el-input-number v-model="store.settings.dailyCollectLimit" :min="1" :max="500" @change="store.persist()" />
      <span class="muted">开始时间</span>
      <el-time-select v-model="store.settings.collectStart" start="00:00" step="00:30" end="23:30" style="width: 120px" @change="onCollectStartChange" />
    </div>
    <div class="panel">
      <div class="toolbar">
        <span>采集账号列表 <b class="count">{{ store.collectAccounts.length }}</b></span>
        <div class="grow">
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
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openCart(row)">打开选品</el-button>
            <el-button link type="primary" @click="collectNext(row)">同步选品库</el-button>
            <el-button link @click="edit(row)">编辑</el-button>
            <el-button link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="visible" :title="form.id ? '编辑采集账号' : '新建采集账号'" width="460px">
      <el-form label-width="88px">
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="分组">
          <el-select v-model="form.group" style="width: 100%">
            <el-option v-for="item in store.groups" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="发布账号">
          <el-select v-model="form.publishAccount" style="width: 100%">
            <el-option v-for="item in store.publishAccounts" :key="item.id" :label="item.name" :value="item.name" />
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
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAppStore } from '@/stores/app'
import ClipTabs from '@/components/ClipTabs.vue'
import { formatTime, statusType, uid } from '@/utils/format'
import { sanitizeProductTitle } from '@/utils/banned'

const store = useAppStore()

function onCollectStartChange() {
  const task = store.schedules.find((item) => item.id === 'SYS-collect')
  if (task) {
    task.time = store.settings.collectStart
    task.mode = '定时'
  }
  store.persist()
}
const router = useRouter()
const idText = ref('')
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

async function importIds() {
  const ids = idText.value.split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean)
  if (!ids.length) {
    ElMessage.warning('先填写商品 ID')
    return
  }
  const account = lookupAccount()
  if (!account) return ElMessage.warning('先添加并选择一个发布账号。导入会用它的百应选品车登录态拉商品，不开商品页窗口')
  const accountId = account.id
  let added = 0
  let duplicated = 0
  let limited = false
  let incomplete = 0
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
    const images = [...new Set([...(looked?.images || []), looked?.image].map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 6)
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
    if (sanitized.changed) store.addLog('info', '采集', `${id}：标题已去掉违禁词 ${sanitized.bannedHits.join('、')}`)
    if (miss.length) store.addLog('warning', '采集', `${id}：仍缺 ${miss.join('、')}。可再点「同步选品库」补全`)
    if (note) store.addLog('warning', '采集', `${id}：${note}`)
    added += 1
  }
  if (added) {
    store.persist()
    store.addLog('success', '采集', `按编号导入 ${added} 件商品`)
    idText.value = ''
    if (incomplete) {
      ElMessage.warning(`已导入 ${added} 件，其中 ${incomplete} 件详情不全。请先登录百应并同步选品车，或在选品库补图后再生成`)
    } else {
      ElMessage.success(`已导入 ${added} 件，标题和图片已写入选品库`)
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
  const publish = publishOf(account)
  if (!publish) return ElMessage.warning('先给这个采集账号选择一个发布账号')
  if (!window.tujian?.openAccount) return ElMessage.warning('请在桌面窗口里打开选品页')
  const result = await window.tujian.openAccount({
    kind: 'publish',
    id: publish.id,
    name: publish.name,
    login: publish.login,
    mode: publish.loginMode || 'password',
    url: 'https://buyin.jinritemai.com/dashboard/merch-picking-library'
  })
  if (result?.loginStatus) {
    publish.loginStatus = result.loginStatus
    account.loginStatus = result.loginStatus
    store.persist()
  }
  ElMessage.success(result?.message || '选品页已打开。登录并加入商品后，点同步选品库。')
}

async function collectNext(account) {
  if (!account.enabled) return ElMessage.warning('这个采集账号没有启用')
  const publish = publishOf(account)
  if (!publish) return ElMessage.warning('先给这个采集账号选择一个发布账号')
  if (!window.tujian?.openAccount) return ElMessage.warning('请在桌面窗口里同步选品')
  const opened = await window.tujian.openAccount({
    kind: 'publish',
    id: publish.id,
    name: publish.name,
    login: publish.login,
    mode: publish.loginMode || 'password',
    url: 'https://buyin.jinritemai.com/dashboard/merch-picking-cart'
  })
  if (opened?.loginStatus) {
    publish.loginStatus = opened.loginStatus
    account.loginStatus = opened.loginStatus
  }
  try {
    const result = await store.syncCatalog('products', publish.id)
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
  if (row) Object.assign(form, row)
  else Object.assign(form, { id: '', name: '', group: store.groups[0] || '默认分组', publishAccount: store.publishAccounts[0]?.name || '' })
  visible.value = true
}

function save() {
  if (!form.name.trim()) return ElMessage.warning('填写账号名称')
  if (form.id) {
    const target = store.collectAccounts.find((item) => item.id === form.id)
    if (target) Object.assign(target, { name: form.name, group: form.group, publishAccount: form.publishAccount })
  } else {
    store.collectAccounts.unshift({
      id: uid('CA'),
      name: form.name,
      group: form.group,
      publishAccount: form.publishAccount,
      enabled: true,
      loginStatus: '未检测',
      lastCollect: '-',
      createdAt: formatTime(new Date())
    })
  }
  store.persist()
  visible.value = false
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`删除采集账号 ${row.name}？`, '删除', { type: 'warning' })
  } catch { return }
  store.collectAccounts = store.collectAccounts.filter((item) => item.id !== row.id)
  store.persist()
}
</script>
