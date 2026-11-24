<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>发布中心 · 账号管理</h1>
      </div>
    </div>
    <div class="panel filters">
      <span class="muted">平台</span>
      <el-check-tag checked>抖音</el-check-tag>
      <el-input v-model="keyword" clearable placeholder="环境名称" style="width: 180px" />
      <el-select v-model="group" clearable placeholder="运营分组" style="width: 140px">
        <el-option v-for="item in store.groups" :key="item" :label="item" :value="item" />
      </el-select>
      <el-button @click="createGroup">新建分组</el-button>
      <div class="grow">
        <el-button type="primary" @click="edit()">添加账号</el-button>
        <el-button type="primary" plain @click="batchVisible = true">批量添加</el-button>
      </div>
    </div>
    <div class="panel">
      <div class="toolbar">
        <span>账号列表 <b class="count">{{ rows.length }}</b></span>
        <el-button @click="checkSelected">批量检测登录状态</el-button>
        <span class="muted">已选 {{ selection.length }}</span>
        <div class="grow">
          <span class="muted">同时打开</span>
          <el-input-number v-model="store.settings.publishOpen" :min="1" :max="10" size="small" @change="store.persist()" />
          <span class="muted">启动间隔</span>
          <el-input-number v-model="store.settings.publishGap" :min="0" :max="120" size="small" @change="store.persist()" />
          <el-button type="primary" @click="publishBatch">开始批量发布（{{ selection.length }}）</el-button>
        </div>
      </div>
      <el-table :data="rows" @selection-change="onSelect">
        <el-table-column type="selection" width="42" />
        <el-table-column prop="name" label="环境名称" min-width="120" />
        <el-table-column label="账号状态" width="90">
          <template #default="{ row }"><el-switch v-model="row.enabled" @change="store.persist()" /></template>
        </el-table-column>
        <el-table-column prop="login" label="抖音账号" min-width="140" />
        <el-table-column prop="phone" label="手机" width="120" />
        <el-table-column prop="fans" label="粉丝" width="80" />
        <el-table-column prop="todayPublish" label="今日发布" width="90" />
        <el-table-column prop="group" label="运营分组" width="110" />
        <el-table-column label="视频购物车" width="110">
          <template #default="{ row }"><el-switch v-model="row.cart" @change="store.persist()" /></template>
        </el-table-column>
        <el-table-column label="登录状态" width="100">
          <template #default="{ row }"><el-tag size="small" :type="statusType(row.loginStatus)">{{ row.loginStatus }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="publishMode" label="发布状态" width="110" />
        <el-table-column prop="fetchMode" label="获取方式" width="100" />
        <el-table-column prop="createdAt" label="创建时间" width="150" />
        <el-table-column label="操作" min-width="280">
          <template #default="{ row }">
            <div class="row-ops">
              <el-button size="small" type="primary" plain @click="openRow(row)">创作者中心</el-button>
              <el-button size="small" type="primary" plain @click="scanLogin(row)">扫码登录</el-button>
              <el-button size="small" type="primary" plain @click="requestCode(row)">获取验证码</el-button>
              <el-button size="small" plain @click="fillCode(row)">填写验证码</el-button>
              <el-dropdown trigger="click">
                <el-button size="small">更多</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item @click="edit(row)">编辑</el-dropdown-item>
                    <el-dropdown-item divided @click="remove(row)">删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </div>
    <el-dialog v-model="visible" :title="form.id ? '编辑抖音账号' : '添加抖音账号'" width="520px">
      <p class="muted">推荐保存账号密码：登录一次后分区会记住；过期时定时任务会自动填密重登，不用每次再扫码。</p>
      <el-form label-width="96px">
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="登录方式">
          <el-radio-group v-model="form.loginMode">
            <el-radio value="password">密码（推荐）</el-radio>
            <el-radio value="code">验证码</el-radio>
            <el-radio value="qr">扫码</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.loginMode !== 'qr'" label="抖音账号"><el-input v-model="form.login" placeholder="手机号 / 抖音号" /></el-form-item>
        <el-form-item v-if="form.loginMode === 'password'" label="密码">
          <el-input v-model="form.password" type="password" show-password :placeholder="form.id ? '不修改可留空' : '登录密码，用于过期自动重登'" />
        </el-form-item>
        <el-form-item label="分组">
          <el-select v-model="form.group" style="width: 100%">
            <el-option v-for="item in store.groups" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="发布方式">
          <el-select v-model="form.publishMode" style="width: 100%">
            <el-option label="自动发布" value="自动发布" />
            <el-option label="手动确认" value="手动确认" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="batchVisible" title="批量添加抖音发布账号" width="560px">
      <p class="muted">一行一个，格式：名称,登录账号,密码。添加后点「打开」，登录一次即可，下次自动登录。</p>
      <el-input v-model="batchText" type="textarea" :rows="8" placeholder="蓝云好物,抖音号,密码" />
      <template #footer>
        <el-button @click="batchVisible = false">取消</el-button>
        <el-button type="primary" @click="submitBatch">添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAppStore } from '@/stores/app'
import { formatTime, statusType, uid } from '@/utils/format'

const store = useAppStore()
const keyword = ref('')
const group = ref('')
const selection = ref([])
const visible = ref(false)
const batchVisible = ref(false)
const batchText = ref('')
const form = reactive({ id: '', name: '', login: '', password: '', loginMode: 'password', group: '默认分组', publishMode: '手动确认' })
const rows = computed(() => store.publishAccounts.filter((item) => {
  if (keyword.value && !item.name.includes(keyword.value.trim())) return false
  if (group.value && item.group !== group.value) return false
  return true
}))

function onSelect(list) { selection.value = list }

async function createGroup() {
  try {
    const { value } = await ElMessageBox.prompt('分组名称', '新建分组')
    store.addGroup(value)
  } catch { /* 取消 */ }
}

async function checkSelected() {
  const list = selection.value.length ? selection.value : rows.value
  if (!window.tujian?.accountStatus) return ElMessage.warning('请在桌面窗口里检测')
  for (const item of list) {
    const result = await window.tujian.accountStatus({ kind: 'publish', id: item.id })
    item.loginStatus = result.loginStatus
  }
  store.persist()
  ElMessage.success('已按各账号自己的登录态更新')
}

async function publishBatch() {
  if (!selection.value.length) return ElMessage.warning('先勾选环境')
  const limit = Number(store.settings.publishOpen) || 1
  const picked = selection.value.filter((item) => item.enabled).slice(0, limit)
  if (!picked.length) return ElMessage.warning('勾选的环境都没启用')
  const message = await store.publishQueueForAccounts(picked)
  picked.forEach((item) => { item.todayPublish = Number(item.todayPublish || 0) + 1 })
  store.persist()
  ElMessage.success(message)
}

function edit(row) {
  if (row) Object.assign(form, { id: row.id, name: row.name, login: row.loginMode === 'qr' ? '' : (row.login || row.accountId || ''), password: '', loginMode: ['code', 'qr'].includes(row.loginMode) ? row.loginMode : 'password', group: row.group, publishMode: row.publishMode })
  else Object.assign(form, { id: '', name: '', login: '', password: '', loginMode: 'password', group: store.groups[0] || '默认分组', publishMode: '手动确认' })
  visible.value = true
}

async function save() {
  if (!form.name.trim()) return ElMessage.warning('填写名称')
  if (form.loginMode !== 'qr' && !form.login.trim()) return ElMessage.warning('填写抖音账号')
  if (form.loginMode === 'password' && !form.id && !form.password) return ElMessage.warning('填写密码')
  const id = form.id || uid('PB')
  const login = form.loginMode === 'qr' ? '扫码登录' : form.login.trim()
  try {
    if (form.password) await store.saveAccountSecret(id, login, form.password)
  } catch (error) {
    return ElMessage.error(error.message || '密码保存失败')
  }
  if (form.id) {
    const target = store.publishAccounts.find((item) => item.id === form.id)
    if (target) Object.assign(target, { name: form.name.trim(), login, loginMode: form.loginMode, accountId: login, phone: login, group: form.group, publishMode: form.publishMode, hasPassword: target.hasPassword || Boolean(form.password) })
  } else {
    store.publishAccounts.unshift({
      id,
      name: form.name.trim(),
      login,
      loginMode: form.loginMode,
      hasPassword: form.loginMode === 'password',
      enabled: true,
      accountId: login,
      phone: login,
      fans: '0',
      todayPublish: 0,
      group: form.group,
      cart: true,
      loginStatus: '待登录',
      publishMode: form.publishMode,
      fetchMode: '手动',
      createdAt: formatTime(new Date())
    })
    store.activeAccountId = id
  }
  store.persist()
  visible.value = false
  const row = store.publishAccounts.find((item) => item.id === id)
  if (row) {
    await openWorkbench(row)
    if (!form.id) store.syncPlazaQuiet(id)
  }
}

async function openWorkbench(row) {
  if (!row) return
  if (!window.tujian?.openAccount) return ElMessage.warning('请在桌面窗口里打开')
  const result = await window.tujian.openAccount({
    kind: 'publish',
    id: row.id,
    name: row.name,
    login: row.loginMode === 'qr' ? '' : row.login,
    mode: row.loginMode || 'password',
    url: 'https://buyin.jinritemai.com/dashboard'
  })
  row.loginStatus = result.loginStatus
  store.persist()
  if (result.loginStatus === '已登录') {
    ElMessage.success('账号已添加，正在后台同步选品广场')
    return
  }
  if (row.loginMode === 'qr') {
    ElMessage.success('达人工作台已打开，扫一次即可，选品和广场都用这次登录')
    watchScan(row)
    return
  }
  ElMessage.success(row.loginMode === 'code' ? '达人工作台已打开，验证码登录后就会记住' : '已打开达人工作台并填入账号密码')
}

async function scanLogin(row) {
  if (!row) return
  if (!window.tujian?.openAccount) return ElMessage.warning('请在桌面窗口里扫码')
  const result = await window.tujian.openAccount({
    kind: 'publish',
    id: row.id,
    name: row.name,
    login: row.login,
    mode: 'qr',
    already: row.loginStatus === '已登录',
    url: 'https://buyin.jinritemai.com/dashboard'
  })
  row.loginStatus = result.loginStatus
  store.persist()
  if (result.loginStatus === '已登录') {
    fetchLibrary(row.id)
    ElMessage.success('这个账号已经登录，直接进入')
    return
  }
  ElMessage.success(result.message || '请用抖音 App 扫描窗口里的二维码')
  watchScan(row)
}

async function watchScan(row) {
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3000))
    if (!window.tujian?.accountStatus) return
    const result = await window.tujian.accountStatus({ kind: 'publish', id: row.id })
    if (result.loginStatus !== '已登录') continue
    row.loginStatus = '已登录'
    store.persist()
    store.syncPlazaQuiet(row.id)
    ElMessage.success(`${row.name} 已登录，正在后台同步选品广场`)
    store.addLog('success', '发布', `${row.name} 扫码登录成功`)
    return
  }
}

async function openRow(row) {
  if (!window.tujian?.openAccount) return ElMessage.warning('请在桌面窗口里打开')
  try {
    if (window.tujian.accountStatus) {
      const st = await window.tujian.accountStatus({ kind: 'publish', id: row.id })
      if (st?.loginStatus) row.loginStatus = st.loginStatus
    }
  } catch { /* ignore */ }
  let already = row.loginStatus === '已登录'
  if (window.tujian.ensurePublishLogin) {
    try {
      const ensured = await window.tujian.ensurePublishLogin({
        id: row.id,
        name: row.name,
        login: row.login,
        mode: row.loginMode || 'password',
        url: 'https://creator.douyin.com/creator-micro/content/upload'
      })
      if (ensured?.loginStatus) row.loginStatus = ensured.loginStatus
      already = ensured?.loginStatus === '已登录' || ensured?.ok
      store.persist()
      if (ensured?.reused) ElMessage.success('已沿用采集/达人登录态打开创作者中心')
    } catch { /* 继续打开 */ }
  }
  const result = await window.tujian.openAccount({
    kind: 'publish',
    id: row.id,
    name: row.name,
    login: row.login,
    mode: row.loginMode || 'password',
    already,
    url: 'https://creator.douyin.com/creator-micro/content/upload'
  })
  if (result?.loginStatus) {
    row.loginStatus = result.loginStatus
    store.persist()
  }
  if (result.message && !already) result.ok ? ElMessage.success(result.message) : ElMessage.warning(result.message)
  store.addLog('info', '发布', `${row.name} 打开自己的创作者中心`)
}

async function requestCode(row) {
  if (row.loginStatus === '已登录') return openRow(row)
  if (!row.login) return ElMessage.warning('先编辑这个账号，填上接收验证码的手机号')
  if (!window.tujian?.requestCode) return ElMessage.warning('请在桌面窗口里操作')
  const result = await window.tujian.requestCode({ kind: 'publish', id: row.id, name: row.name, login: row.login })
  row.loginStatus = result.loginStatus
  store.persist()
  if (result.loginStatus === '已登录') fetchLibrary(row.id)
  if (result.ok) ElMessage.success(result.message)
  else ElMessage.warning(result.message || '没有点到获取验证码')
}

async function fillCode(row) {
  if (!window.tujian?.submitCode) return ElMessage.warning('请在桌面窗口里填写')
  let code = ''
  try {
    const result = await ElMessageBox.prompt('输入手机收到的短信验证码', '填写验证码', {
      inputPattern: /^\d{4,8}$/,
      inputErrorMessage: '验证码是 4 到 8 位数字'
    })
    code = result.value
  } catch { return }
  const result = await window.tujian.submitCode({ kind: 'publish', id: row.id, name: row.name, login: row.login, code })
  row.loginStatus = result.loginStatus
  store.persist()
  if (result.loginStatus === '已登录') fetchLibrary(row.id)
  if (result.ok) ElMessage.success(result.loginStatus === '已登录' ? '验证码已提交，登录状态已记住' : '验证码已填进创作者中心')
  else ElMessage.warning(result.message || '还没找到验证码输入框')
}

function hasLibrary(accountId) {
  return store.products.some((item) => (item.accountId || '') === accountId)
}

async function fetchLibrary(accountId) {
  if (!accountId || hasLibrary(accountId)) return null
  store.activeAccountId = accountId
  await store.flush()
  try {
    const result = await store.syncCatalog('products')
    ElMessage.success(`已获取 ${result.count || 0} 件选品`)
    return result
  } catch (error) {
    ElMessage.warning(error.message || '这个账号还没有选品，登录一次后会自动再获取')
    return null
  }
}

async function submitBatch() {
  try {
    const before = new Set(store.publishAccounts.map((item) => item.id))
    const count = await store.batchAccounts('publish', batchText.value)
    const added = store.publishAccounts.filter((item) => !before.has(item.id))
    batchText.value = ''
    batchVisible.value = false
    ElMessage.success(`已添加 ${count} 个抖音账号，正在获取选品库`)
    for (const row of added) await fetchLibrary(row.id)
  } catch (error) {
    ElMessage.error(error.message || '添加失败')
  }
}

async function remove(row) {
  try { await ElMessageBox.confirm(`删除环境 ${row.name}？`, '删除', { type: 'warning' }) } catch { return }
  store.publishAccounts = store.publishAccounts.filter((item) => item.id !== row.id)
  if (store.activeAccountId === row.id) store.activeAccountId = store.publishAccounts[0]?.id || ''
  await store.removeAccountSecret(row.id)
  store.persist()
}
</script>
