<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>RPA 流程</h1>
        <p>按步骤打开发布账号的网页。上传会把审核通过的成片放进创作者中心，最后一步发布仍在那个窗口里由你点。</p>
      </div>
    </div>
    <div class="tool-grid">
      <article v-for="flow in flows" :key="flow.id" class="flow-card">
        <div class="toolbar" style="margin: 0">
          <strong>{{ flow.name }}</strong>
          <el-tag size="small">{{ flow.platform }}</el-tag>
          <el-switch v-model="flow.enabled" class="grow" @change="store.persist()" />
        </div>
        <div class="sub-line" style="margin: 8px 0">最近演练：{{ flow.lastRun || '还没有' }}</div>
        <div class="script-list">
          <div v-for="(step, index) in flow.steps" :key="step" class="step" :class="stepClass(flow, index)">
            <span>{{ index + 1 }}. {{ step }}</span>
            <span class="sub-line">{{ stepText(flow, index) }}</span>
          </div>
        </div>
        <el-button style="margin-top: 12px" type="primary" :disabled="!flow.enabled || runningId === flow.id" @click="run(flow)">
          {{ runningId === flow.id ? '执行中' : '执行流程' }}
        </el-button>
      </article>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useAppStore } from '@/stores/app'
import { formatTime } from '@/utils/format'

const store = useAppStore()
const flows = computed(() => store.rpaFlows.filter((item) => item.platform === '抖音'))
const runningId = ref('')
const stepIndex = ref(-1)

function stepClass(flow, index) {
  if (runningId.value !== flow.id) return ''
  if (index < stepIndex.value) return 'done'
  if (index === stepIndex.value) return 'run'
  return ''
}

function stepText(flow, index) {
  if (runningId.value !== flow.id) return '等待'
  if (index < stepIndex.value) return '完成'
  if (index === stepIndex.value) return '进行中'
  return '等待'
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function run(flow) {
  if (runningId.value) return
  const account = store.publishAccounts.find((item) => item.enabled) || store.publishAccounts[0]
  if (!account) return ElMessage.warning('先添加一个发布账号')
  if (!window.tujian?.openAccount) return ElMessage.warning('请在桌面窗口里执行')
  const work = store.works.find((item) => item.status === '审核通过' && item.videoPath)
    || store.works.find((item) => item.videoPath && ['已生成', '发布中'].includes(item.status))
  runningId.value = flow.id
  let stopped = ''
  for (let index = 0; index < flow.steps.length; index += 1) {
    stepIndex.value = index
    const step = flow.steps[index]
    store.addLog('info', 'RPA', `${flow.name} · ${step}`)
    if (/打开|环境/.test(step)) {
      const opened = await window.tujian.openAccount({
        kind: 'publish',
        id: account.id,
        name: account.name,
        login: account.login,
        mode: account.loginMode || 'password',
        url: 'https://creator.douyin.com/creator-micro/content/upload'
      })
      account.loginStatus = opened?.loginStatus || account.loginStatus
      if (!opened?.ok) {
        stopped = opened?.message || '发布页没有打开'
        break
      }
    } else if (/登录/.test(step)) {
      const status = await window.tujian.accountStatus({ kind: 'publish', id: account.id })
      account.loginStatus = status?.loginStatus || account.loginStatus
      if (account.loginStatus !== '已登录') {
        stopped = '这个账号还没登录。请在打开的窗口里登录，登录成功后再执行。'
        break
      }
    } else if (/上传|文案/.test(step)) {
      if (!work?.videoPath) {
        stopped = '没有审核通过的成片，上传这一步停在这里'
        break
      }
      const published = await window.tujian.publishWork(store.buildPublishPayload(work, account))
      if (published?.loginStatus) account.loginStatus = published.loginStatus
      if (!published?.ok || !published.attached) {
        stopped = published?.message || '成片没有放进上传页'
        break
      }
      if (published.published) {
        work.status = '已发布'
        if (published.deleted) work.sourceDeleted = true
        store.notifyWebhook(`【huang++pro】已发布：${work.title}`)
      }
      work.status = '发布中'
      work.publishAccount = account.name
      work.publishAccountId = account.id
    } else if (/挂购物车|提交发布/.test(step)) {
      stopped = `「${step}」要在已经打开的创作者中心窗口里完成，软件不会替你点最终发布。`
      break
    }
    await wait(300)
  }
  flow.lastRun = formatTime(new Date())
  store.persist()
  if (stopped) {
    store.addLog('warning', 'RPA', `${flow.name} 停在：${stopped}`)
    ElMessage.warning(stopped)
  } else {
    store.addLog('success', 'RPA', `${flow.name} 已在发布账号窗口里执行`)
    ElMessage.success(`${flow.name} 已执行`)
  }
  runningId.value = ''
  stepIndex.value = -1
}
</script>
