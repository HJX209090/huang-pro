<template>
  <div class="workbench review-bench">
    <section class="panel queue-pane">
      <strong>队列</strong>
      <p v-if="!sideWorks.length" class="muted">暂无相关作品。生成成功后会出现在这里，可审核；审核通过后进入定时发布。</p>
      <button
        v-for="work in sideWorks"
        :key="work.id"
        type="button"
        class="script-item"
        :class="{ on: work.id === currentId }"
        @click="router.replace({ path: '/workbench', query: { id: work.id } })"
      >
        <div class="goods-title">{{ work.title }}</div>
        <div class="goods-sub">{{ displayWorkStatus(work.status) }} · {{ work.model || '未填模型' }}</div>
      </button>
    </section>

    <section class="stage">
      <div class="player-frame">
        <video v-if="current?.videoPath" ref="player" :src="videoUrl(current.videoPath)" @click="playCurrent"></video>
        <p v-else>暂无待审核任务，请等待新任务</p>
        <p v-if="captionOn && current?.script" class="caption-line">{{ current.script }}</p>
      </div>
      <div class="stage-bar">
        <el-button size="small" @click="moveQueue(-1)">上一条</el-button>
        <el-button size="small" @click="moveQueue(1)">下一条</el-button>
        <el-button size="small" @click="cycleRate">{{ rateLabel }}</el-button>
        <el-button size="small" @click="toggleMute">{{ muted ? '打开声音' : '静音' }}</el-button>
        <el-checkbox v-model="leavePass">离开自动通过</el-checkbox>
      </div>
    </section>

    <section class="panel" style="overflow: auto">
      <h1 style="font-size: 16px; margin: 0 0 8px">{{ current ? displayWorkStatus(current.status) : '等待任务' }}</h1>
      <p v-if="current" class="goods-title">{{ current.title }}</p>
      <p v-if="feedback" class="review-note">{{ feedback }}</p>
      <div class="muted">本条成片</div>
      <div v-if="current?.status === '已生成'" class="review-actions">
        <el-button type="success" @click="approve">审核通过</el-button>
        <el-button type="danger" plain @click="reject">驳回</el-button>
      </div>
      <p v-else-if="current?.status === '审核通过'" class="review-note">已审核。可直接发布到抖音，或等定时任务自动发。</p>
      <p v-else-if="current?.status === '已发布'" class="review-note">已发布完成。</p>
      <el-input v-if="current?.status === '已生成'" v-model="reason" placeholder="驳回原因，不填则记为画面不通过" />
      <el-button style="width: 100%; margin: 10px 0" @click="playCurrent">直接播放</el-button>
      <div class="hotkeys">
        <div><b>快捷键</b></div>
        <div><kbd>Enter</kbd> 审核通过</div>
        <div><kbd>X</kbd> 审核驳回，作品仍保留</div>
        <div><kbd>Delete</kbd> 直接删除，Enter 确认</div>
        <div><kbd>↑</kbd> <kbd>↓</kbd> 上一条 / 下一条，离开时记通过</div>
        <div><kbd>空格</kbd> 播放 / 暂停</div>
        <div><kbd>←</kbd> <kbd>→</kbd> 后退 / 前进 5 秒</div>
        <div><kbd>M</kbd> 静音 / 开声</div>
        <div><kbd>T</kbd> 隐藏或一句 / 加一句</div>
        <div><kbd>F</kbd> 全屏，Esc 退出</div>
        <div><kbd>0</kbd> 从头再播</div>
      </div>
      <p class="muted" style="margin-top: 12px">打开任务并停在某一条，开始播放后，离开会自动通过并播下一条。也可以在生成时查看，作品仍保留，直接删除不能恢复。</p>
      <template v-if="current">
        <p v-if="current.failReason" style="color: #cf1322">{{ current.failReason }}</p>
        <div class="filters" style="margin: 8px 0">
          <el-button size="small" @click="chooseVideo">选择成片</el-button>
          <el-button size="small" :loading="stripping" @click="stripMark">拉取无水印</el-button>
        </div>
        <div v-if="current.videoPath" style="margin-top: 8px">
          <div class="muted" style="margin-bottom: 6px">发布预览 · {{ previewPublishTitle }} · {{ previewTopics.map((item) => '#' + item).join(' ') || '暂无话题' }}</div>
          <el-select v-model="accountId" placeholder="选择发布账号" style="width: 100%" @change="rememberAccount">
            <el-option
              v-for="item in store.publishAccounts"
              :key="item.id"
              :label="`${item.name}（${item.loginStatus || '未登录'}）`"
              :value="item.id"
            />
          </el-select>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px">
          <el-button v-if="current.status === '待生成' || current.status === '生成中'" type="primary" @click="store.kickGenerate(current.id)">用豆包生成 10 秒</el-button>
          <el-button v-if="current.videoPath" type="primary" :loading="publishing" @click="publish">发布到抖音</el-button>
          <el-button v-if="current.productId" @click="store.openPrompt([current.productId])">按原商品再生成</el-button>
        </div>
      </template>
    </section>
  </div>
</template>

<script setup>
import { computed, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAppStore } from '@/stores/app'
import { displayWorkStatus, publishTitleFromGoods, topicsFromGoods, videoUrl } from '@/utils/format'
import AppIcon from '@/components/AppIcon.vue'

const store = useAppStore()
const route = useRoute()
const router = useRouter()
const steps = [
  { name: '审核通过', at: 10 },
  { name: '审核原因 / 合规确认', at: 25 },
  { name: 'Seedance 高清翻译 / 分镜确认', at: 40 },
  { name: '下一步', at: 55 },
  { name: '静音 / 配音', at: 70 },
  { name: '抽帧 / 片头', at: 80 },
  { name: '成片', at: 90 },
  { name: '允许去水印', at: 100 }
]

const currentId = computed(() => String(route.query.id || ''))
const current = computed(() => store.works.find((item) => item.id === currentId.value) || null)
const currentProduct = computed(() => {
  const work = current.value
  if (!work) return null
  return store.products.find((row) => row.id === work.productId)
    || store.plaza.find((row) => row.id === work.productId)
    || null
})
const previewPublishTitle = computed(() => publishTitleFromGoods(current.value?.title, currentProduct.value || { title: current.value?.title }))
const previewTopics = computed(() => topicsFromGoods(current.value?.title, currentProduct.value || { title: current.value?.title }))
const accountId = ref('')
const player = ref(null)
const reason = ref('')
const feedback = ref('')
const leavePass = ref(true)
const muted = ref(false)
const rateLabel = ref('1x')
const captionOn = ref(false)
// 待审核进队；已审核仍留在侧栏方便发布，直到已发布或删掉
const queue = computed(() => store.works.filter((item) => item.status === '已生成' && item.videoPath))
const sideWorks = computed(() => store.works.filter((item) => ['已生成', '审核通过', '生成中', '生成失败', '发布中'].includes(item.status)))
onDeactivated(() => player.value?.pause())
const publishing = ref(false)
const stripping = ref(false)

watch(queue, (list) => {
  if (!current.value && list[0]) router.replace({ path: '/workbench', query: { id: list[0].id } })
}, { immediate: true })

watch(current, (work) => {
  if (!work) {
    accountId.value = ''
    return
  }
  const saved = store.publishAccounts.find((item) => item.id === work.publishAccountId)
    || store.publishAccounts.find((item) => item.name && item.name === work.publishAccount)
  const logged = store.publishAccounts.find((item) => item.loginStatus === '已登录')
  accountId.value = saved?.id || logged?.id || store.publishAccounts[0]?.id || ''
}, { immediate: true })

function stepState(step) {
  const work = current.value
  if (!work) return 'wait'
  if (work.status === '审核失败') return step.at <= 25 ? 'done' : 'fail'
  if (['已生成', '审核通过', '已发布', '发布中'].includes(work.status)) return 'done'
  if (work.status !== '生成中') return 'wait'
  if (work.progress >= step.at) return 'done'
  if (work.progress + 25 >= step.at) return 'run'
  return 'wait'
}

function stepLabel(step) {
  const state = stepState(step)
  if (state === 'done') return '完成'
  if (state === 'run') return '进行中'
  if (state === 'fail') return '待修改'
  return '等待'
}

async function stripMark() {
  if (!current.value) return ElMessage.warning('先选一条作品')
  const account = store.doubaoAccounts.find((item) => item.id === current.value.doubaoAccountId)
    || store.doubaoAccounts.find((item) => item.name === current.value.doubaoAccount)
    || store.doubaoAccounts[0]
  if (!account) return ElMessage.warning('先登录生成这条视频的豆包账号')
  if (!window.tujian?.pullCleanDoubao) return ElMessage.warning('请在桌面窗口里拉取无水印')
  stripping.value = true
  try {
    const result = await window.tujian.pullCleanDoubao({
      id: account.id,
      name: account.name,
      login: account.login,
      mode: account.loginMode || 'password',
      chatUrl: current.value.doubaoChatUrl || '',
      outputFile: current.value.videoPath,
      outputDir: store.settings.outputDir
    })
    if (!result?.ok) throw new Error(result?.message || '没有拿到无水印视频')
    current.value.videoPath = result.videoPath
    if (result.doubaoChatUrl) current.value.doubaoChatUrl = result.doubaoChatUrl
    store.persist()
    store.addLog('success', '去水印', result.message)
    ElMessage.success(result.message)
  } catch (error) {
    ElMessage.error(error.message || '没有拿到无水印视频')
  } finally {
    stripping.value = false
  }
}

async function chooseVideo() {
  if (!current.value) return ElMessage.info('先在左侧选一条作品')
  if (!window.tujian?.pickVideo) return ElMessage.warning('请在桌面窗口里选择视频')
  const file = await window.tujian.pickVideo()
  if (!file) return
  current.value.videoPath = file
  if (['待生成', '生成中'].includes(current.value.status)) current.value.status = '已生成'
  store.persist()
  ElMessage.success('成片已回到作品，可以审核')
}

function nextReview(currentWork) {
  const rest = queue.value.filter((item) => item.id !== currentWork?.id)
  if (rest[0]) router.replace({ path: '/workbench', query: { id: rest[0].id } })
}

async function approve() {
  const work = current.value || queue.value[0]
  if (!work) {
    feedback.value = '左边队列里没有待审核的成片'
    return ElMessage.warning(feedback.value)
  }
  if (!work.videoPath) {
    feedback.value = '这条还没有成片，不能通过'
    return ElMessage.warning(feedback.value)
  }
  if (work.status !== '已生成') {
    feedback.value = work.status === '审核通过'
      ? '这条已经是「已审核」，可直接发布或等定时任务'
      : '只有「待审核」成片可以审核通过。生成中请等成片，或点重新生成。'
    return ElMessage.warning(feedback.value)
  }
  const target = store.works.find((item) => item.id === work.id) || work
  target.status = '审核通过'
  target.reviewReason = reason.value.trim()
  target.reviewedAt = formatNow()
  store.addLog('success', '审核', `${target.title} 审核通过，可以发布或等到定时任务`)
  feedback.value = `「${target.title}」已审核通过`
  ElMessage.success(feedback.value)
  reason.value = ''
  await store.flush()
  nextReview(target)
}

async function reject() {
  const work = current.value || queue.value[0]
  if (!work) {
    feedback.value = '左边队列里没有可驳回的成片'
    return ElMessage.warning(feedback.value)
  }
  const text = reason.value.trim() || '画面不通过'
  const target = store.works.find((item) => item.id === work.id) || work
  target.status = '审核失败'
  target.failReason = text
  store.addLog('warning', '审核', `${target.title} 已驳回：${text}`)
  feedback.value = `「${target.title}」已驳回：${text}`
  ElMessage.warning(feedback.value)
  reason.value = ''
  await store.flush()
  nextReview(target)
}

function formatNow() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function rememberAccount(id) {
  if (!current.value) return
  const account = store.publishAccounts.find((item) => item.id === id)
  current.value.publishAccountId = id
  current.value.publishAccount = account?.name || ''
  store.persist()
}

async function publish() {
  if (!current.value || publishing.value) return
  const account = store.publishAccounts.find((item) => item.id === accountId.value)
  if (!account) return ElMessage.warning('先在上面选择发布账号')
  if (!current.value.videoPath) return ElMessage.warning('这条作品还没有成片')
  if (!window.tujian?.publishWork) return ElMessage.warning('请在桌面窗口里发布')
  publishing.value = true
  try {
    const payload = store.buildPublishPayload(current.value, account)
    current.value.publishTitle = payload.title
    current.value.publishTags = payload.tags
    const result = await window.tujian.publishWork(payload)
    if (result?.loginStatus) account.loginStatus = result.loginStatus
    if (!result?.ok || !result.attached) {
      store.addLog('warning', '发布', result?.message || `${current.value.title} 没有放进上传页`)
      ElMessage.warning(result?.message || '发布页没有放进成片')
      return
    }
    current.value.publishAccountId = account.id
    current.value.publishAccount = account.name
    // 未真正点到抖音「发布」时保持已审核，避免定时任务找不到成片
    current.value.status = result.published ? '已发布' : '审核通过'
    if (result.published && result.deleted) current.value.sourceDeleted = true
    if (result.published) store.notifyWebhook(`【huang++pro】已发布：${current.value.title}`)
    await store.flush()
    store.addLog(result.published ? 'success' : 'warning', '发布', result.message || `${current.value.title} 使用 ${account.name} 进入发布`)
    ElMessage.success(result.published ? (result.message || '已发布') : (result.message || `已用 ${account.name} 打开上传页，状态仍为已审核，可再发或等定时`))
  } finally {
    publishing.value = false
  }
}

function playCurrent() {
  const video = player.value
  if (!video) return ElMessage.info('这条还没有成片')
  if (video.paused) video.play()
  else video.pause()
}

function moveQueue(step) {
  const list = (sideWorks.value.length ? sideWorks.value : queue.value).slice()
  if (!list.length) return
  const work = current.value
  if (leavePass.value && work?.status === '已生成' && work.videoPath) {
    const target = store.works.find((item) => item.id === work.id) || work
    target.status = '审核通过'
    target.reviewedAt = formatNow()
    store.flush()
    feedback.value = `「${target.title}」离开时已审核通过`
  }
  const index = Math.max(0, list.findIndex((item) => item.id === currentId.value))
  const next = list[(index + step + list.length) % list.length]
  if (next && next.id !== work?.id) router.replace({ path: '/workbench', query: { id: next.id } })
}

function seekBy(seconds) {
  const video = player.value
  if (!video) return
  video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + seconds))
}

function toggleMute() {
  const video = player.value
  muted.value = !muted.value
  if (video) video.muted = muted.value
}

function cycleRate() {
  const video = player.value
  const next = !video || video.playbackRate === 1 ? 1.5 : video.playbackRate === 1.5 ? 2 : 1
  if (video) video.playbackRate = next
  rateLabel.value = `${next}x`
}

function toggleCaption() {
  captionOn.value = !captionOn.value
}

async function removeCurrent() {
  if (!current.value) return
  try {
    await ElMessageBox.confirm(`删除作品「${current.value.title}」？`, '删除', { type: 'warning' })
  } catch { return }
  store.works = store.works.filter((item) => item.id !== current.value.id)
  store.persist()
  router.replace('/workbench')
}

function onKey(event) {
  const tag = event.target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (event.key === 'Enter') approve()
  else if (event.key === 'x' || event.key === 'X') reject()
  else if (event.key === 'Delete') removeCurrent()
  else if (event.key === 'ArrowDown') moveQueue(1)
  else if (event.key === 'ArrowUp') moveQueue(-1)
  else if (event.key === 'ArrowRight') seekBy(5)
  else if (event.key === 'ArrowLeft') seekBy(-5)
  else if (event.key === ' ') {
    event.preventDefault()
    playCurrent()
  } else if (event.key === 'm' || event.key === 'M') toggleMute()
  else if (event.key === 't' || event.key === 'T') toggleCaption()
  else if (event.key === 'f' || event.key === 'F') player.value?.requestFullscreen?.()
  else if (event.key === '0' && player.value) player.value.currentTime = 0
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

function waitTask() {
  const next = store.works.find((item) => item.status === '待生成' || item.status === '生成中')
  if (!next) {
    ElMessage.info('暂时没有等待中的任务')
    return
  }
  router.replace({ path: '/workbench', query: { id: next.id } })
  if (next.status === '待生成') store.kickGenerate(next.id)
}
</script>

<style scoped>
.review-bench { grid-template-columns: 220px minmax(0, 1fr) 280px; background: transparent; }
.queue-pane { background: #fff; }
.stage { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; }
.player-frame { width: min(420px, 100%); aspect-ratio: 9 / 16; background: #111; color: #fff; border-radius: 28px; display: grid; place-items: center; position: relative; overflow: hidden; }
.player-frame video { width: 100%; height: 100%; object-fit: contain; background: #000; }
.caption-line { position: absolute; left: 16px; right: 16px; bottom: 28px; text-align: center; font-size: 14px; }
.stage-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: center; }
.hotkeys { display: flex; flex-direction: column; gap: 8px; color: #475467; font-size: 13px; line-height: 1.5; }
.hotkeys kbd { display: inline-block; min-width: 18px; padding: 0 4px; border: 1px solid #d0d5dd; border-radius: 4px; background: #f8fafc; }
.review-actions { display: flex; gap: 8px; margin: 8px 0; }
.review-actions .el-button { flex: 1; }
.review-note { margin: 0 0 8px; color: #7c5cfc; }
</style>
