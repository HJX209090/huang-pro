<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>豆包管理</h1>
        <p>请先用豆包账号登录后再把任务丢给豆包。账号被限制或封停不可操作。同一账号每 5 秒内只开一个窗口，失败、高分自动拆。</p>
      </div>
      <el-button type="primary" @click="edit()">新建账号</el-button>
    </div>
    <ClipTabs tab="doubao" />
    <div class="panel filters">
      <el-input v-model="keyword" clearable placeholder="搜索豆包账号" style="width: 220px" />
      <el-select v-model="group" clearable placeholder="运营分组" style="width: 140px">
        <el-option v-for="item in store.groups" :key="item" :label="item" :value="item" />
      </el-select>
      <el-button @click="createGroup">新建分组</el-button>
      <el-button type="primary" @click="keyword = keyword">查询</el-button>
      <el-button @click="keyword = ''; group = ''">重置</el-button>
      <div class="grow">
        <el-button @click="checkAll">批量检测</el-button>
        <el-button type="primary" @click="startGenerate">开始生成（{{ enabledCount }}）</el-button>
        <el-button type="primary" plain @click="collectOnce">一次收录（{{ waitingWorks }}）</el-button>
        <el-button @click="edit()">新建账号</el-button>
        <el-button type="primary" plain @click="batchVisible = true">批量添加</el-button>
      </div>
    </div>
    <div class="panel">
      <div class="filters" style="margin-bottom: 10px">
        <span class="muted">同时打开</span>
        <el-input-number v-model="store.settings.doubaoOpen" :min="1" :max="10" @change="store.persist()" />
        <span class="muted">启动间隔（秒）</span>
        <el-input-number v-model="store.settings.doubaoGap" :min="0" :max="60" @change="store.persist()" />
      </div>
      <el-table :data="rows">
        <el-table-column prop="name" label="账号名称" min-width="140" />
        <el-table-column prop="login" label="豆包账号" min-width="140" />
        <el-table-column prop="group" label="运营分组" width="120" />
        <el-table-column prop="quota" label="今日额度" width="100" />
        <el-table-column label="启用" width="80">
          <template #default="{ row }"><el-switch v-model="row.enabled" @change="store.persist()" /></template>
        </el-table-column>
        <el-table-column label="登录状态" width="110">
          <template #default="{ row }"><el-tag size="small" :type="statusType(row.loginStatus)">{{ row.loginStatus }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="worker" label="Worker" width="110" />
        <el-table-column prop="recent" label="最近完成" min-width="140" />
        <el-table-column prop="createdAt" label="创建时间" width="160" />
        <el-table-column label="操作" min-width="420">
          <template #default="{ row }">
            <div class="row-ops">
              <el-button size="small" type="primary" plain @click="openRow(row)">打开</el-button>
              <el-button size="small" @click="showBrowsers(row)">浏览器</el-button>
              <el-button size="small" plain @click="openExtra(row)">再开窗口</el-button>
              <el-button size="small" plain @click="talk(row)">对话</el-button>
              <el-button size="small" type="primary" plain @click="requestCode(row)">获取验证码</el-button>
              <el-button size="small" plain @click="fillCode(row)">填写验证码</el-button>
              <el-dropdown trigger="click">
                <el-button size="small">更多</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item @click="checkOne(row)">检测</el-dropdown-item>
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
    <el-dialog v-model="visible" :title="form.id ? '编辑豆包账号' : '新建豆包账号'" width="460px">
      <p class="muted">只填写用户名和分组。保存后打开豆包网页，扫码登录，不填写手机号。</p>
      <el-form label-width="88px">
        <el-form-item label="用户名"><el-input v-model="form.name" placeholder="账号名称" /></el-form-item>
        <el-form-item label="分组">
          <el-select v-model="form.group" style="width: 100%">
            <el-option v-for="item in store.groups" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="每日上限"><el-input v-model="form.quota" placeholder="例如 5" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存并登录</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="batchVisible" title="批量添加豆包账号" width="560px">
      <p class="muted">一行一个，格式：名称,登录账号,密码。第一次打开会填入登录信息；登录成功后，这个窗口会记住会话，下次自动登录。</p>
      <el-input v-model="batchText" type="textarea" :rows="8" placeholder="冬装A,13800000000,密码" />
      <template #footer>
        <el-button @click="batchVisible = false">取消</el-button>
        <el-button type="primary" @click="submitBatch">添加</el-button>
      </template>
    </el-dialog>

    <div class="panel chat-panel">
      <div class="toolbar" style="margin-top: 0">
        <strong>和豆包对话</strong>
        <el-select v-model="chatAccountId" placeholder="选择豆包账号" style="width: 180px">
          <el-option v-for="item in store.doubaoAccounts" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
        <el-button @click="newChatWindow">新开对话窗口</el-button>
        <el-button @click="refreshWindows">刷新窗口</el-button>
        <span class="muted">当前窗口 {{ chatSlot }}</span>
      </div>
      <div v-if="openWindows.length" class="window-list">
        <el-button v-for="item in openWindows" :key="item.key" size="small" @click="focusWindow(item)">{{ item.title || item.key }}</el-button>
      </div>
      <div class="chat-log">
        <div v-if="!chatMessages.length" class="muted">选一个账号直接发消息。多个窗口各自记一份对话。豆包如果还要再确认一次，会自动再发，并写明有没有检测到确认发送。</div>
        <div v-for="item in chatMessages" :key="item.id" class="chat-line" :class="item.role">
          <b>{{ item.role === 'user' ? '我' : '豆包' }}</b>
          <span>{{ item.text }}</span>
          <em v-if="item.confirmNote">{{ item.confirmNote }}</em>
        </div>
      </div>
      <div class="chat-send">
        <el-input v-model="chatDraft" type="textarea" :rows="3" placeholder="输入要跟豆包说的话，Ctrl+Enter 发送" @keydown.ctrl.enter.prevent="sendChat" />
        <el-button type="primary" :loading="chatSending" @click="sendChat">发送</el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAppStore } from '@/stores/app'
import ClipTabs from '@/components/ClipTabs.vue'
import { formatTime, statusType, uid } from '@/utils/format'

const store = useAppStore()
const keyword = ref('')

/** IPC 不能传 Vue 响应式 Proxy，否则会报 An object could not be cloned */
function plainCaptcha() {
  if (!store.settings.captchaSolver) store.settings.captchaSolver = { enabled: true }
  store.settings.captchaSolver.enabled = true
  try {
    return JSON.parse(JSON.stringify(store.settings.captchaSolver))
  } catch {
    return { enabled: true }
  }
}
const group = ref('')
const visible = ref(false)
const batchVisible = ref(false)
const batchText = ref('')
const form = reactive({ id: '', name: '', login: '', password: '', loginMode: 'qr', group: '默认分组', quota: '0/5' })
const saving = ref(false)
const rows = computed(() => store.doubaoAccounts.filter((item) => {
  if (keyword.value && !item.name.includes(keyword.value.trim())) return false
  if (group.value && item.group !== group.value) return false
  return true
}))
const enabledCount = computed(() => store.doubaoAccounts.filter((item) => item.enabled).length)
const waitingWorks = computed(() => store.works.filter((item) => item.status === '待生成').length)
const chatAccountId = ref('')
const chatSlot = ref('chat')
const chatDraft = ref('')
const chatSending = ref(false)
const openWindows = ref([])
const chatMessages = computed(() => (store.doubaoChats || []).filter((item) => item.accountId === chatAccountId.value && item.slot === chatSlot.value))

async function talk(row) {
  chatAccountId.value = row.id
  chatSlot.value = 'chat'
  if (!window.tujian?.openAccount) return ElMessage.warning('请在桌面窗口里和豆包对话')
  const result = await window.tujian.openAccount({
    kind: 'doubao',
    id: row.id,
    name: row.name,
    login: row.login,
    mode: row.loginMode || 'password',
    url: 'https://www.doubao.com/chat/',
    slot: 'chat',
    already: row.loginStatus === '已登录'
  })
  if (result?.loginStatus) row.loginStatus = result.loginStatus
  store.persist()
  ElMessage.success('豆包对话窗口已打开，在下方输入后发送')
  refreshWindows()
}

async function refreshWindows() {
  if (!window.tujian?.listDoubaoWindows) return
  openWindows.value = await window.tujian.listDoubaoWindows()
}

async function focusWindow(item) {
  if (!window.tujian?.focusDoubaoWindow) return
  await window.tujian.focusDoubaoWindow(item.key)
}

async function openExtra(row) {
  if (!window.tujian?.openAccount) return ElMessage.warning('请在桌面窗口里打开')
  const slot = `win-${Date.now().toString(36)}`
  chatAccountId.value = row.id
  chatSlot.value = slot
  const result = await window.tujian.openAccount({
    kind: 'doubao',
    id: row.id,
    name: row.name,
    login: row.login,
    mode: row.loginMode || 'password',
    url: 'https://www.doubao.com/chat/',
    slot,
    already: row.loginStatus === '已登录'
  })
  if (result?.loginStatus) row.loginStatus = result.loginStatus
  store.persist()
  ElMessage.success('已再开一个豆包窗口，登录和这个账号共用')
  refreshWindows()
}

async function newChatWindow() {
  const row = store.doubaoAccounts.find((item) => item.id === chatAccountId.value) || store.doubaoAccounts[0]
  if (!row) return ElMessage.warning('先添加一个豆包账号')
  await openExtra(row)
}

async function sendChat() {
  const text = chatDraft.value.trim()
  const account = store.doubaoAccounts.find((item) => item.id === chatAccountId.value)
  if (!account) return ElMessage.warning('先选择豆包账号')
  if (!text) return
  if (!window.tujian?.chatDoubao) return ElMessage.warning('请在桌面窗口里和豆包对话')
  if (!Array.isArray(store.doubaoChats)) store.doubaoChats = []
  store.doubaoChats.push({ id: uid('C'), accountId: account.id, slot: chatSlot.value, role: 'user', text, time: formatTime(new Date()) })
  chatDraft.value = ''
  chatSending.value = true
  try {
    const result = await window.tujian.chatDoubao({
      id: account.id,
      name: account.name,
      login: account.login,
      mode: account.loginMode || 'password',
      message: text,
      slot: chatSlot.value
    })
    if (result?.ok === false) throw new Error(result.message || '没有发进豆包')
    store.doubaoChats.push({
      id: uid('C'),
      accountId: account.id,
      slot: result.slot || chatSlot.value,
      role: 'assistant',
      text: result.reply || result.message || '已发送',
      confirmNote: result.confirmNote || '',
      time: formatTime(new Date())
    })
    if (result.reply) ElMessage.success('豆包已回复')
    else ElMessage.success(result.confirmNote || '已发送')
    store.addLog(result.confirmNeeded && !result.confirmSent ? 'warning' : 'info', '豆包对话', `${account.name} ${result.confirmNote || '已发送'}`)
    store.persist()
    refreshWindows()
  } catch (error) {
    ElMessage.error(error.message || '对话失败')
  } finally {
    chatSending.value = false
  }
}

async function createGroup() {
  try {
    const { value } = await ElMessageBox.prompt('分组名称', '新建分组')
    store.addGroup(value)
  } catch { /* 取消 */ }
}

async function checkOne(row) {
  if (!window.tujian?.accountStatus) return ElMessage.warning('请在桌面窗口里检测')
  const result = await window.tujian.accountStatus({ kind: 'doubao', id: row.id })
  row.loginStatus = result.loginStatus
  row.worker = '空闲'
  store.persist()
}

function checkAll() {
  store.doubaoAccounts.forEach(checkOne)
  ElMessage.success('检测结果已写回列表')
}

function startGenerate() {
  const pending = store.works.filter((item) => item.status === '待生成')
  if (!enabledCount.value) return ElMessage.warning('没有启用的豆包账号')
  if (!pending.length) return ElMessage.info('没有待生成的作品')
  const limit = Math.min(pending.length, Number(store.settings.doubaoOpen) || 1)
  pending.slice(0, limit).forEach((work, index) => {
    const account = store.doubaoAccounts.filter((item) => item.enabled)[index % enabledCount.value]
    if (account) account.worker = '生成中'
    store.kickGenerate(work.id)
  })
  store.addLog('info', '豆包', `按同时打开 ${limit} 条开始生成`)
}

function collectOnce() {
  const item = store.plaza.find((row) => !row.added)
  if (!item) return ElMessage.info('选品广场没有可收录的商品')
  store.addFromPlaza(item.id)
  ElMessage.success(`已收录 ${item.title}`)
}

function limitOf(row) {
  if (Number(row?.quotaLimit) > 0) return String(row.quotaLimit)
  const matched = String(row?.quota || '').match(/\/(\d+)/)
  return matched ? matched[1] : '5'
}

function edit(row) {
  store.addGroup('默认分组')
  if (row) Object.assign(form, { id: row.id, name: row.name, login: '', password: '', loginMode: 'qr', group: row.group || '默认分组', quota: limitOf(row) })
  else Object.assign(form, { id: '', name: '', login: '', password: '', loginMode: 'qr', group: '默认分组', quota: '5' })
  visible.value = true
}

async function showBrowsers(row) {
  const jobs = store.works.filter((work) => work.doubaoAccountId === row.id && (work.status === '生成中' || work.doubaoChatUrl))
  const pages = jobs.filter((work) => work.doubaoChatUrl)
  if (pages.length && window.tujian?.openAccount) {
    for (const work of pages) {
      await window.tujian.openAccount({
        kind: 'doubao',
        id: row.id,
        name: row.name,
        login: '',
        mode: 'qr',
        url: work.doubaoChatUrl,
        slot: work.doubaoSlot || `gen-${work.id}`,
        already: row.loginStatus === '已登录'
      })
    }
    ElMessage.success(pages.length === 1 ? `已打开编号 ${pages[0].no || ''} 的生成页` : `已打开 ${pages.length} 个视频的生成页`)
    return
  }
  if (!window.tujian?.listDoubaoWindows) return openRow(row)
  const list = await window.tujian.listDoubaoWindows()
  const mine = (list || []).filter((item) => String(item.key || '').startsWith(`doubao:${row.id}`))
  if (!mine.length) {
    ElMessage.info('这个账号还没有在跑的页面，已打开豆包')
    return openRow(row)
  }
  for (const item of mine) {
    if (window.tujian.focusDoubaoWindow) await window.tujian.focusDoubaoWindow(item.key)
  }
  ElMessage.success(mine.some((item) => item.hidden) ? '已把隐藏的豆包页面重新打开' : '已切到正在跑的豆包页面')
}

async function save() {
  if (!form.name.trim()) return ElMessage.warning('填写用户名')
  const id = form.id || uid('DB')
  const isNew = !form.id
  saving.value = true
  let row = null
  if (form.id) {
    row = store.doubaoAccounts.find((item) => item.id === form.id)
    if (row) Object.assign(row, { name: form.name.trim(), login: row.login && row.login !== '扫码登录' ? row.login : form.name.trim(), loginMode: 'qr', group: form.group, quotaLimit: Number(String(form.quota).match(/\d+/)?.[0]) || row.quotaLimit || 5 })
  } else {
    row = {
      id, name: form.name.trim(), login: '扫码登录', loginMode: 'qr', hasPassword: false,
      group: form.group, quota: '0/5', quotaLimit: Number(String(form.quota).match(/\d+/)?.[0]) || 5,
      enabled: true, loginStatus: '待登录', worker: '空闲', recent: '成功 0 · 失败 0', createdAt: formatTime(new Date())
    }
    store.doubaoAccounts.unshift(row)
  }
  store.syncDoubaoStats()
  store.persist()
  visible.value = false
  if (window.tujian?.bootstrapDoubaoLogin) {
    ElMessage.info('正在打开豆包并自动登录…')
    try {
      const result = await window.tujian.bootstrapDoubaoLogin({
        id: row.id,
        name: row.name,
        login: row.login,
        captcha: plainCaptcha()
      })
      if (result?.loginStatus) row.loginStatus = result.loginStatus
      store.persist()
      if (result?.ok) ElMessage.success(result.message || (isNew ? '已添加并打开豆包' : '已打开豆包登录'))
      else ElMessage.warning(result?.message || '豆包已打开，请在窗口里扫码')
      store.addLog('info', '豆包', `${row.name} ${result?.message || '自动登录'}`)
    } catch (error) {
      const tip = /could not be cloned/i.test(String(error?.message || error))
        ? '登录参数序列化失败，请再点一次打开'
        : (error.message || '自动登录未完成，可再点打开')
      ElMessage.warning(tip)
      store.addLog('warning', '豆包', `${row.name}：${tip}`)
    }
  }
  saving.value = false
}

async function openRow(row) {
  if (!window.tujian?.openAccount) return ElMessage.warning('请在桌面窗口里打开')
  if (row.loginStatus !== '已登录' && window.tujian?.bootstrapDoubaoLogin) {
    try {
      const result = await window.tujian.bootstrapDoubaoLogin({
        id: row.id,
        name: row.name,
        login: row.login,
        captcha: plainCaptcha()
      })
      row.loginStatus = result.loginStatus || row.loginStatus
      store.persist()
      if (result.message) result.ok ? ElMessage.success(result.message) : ElMessage.warning(result.message)
      store.addLog('info', '豆包', `${row.name} ${result.message || '自动登录'}`)
    } catch (error) {
      ElMessage.warning(error?.message || '打开豆包失败')
    }
    return
  }
  const result = await window.tujian.openAccount({
    kind: 'doubao',
    id: row.id,
    name: row.name,
    login: row.login,
    mode: row.loginMode || 'qr',
    already: row.loginStatus === '已登录',
    captcha: plainCaptcha()
  })
  row.loginStatus = result.loginStatus
  store.persist()
  if (result.message) result.ok ? ElMessage.success(result.message) : ElMessage.warning(result.message)
  store.addLog('info', '豆包', `${row.name} ${result.loginStatus === '已登录' ? '已登录，下次打开会沿用这个会话' : '已打开独立网页，登录成功一次后会永久记住'}`)
}

async function requestCode(row) {
  if (row.loginStatus === '已登录') return openRow(row)
  if (!row.login) return ElMessage.warning('先编辑这个账号，填上接收验证码的手机号')
  if (!window.tujian?.requestCode) return ElMessage.warning('请在桌面窗口里操作')
  const result = await window.tujian.requestCode({ kind: 'doubao', id: row.id, name: row.name, login: row.login })
  row.loginStatus = result.loginStatus
  store.persist()
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
  const result = await window.tujian.submitCode({ kind: 'doubao', id: row.id, name: row.name, login: row.login, code })
  row.loginStatus = result.loginStatus
  store.persist()
  if (result.ok) ElMessage.success(result.loginStatus === '已登录' ? '验证码已提交，登录状态已记住' : '验证码已填进这个账号的网页')
  else ElMessage.warning(result.message || '还没找到验证码输入框')
}

async function submitBatch() {
  try {
    const count = await store.batchAccounts('doubao', batchText.value)
    batchText.value = ''
    batchVisible.value = false
    ElMessage.success(`已添加 ${count} 个豆包账号`)
  } catch (error) {
    ElMessage.error(error.message || '添加失败')
  }
}

async function remove(row) {
  try { await ElMessageBox.confirm(`删除 ${row.name}？`, '删除', { type: 'warning' }) } catch { return }
  store.doubaoAccounts = store.doubaoAccounts.filter((item) => item.id !== row.id)
  await store.removeAccountSecret(row.id)
  store.persist()
}
</script>

<style scoped>
.chat-panel { display: flex; flex-direction: column; gap: 10px; }
.chat-log { min-height: 160px; max-height: 320px; overflow: auto; display: flex; flex-direction: column; gap: 8px; background: #f8fafc; border-radius: 12px; padding: 12px; }
.chat-line { display: flex; flex-direction: column; gap: 4px; max-width: 80%; }
.chat-line.user { align-self: flex-end; text-align: right; }
.chat-line span { background: #fff; border-radius: 10px; padding: 8px 10px; white-space: pre-wrap; }
.chat-line.user span { background: #ece9ff; }
.chat-line em { color: #667085; font-style: normal; font-size: 12px; }
.chat-send { display: flex; gap: 8px; align-items: flex-end; }
.chat-send .el-textarea { flex: 1; }
.window-list { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
