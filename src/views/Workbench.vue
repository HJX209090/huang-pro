<template>
  <div ref="benchRef" class="workbench review-bench">
    <div class="bench-head">
      <div class="bench-title">
        <h1>审片工作台</h1>
        <span v-if="benchId" class="bench-id">{{ benchId }}</span>
      </div>
      <div class="bench-stats">
        <span>待审核 <b>{{ queue.length }}</b></span>
        <span>本次通过 <b class="ok">{{ passed }}</b></span>
        <span>本次驳回 <b class="bad">{{ rejected }}</b></span>
        <el-button @click="refreshBench">刷新</el-button>
        <el-button @click="toggleFull">全屏</el-button>
      </div>
    </div>
    <section class="panel queue-pane">
      <div class="queue-head"><strong>队列</strong><b>{{ queue.length }}</b></div>
      <p v-if="!queue.length" class="queue-empty">暂无待审核任务</p>
      <button
        v-for="work in queue"
        :key="work.id"
        type="button"
        class="script-item"
        :class="{ on: work.id === currentId }"
        @click="router.replace({ path: '/workbench', query: { id: work.id } })"
      >
        <div class="goods-title">{{ work.no ? `编号${work.no} ` : '' }}{{ work.title }}</div>
        <div class="goods-sub">待审核</div>
      </button>
    </section>

    <section class="stage">
      <div class="player-slot">
        <div class="player-frame">
          <video
            v-if="current?.videoPath"
            :key="current.videoPath"
            ref="player"
            :src="videoUrl(current.videoPath)"
            preload="metadata"
            playsinline
            @click="playCurrent"
            @ended="onEnded"
          ></video>
          <p v-else>暂无待审核任务，请等待新任务</p>
        </div>
      </div>
      <div class="stage-bar">
        <el-button @click="moveQueue(-1)">↑ 上一条</el-button>
        <el-button @click="moveQueue(1)">↓ 下一条</el-button>
        <el-select v-model="rateValue" class="rate-select" @change="applyRate">
          <el-option v-for="item in rates" :key="item" :label="`${item}x`" :value="item" />
        </el-select>
        <el-button @click="toggleMute">{{ muted ? '打开声音' : '静音' }}</el-button>
        <el-checkbox v-model="endPass">播完自动通过</el-checkbox>
      </div>
      <p class="stage-hint">打开后先停住，空格或点画面再播放。鼠标放在商品图上，左右键换图。</p>
    </section>

    <section
      class="image-board"
      @mouseenter="galleryHot = true"
      @mouseleave="galleryHot = false"
    >
      <div class="board-head">
        <b>商品图</b>
        <span v-if="shotUrls.length">{{ shotUrls.length }} 张</span>
      </div>
      <p v-if="!shotUrls.length" class="board-empty">这条还没有商品图</p>
      <div v-else class="filmstrip">
        <button
          v-for="(src, index) in shotUrls"
          :key="`${src}-${index}`"
          type="button"
          class="shot"
          :class="{ on: index === shotIndex }"
          @click="shotIndex = index"
        >
          <HoverPreview :images="shotUrls" :start="index">
            <img :src="src" alt="商品图" />
          </HoverPreview>
        </button>
      </div>
    </section>

    <section class="panel review-side">
      <div class="muted">本条审核</div>
      <h2>{{ current ? (current.no ? `编号${current.no}` : '待审核') : '等待任务' }}</h2>
      <p v-if="current" class="goods-title">{{ current.title }}</p>
      <p v-else class="muted">队列里没有待审核成片。</p>
      <el-button class="side-btn pass" type="success" :disabled="current?.status !== '已生成'" @click="approve">审核通过 <kbd>Enter</kbd></el-button>
      <el-button class="side-btn" :disabled="current?.status !== '已生成'" @click="reject">审核驳回 <kbd>X</kbd></el-button>
      <el-input v-if="current" v-model="reason" placeholder="驳回原因，不填则记为画面不通过" />
      <el-button class="side-btn" :disabled="!current" @click="removeCurrent">直接删除 <kbd>Delete</kbd></el-button>
      <div class="hotkeys">
        <b>快捷键</b>
        <div><kbd>Enter</kbd> 审核通过</div>
        <div><kbd>X</kbd> 审核驳回，作品仍保留</div>
        <div><kbd>Delete</kbd> 直接删除，Enter 确认</div>
        <div><kbd>↑</kbd> <kbd>↓</kbd> 上一条 / 下一条</div>
        <div><kbd>空格</kbd> 播放 / 暂停</div>
        <div><kbd>←</kbd> <kbd>→</kbd> 商品图区域换图，视频上快进快退 5 秒</div>
        <div><kbd>M</kbd> 静音 / 开声</div>
        <div><kbd>F</kbd> 全屏，Esc 退出</div>
        <div><kbd>0</kbd> 从头再播</div>
      </div>
      <p class="side-note">打开后先停在某一条。勾选播完自动通过后，这条片播完会通过并切到下一条。也可以先看商品图。直接删除不能恢复。</p>
    </section>
  </div>
</template>

<script setup>
import { computed, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAppStore } from '@/stores/app'
import { displayWorkStatus, imageUrl, publishTitleFromGoods, topicsFromGoods, videoUrl } from '@/utils/format'
import AppIcon from '@/components/AppIcon.vue'
import HoverPreview from '@/components/HoverPreview.vue'

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
const previewPublishTitle = computed(() => current.value?.optimizedTitle || publishTitleFromGoods(current.value?.title, currentProduct.value || { title: current.value?.title }))
const previewTopics = computed(() => (current.value?.optimizedTags?.length ? current.value.optimizedTags : topicsFromGoods(current.value?.title, currentProduct.value || { title: current.value?.title })))
const shotUrls = computed(() => {
  const work = current.value
  if (!work) return []
  return store.productShots(work).map((item) => imageUrl(item)).filter(Boolean)
})
const accountId = ref('')
const player = ref(null)
const benchRef = ref(null)
const reason = ref('')
const endPass = ref(false)
const muted = ref(false)
const rateValue = ref(1)
const rates = [0.75, 1, 1.25, 1.5, 2]
const passed = ref(0)
const rejected = ref(0)
const benchId = computed(() => store.user?.id || store.user?.phone || '')
// 待审核进队；已审核仍留在侧栏方便发布，直到已发布或删掉
const queue = computed(() => store.works.filter((item) => item.status === '已生成' && item.videoPath))
onDeactivated(() => player.value?.pause())
const publishing = ref(false)
const stripping = ref(false)
const regenId = ref('')
const shotIndex = ref(0)
const galleryHot = ref(false)
watch(shotUrls, () => {
  if (shotIndex.value >= shotUrls.value.length) shotIndex.value = 0
})

function stepShot(delta) {
  const count = shotUrls.value.length
  if (!count) return
  shotIndex.value = (shotIndex.value + delta + count) % count
}

async function regenerateCurrent() {
  const work = current.value
  if (!work || regenId.value) return
  regenId.value = work.id
  try {
    const message = await store.regenerateWork(work.id)
    if (message) ElMessage.warning(message)
    else ElMessage.success('已按这条商品重新生成')
  } catch (error) {
    ElMessage.error(error.message || '重新生成失败')
  } finally {
    regenId.value = ''
  }
}

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

function queueLabel(work) {
  if (work.id === currentId.value) return '正在查看'
  if (['审核通过', '已发布', '发布中'].includes(work.status)) return '已审核'
  return '未审核'
}

function queueTone(work) {
  const label = queueLabel(work)
  if (label === '正在查看') return 'viewing'
  if (label === '已审核') return 'done'
  return 'pending'
}

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
  if (!work) return ElMessage.warning('左边队列里没有待审核的成片')
  if (!work.videoPath) return ElMessage.warning('这条还没有成片，不能通过')
  if (work.status !== '已生成') {
    return ElMessage.warning(work.status === '审核通过'
      ? '这条已经是「已审核」，可直接发布或等定时任务'
      : '只有「待审核」成片可以审核通过。生成中请等成片，或点重新生成。')
  }
  const target = store.works.find((item) => item.id === work.id) || work
  target.status = '审核通过'
  target.reviewReason = reason.value.trim()
  target.reviewedAt = formatNow()
  store.addLog('success', '审核', `${target.title} 审核通过，可以发布或等到定时任务`)
  passed.value += 1
  ElMessage.success(`「${target.title}」已审核通过`)
  reason.value = ''
  await store.flush()
  nextReview(target)
}

async function reject() {
  const work = current.value || queue.value[0]
  if (!work) return ElMessage.warning('左边队列里没有可驳回的成片')
  const text = reason.value.trim() || '画面不通过'
  const target = store.works.find((item) => item.id === work.id) || work
  target.status = '审核失败'
  target.failReason = text
  target.rejectedAt = formatNow()
  store.addLog('warning', '审核', `${target.title} 已驳回：${text}`)
  rejected.value += 1
  ElMessage.warning(`「${target.title}」已驳回：${text}`)
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
    const statusBefore = current.value.status
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
    current.value.status = result.published ? '已发布' : (statusBefore === '已发布' ? '已发布' : '审核通过')
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
  const list = queue.value.slice()
  if (!list.length) return
  const index = Math.max(0, list.findIndex((item) => item.id === currentId.value))
  const next = list[(index + step + list.length) % list.length]
  if (next && next.id !== current.value?.id) router.replace({ path: '/workbench', query: { id: next.id } })
}

function onEnded() {
  if (!endPass.value) return
  if (current.value?.status === '已生成' && current.value.videoPath) approve()
}

function applyRate() {
  if (player.value) player.value.playbackRate = Number(rateValue.value) || 1
}

function refreshBench() {
  const still = queue.value.some((item) => item.id === currentId.value)
  if (!still) {
    const next = queue.value[0]
    router.replace(next ? { path: '/workbench', query: { id: next.id } } : '/workbench')
  }
  ElMessage.success(`待审核 ${queue.value.length} 条`)
}

function toggleFull() {
  const node = benchRef.value
  if (!node) return
  if (document.fullscreenElement) document.exitFullscreen?.()
  else node.requestFullscreen?.()
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
  else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    if (document.querySelector('.el-image-viewer__wrapper')) return
    if (galleryHot.value && shotUrls.value.length) {
      event.preventDefault()
      stepShot(event.key === 'ArrowLeft' ? -1 : 1)
      return
    }
    seekBy(event.key === 'ArrowLeft' ? -5 : 5)
  }
  else if (event.key === ' ') {
    event.preventDefault()
    playCurrent()
  }   else if (event.key === 'm' || event.key === 'M') toggleMute()
  else if (event.key === 'f' || event.key === 'F') toggleFull()
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
.review-bench {
  height: 100%;
  max-height: 100%;
  min-height: 0;
  overflow: hidden;
  grid-template-columns: minmax(180px, 240px) minmax(0, 1fr) minmax(220px, 280px);
  grid-template-rows: auto minmax(0, 1fr) auto;
  align-items: stretch;
  background: transparent;
  gap: 12px;
}
.bench-head { grid-column: 1 / -1; grid-row: 1; display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap; }
.bench-title { display: flex; align-items: baseline; gap: 10px; }
.bench-title h1 { margin: 0; font-size: 22px; }
.bench-id { color: #98a2b3; font-size: 14px; }
.bench-stats { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; color: #475467; }
.bench-stats b { font-size: 18px; margin-left: 4px; }
.bench-stats .ok { color: #12b76a; }
.bench-stats .bad { color: #f04438; }
.queue-pane { grid-column: 1; grid-row: 2; background: #fff; overflow: auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
.stage { grid-column: 2; grid-row: 2; display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 8px; min-width: 0; min-height: 0; height: 100%; overflow: hidden; }
.review-side { grid-column: 3; grid-row: 2 / 4; overflow: auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 10px; }
.image-board {
  grid-column: 1 / 3;
  grid-row: 3;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid #eaecf0;
  border-radius: 12px;
  overflow: hidden;
}
.board-head { display: flex; justify-content: space-between; align-items: center; color: #475467; }
.board-empty { margin: 0; color: #98a2b3; }
.queue-head { display: flex; justify-content: space-between; align-items: center; }
.queue-empty { margin: 24px 0; text-align: center; color: #98a2b3; }
.queue-pane .script-item { width: 100%; text-align: left; }
.queue-pane .goods-title { word-break: break-word; line-height: 1.4; }
.player-slot { flex: 1 1 auto; min-height: 0; width: 100%; display: flex; align-items: center; justify-content: center; container-type: size; }
.player-frame { width: min(100cqw, calc(100cqh * 9 / 16)); height: min(100cqh, calc(100cqw * 16 / 9)); max-width: 100%; max-height: 100%; aspect-ratio: 9 / 16; background: #111; color: #d0d5dd; border-radius: 16px; display: grid; place-items: center; position: relative; overflow: hidden; }
.stage-bar, .stage-hint, .filmstrip { flex: none; }
.stage-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: center; }
.rate-select { width: 88px; }
.stage-hint { margin: 0; color: #98a2b3; font-size: 13px; text-align: center; }
.filmstrip { width: 100%; display: flex; gap: 8px; overflow-x: auto; flex: none; }
.shot { border: 1px solid transparent; padding: 0; background: transparent; cursor: zoom-in; flex: none; border-radius: 8px; }
.shot.on { border-color: #6d4aff; }
.filmstrip img { width: 264px; height: 264px; object-fit: cover; border-radius: 10px; background: #111; display: block; }
.shot-preview { width: 100%; max-height: 78vh; object-fit: contain; background: #111; border-radius: 12px; }
.review-side h2 { margin: 0; font-size: 22px; }
.side-btn { width: 100%; margin: 0; min-height: 44px; justify-content: space-between; }
.side-btn kbd, .hotkeys kbd { display: inline-block; min-width: 18px; margin-left: 6px; padding: 0 4px; border: 1px solid #d0d5dd; border-radius: 4px; background: #f8fafc; font-size: 12px; }
.hotkeys { display: flex; flex-direction: column; gap: 8px; color: #475467; font-size: 13px; line-height: 1.5; }
.side-note { margin: 0; color: #98a2b3; line-height: 1.6; font-size: 13px; }
.q-status { display: inline-block; padding: 0 6px; border-radius: 999px; font-size: 12px; }
.q-status.viewing { background: #e8f0ff; color: #2f5bff; }
.q-status.done { background: #e8f8ef; color: #067647; }
.q-status.pending { background: #fff4e8; color: #d46b08; }
.player-frame video { width: 100%; height: 100%; object-fit: contain; background: #000; }
.review-note { margin: 0; color: #7c5cfc; }
@media (max-width: 1100px) {
  .review-bench {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(72px, 16%) minmax(0, 1fr) auto minmax(160px, 28%);
    height: 100%;
    max-height: 100%;
  }
  .queue-pane { grid-column: 1; grid-row: 2; max-height: none; }
  .stage { grid-column: 1; grid-row: 3; }
  .image-board { grid-column: 1; grid-row: 4; }
  .review-side { grid-column: 1; grid-row: 5; }
}
</style>
