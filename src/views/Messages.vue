<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>消息</h1>
        <p class="muted">扫码登录过期会出现在这里。账密账号过期会在后台自动登录，不发消息。</p>
      </div>
      <el-button @click="markAll">全部已读</el-button>
    </div>
    <div class="panel">
      <div v-if="!rows.length" class="muted">暂无消息。登录巡检发现扫码过期后会写到这里。</div>
      <div v-for="item in rows" :key="item.id" class="msg" :class="{ unread: !item.read && !item.done }">
        <div class="msg-head">
          <strong>{{ item.title || '需要重新登录' }}</strong>
          <span class="muted">{{ item.createdAt }}</span>
        </div>
        <p>{{ item.text }}</p>
        <div class="msg-actions">
          <el-button v-if="!item.done" type="primary" size="small" :loading="opening === item.id" @click="relogin(item)">去登录</el-button>
          <el-tag v-else size="small" type="info">已处理</el-tag>
          <el-button link @click="read(item)">标为已读</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useAppStore } from '@/stores/app'

const store = useAppStore()
const opening = ref('')
const rows = computed(() => (store.inbox || []).filter((item) => !item.done).concat((store.inbox || []).filter((item) => item.done)).slice(0, 40))

function read(item) {
  item.read = true
  store.persist()
}

function markAll() {
  for (const item of store.inbox || []) item.read = true
  store.persist()
}

function plainCaptcha() {
  try { return JSON.parse(JSON.stringify(store.settings.captchaSolver || { enabled: true })) } catch { return { enabled: true } }
}

async function relogin(item) {
  if (!window.tujian?.openAccount) return ElMessage.warning('请在桌面窗口里登录')
  opening.value = item.id
  item.read = true
  try {
    if (item.accountKind === 'doubao') {
      const account = store.doubaoAccounts.find((row) => row.id === item.accountId)
      if (!account) return ElMessage.warning('这个豆包账号已经不在了')
      const result = await window.tujian.bootstrapDoubaoLogin({
        id: account.id,
        name: account.name,
        login: account.login,
        captcha: plainCaptcha()
      })
      if (result?.loginStatus) account.loginStatus = result.loginStatus
      ElMessage.success(result?.message || '已打开豆包登录')
    } else {
      const account = store.publishAccounts.find((row) => row.id === item.accountId)
      if (!account) return ElMessage.warning('这个抖音账号已经不在了')
      const creator = item.scope === 'creator'
      const result = await window.tujian.openAccount({
        kind: 'publish',
        id: account.id,
        name: account.name,
        login: account.loginMode === 'qr' ? '' : account.login,
        mode: 'qr',
        url: creator
          ? 'https://creator.douyin.com/creator-micro/content/upload'
          : 'https://buyin.jinritemai.com/dashboard',
        slot: creator ? 'creator-boot' : ''
      })
      if (creator) account.creatorLoginStatus = result?.loginStatus === '已登录' ? '已登录' : (account.creatorLoginStatus || '待登录')
      else {
        account.buyinLoginStatus = result?.loginStatus === '已登录' ? '已登录' : '待登录'
        account.loginStatus = account.buyinLoginStatus
      }
      ElMessage.success(creator ? '已打开创作者中心，请扫码' : '已打开达人工作台，请扫码')
    }
    store.persist()
  } catch (error) {
    ElMessage.warning(error?.message || '没有打开登录页')
  } finally {
    opening.value = ''
  }
}
</script>

<style scoped>
.msg { border: 1px solid #eaecf0; border-radius: 12px; padding: 14px 16px; margin-bottom: 10px; background: #fff; }
.msg.unread { border-color: #b7d4ff; background: #f5f9ff; }
.msg-head { display: flex; justify-content: space-between; gap: 12px; }
.msg p { margin: 8px 0; }
.msg-actions { display: flex; align-items: center; gap: 8px; }
</style>
