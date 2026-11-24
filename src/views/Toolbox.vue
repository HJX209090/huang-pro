<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>工具箱</h1>
        <p>剪辑、去水印、文案和账号准备都在这里。视频处理需要本机已安装 ffmpeg。</p>
      </div>
      <el-tag :type="ffmpegOk ? 'success' : 'warning'">{{ ffmpegOk ? 'ffmpeg 可用' : '未检测到 ffmpeg' }}</el-tag>
    </div>

    <section v-for="group in groups" :key="group.title" class="tool-section">
      <h2>{{ group.title }}</h2>
      <div class="tool-grid">
        <article v-for="item in group.items" :key="item.id" class="tool-card">
          <h3>{{ item.title }} <el-tag v-if="item.hot" size="small" type="danger">常用</el-tag></h3>
          <p class="muted">{{ item.desc }}</p>
          <el-button type="primary" plain @click="openTool(item.id)">进入</el-button>
        </article>
      </div>
    </section>

    <el-dialog v-model="visible" :title="currentTitle" width="720px" top="6vh">
      <div v-if="tool === 'watermark'" class="tool-body">
        <p class="muted">按豆包对话里的无水印地址重新下载成片。页面上那个带「豆包AI生成」的视频不会再存进来。先选已生成的作品，软件会打开对应豆包对话再拉取。</p>
        <div class="toolbar">
          <el-button :disabled="!localWorks.length" @click="useWorks">带上已生成成片（{{ localWorks.length }}）</el-button>
          <el-button type="primary" :loading="running" :disabled="!files.length" @click="runDoubaoWatermark">拉取无水印</el-button>
        </div>
        <div v-for="file in files" :key="file" class="file-line">{{ file }}</div>
      </div>

      <div v-else-if="tool === 'slice' || tool === 'hook'" class="tool-body">
        <p class="muted">{{ tool === 'slice' ? '按秒数把一条视频切成多段。' : '截取开头几秒，当作爆款开口素材。' }}</p>
        <div class="toolbar">
          <el-button @click="pickOne">选择视频</el-button>
          <span class="muted">{{ tool === 'slice' ? '每段秒数' : '开头秒数' }}</span>
          <el-input-number v-model="seconds" :min="3" :max="60" />
          <el-button type="primary" :loading="running" :disabled="!oneFile" @click="runSlice">开始</el-button>
        </div>
        <div v-if="oneFile" class="file-line">{{ oneFile }}</div>
      </div>

      <div v-else-if="tool === 'trim'" class="tool-body">
        <p class="muted">按开始和结束时间裁一段，时间写成 00:00:03 这种。</p>
        <div class="toolbar">
          <el-button @click="pickOne">选择视频</el-button>
          <el-input v-model="trimStart" placeholder="开始" style="width: 120px" />
          <el-input v-model="trimEnd" placeholder="结束" style="width: 120px" />
          <el-button type="primary" :loading="running" :disabled="!oneFile" @click="runTrim">裁切</el-button>
        </div>
        <div v-if="oneFile" class="file-line">{{ oneFile }}</div>
      </div>

      <div v-else-if="tool === 'probe'" class="tool-body">
        <div class="toolbar">
          <el-button @click="pickOne">选择视频</el-button>
          <el-button type="primary" :loading="running" :disabled="!oneFile" @click="runProbe">解析</el-button>
        </div>
        <pre v-if="probeText" class="probe">{{ probeText }}</pre>
      </div>

      <div v-else-if="tool === 'remix'" class="tool-body">
        <p class="muted">用当前提示词模板，按所选商品换成对应提示词，再把参考视频发给豆包。豆包写出「视频生成参数确认」后，会再发「确认，直接开始生成。」并检测有没有发出。</p>
        <el-select v-model="accountId" placeholder="豆包账号" style="width: 220px">
          <el-option v-for="item in store.doubaoAccounts" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
        <el-select v-model="remixProductId" clearable filterable placeholder="选一件商品，模板里的商品标题会换成它" style="width: 100%">
          <el-option v-for="item in store.products" :key="item.id" :label="item.title" :value="item.id" />
        </el-select>
        <div class="toolbar" style="margin-top: 10px">
          <el-button @click="pickOne">选择参考视频</el-button>
          <el-button type="primary" :loading="running" @click="runRemix">发给豆包</el-button>
        </div>
        <div v-if="oneFile" class="file-line">{{ oneFile }}</div>
        <p class="muted">当前模板：{{ activeTemplateName }}</p>
      </div>

      <div v-else-if="tool === 'download'" class="tool-body">
        <p class="muted">把已经生成、并且成片还在电脑上的作品复制到一个文件夹。</p>
        <el-button type="primary" :loading="running" @click="runDownload">选择目录并复制</el-button>
        <div class="muted" style="margin-top: 8px">可复制 {{ localWorks.length }} 条</div>
      </div>

      <div v-else-if="tool === 'article'" class="tool-body">
        <el-input v-model="article" type="textarea" :rows="8" placeholder="粘贴文章或文案" />
        <el-button style="margin-top: 8px" type="primary" @click="extractArticle">提取句子</el-button>
        <div v-for="(line, index) in articleLines" :key="index" class="file-line">{{ line }}</div>
      </div>

      <div v-else-if="tool === 'cheap' || tool === 'cheap2'" class="tool-body">
        <div class="toolbar">
          <span class="muted">价格不高于</span>
          <el-input-number v-model="priceMax" :min="0" :precision="2" />
          <el-button v-if="tool === 'cheap2'" type="primary" :disabled="!cheapRows.length" @click="generateCheap">用当前模板生成</el-button>
        </div>
        <el-table :data="cheapRows" size="small" max-height="320" @selection-change="onCheapSelect">
          <el-table-column v-if="tool === 'cheap2'" type="selection" width="42" />
          <el-table-column prop="title" label="商品" min-width="220" />
          <el-table-column prop="price" label="价格" width="90" />
          <el-table-column prop="rate" label="佣金%" width="90" />
        </el-table>
      </div>

      <div v-else-if="tool === 'words' || tool === 'topics'" class="tool-body">
        <p class="muted">{{ tool === 'words' ? '从选品标题里抽出出现最多的词。' : '把选品标题收成可复制的话题。' }}</p>
        <div v-for="item in wordRows" :key="item.text" class="file-line">{{ item.text }} · {{ item.count }}</div>
        <el-button @click="copyWords">复制</el-button>
      </div>

      <div v-else-if="tool === 'follow'" class="tool-body">
        <p class="muted">一行一个主页链接。会用选中的发布账号打开，并点页面上的关注。</p>
        <el-select v-model="publishId" placeholder="发布账号" style="width: 220px; margin-bottom: 8px">
          <el-option v-for="item in store.publishAccounts" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
        <el-input v-model="followText" type="textarea" :rows="6" placeholder="https://" />
        <el-button style="margin-top: 8px" type="primary" :loading="running" @click="runFollow">开始</el-button>
      </div>

      <div v-else-if="tool === 'links'" class="tool-body">
        <el-input v-model="linkText" type="textarea" :rows="6" placeholder="粘贴一段文字，提取里面的 http 链接" />
        <el-button style="margin-top: 8px" @click="extractLinks">提取</el-button>
        <div v-for="item in links" :key="item" class="file-line">{{ item }}</div>
        <el-button v-if="links.length" @click="copyLinks">复制</el-button>
      </div>

      <div v-else-if="tool === 'delete-works'" class="tool-body">
        <el-select v-model="deleteStatus" style="width: 160px">
          <el-option v-for="item in ['已发布', '待生成', '已生成', '发布中']" :key="item" :label="item" :value="item" />
        </el-select>
        <el-button type="danger" plain style="margin-left: 8px" @click="deleteWorks">删除这些作品记录</el-button>
      </div>

      <div v-else-if="tool === 'commission'" class="tool-body">
        <el-table :data="commissionRows" size="small" max-height="360">
          <el-table-column prop="title" label="商品" min-width="220" />
          <el-table-column prop="price" label="价格" width="90" />
          <el-table-column prop="rate" label="佣金%" width="90" />
          <el-table-column label="预估赚" width="100">
            <template #default="{ row }">¥{{ ((Number(row.price) || 0) * (Number(row.rate) || 0) / 100).toFixed(2) }}</template>
          </el-table-column>
        </el-table>
      </div>

      <div v-else-if="tool === 'cleanup'" class="tool-body">
        <p class="muted">清理作品输出目录里超过指定天数的视频和图片。</p>
        <div class="toolbar">
          <span class="muted">超过</span>
          <el-input-number v-model="cleanDays" :min="1" :max="365" />
          <span class="muted">天</span>
          <el-button type="primary" :loading="running" @click="runCleanup">清理</el-button>
        </div>
        <div class="muted">目录：{{ store.settings.outputDir || '还没设置，去本地设置里选输出目录' }}</div>
      </div>

      <div v-else class="tool-body">
        <p class="muted">{{ resultText }}</p>
      </div>
      <p v-if="resultText && tool !== 'probe'" class="muted">{{ resultText }}</p>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAppStore } from '@/stores/app'
import { upgradePromptSettings } from '@/mock/data'
import { composePrompt } from '@/utils/format'

const store = useAppStore()
const router = useRouter()
const tool = ref('')
const visible = ref(false)
const running = ref(false)
const ffmpegOk = ref(false)
const files = ref([])
const ffmpegText = ref('')
const oneFile = ref('')
const preset = ref('right-bottom')
const seconds = ref(10)
const trimStart = ref('00:00:00')
const trimEnd = ref('00:00:05')
const probeText = ref('')
const resultText = ref('')
const accountId = ref('')
const chatUrl = ref('')
const remixProductId = ref('')
const publishId = ref('')
const article = ref('')
const articleLines = ref([])
const priceMax = ref(30)
const cheapSelected = ref([])
const followText = ref('')
const linkText = ref('')
const links = ref([])
const deleteStatus = ref('已发布')
const cleanDays = ref(7)

const groups = [
  {
    title: '剪辑制作',
    items: [
      { id: 'slice', title: '直播切片', desc: '把一条视频按秒数切成多段。' },
      { id: 'hook', title: '爆款素材', desc: '截取视频开头几秒，留作开口素材。' },
      { id: 'remix', title: '视频二创', desc: '把参考视频和当前提示词模板发给豆包。', hot: true },
      { id: 'ai', title: 'AI 制作', desc: '打开生成窗口，用选中的提示词模板出片。' },
      { id: 'trim', title: '本地剪辑引擎', desc: '按开始和结束时间裁一段成片。' }
    ]
  },
  {
    title: '解析提取',
    items: [
      { id: 'probe', title: '视频解析', desc: '读取本机视频的分辨率和时长。' },
      { id: 'download', title: '批量下载', desc: '把已生成的成片复制到指定文件夹。' },
      { id: 'works', title: '主页作品 2.0', desc: '打开作品列表，查看和发布已有成片。' },
      { id: 'watermark', title: '豆包去水印', desc: '去掉左上角和右下角的豆包文字。生成完成保存时自动处理。' }
    ]
  },
  {
    title: '文案素材',
    items: [
      { id: 'article', title: '文章提取', desc: '从粘贴的文章里抽出可用句子。' },
      { id: 'cheap', title: '低价视频预览', desc: '按价格筛出选品，先看再决定做不做。' },
      { id: 'cheap2', title: '低价带片 2.0', desc: '把低价选品直接送去生成。' },
      { id: 'words', title: '超级搜索词', desc: '从选品标题统计高频词。' },
      { id: 'topics', title: '话题提取器', desc: '把选品标题收成话题，方便复制。' }
    ]
  },
  {
    title: '账号与准备',
    items: [
      { id: 'follow', title: '批量关注', desc: '粘贴主页链接，用发布账号逐个打开并点关注。' },
      { id: 'links', title: '提取主页链接', desc: '从一段文字里抽出 http 链接。' },
      { id: 'delete-works', title: '批量删除作品', desc: '按状态删除本机作品记录。' },
      { id: 'commission', title: '高返佣金对照', desc: '按佣金从高到低看当前选品。', hot: true },
      { id: 'cleanup', title: '定时清理', desc: '删掉输出目录里放太久的视频和图片。' }
    ]
  }
]

const titles = Object.fromEntries(groups.flatMap((group) => group.items.map((item) => [item.id, item.title])))
const currentTitle = computed(() => titles[tool.value] || '工具')
const activeTemplateName = computed(() => {
  const list = store.settings.promptTemplates || []
  return list.find((item) => item.id === store.settings.activePromptTemplateId)?.name || '还没有模板'
})
const localWorks = computed(() => store.works.filter((item) => item.videoPath && /^[a-zA-Z]:[\\/]/.test(item.videoPath)))
const cheapRows = computed(() => store.products.filter((item) => Number(item.price) <= Number(priceMax.value || 0)))
const commissionRows = computed(() => [...store.products].sort((a, b) => (Number(b.rate) || 0) - (Number(a.rate) || 0)).slice(0, 50))
const wordRows = computed(() => {
  const bucket = new Map()
  store.products.forEach((item) => {
    const parts = String(item.title || '').split(/[\s,，。！？、【】\[\]()（）]/).map((part) => part.trim()).filter((part) => part.length >= 2 && part.length <= 12)
    parts.forEach((part) => bucket.set(part, (bucket.get(part) || 0) + 1))
  })
  const rows = [...bucket.entries()].map(([text, count]) => ({ text: tool.value === 'topics' ? `#${text}` : text, count }))
  return rows.sort((a, b) => b.count - a.count).slice(0, 40)
})

onMounted(async () => {
  upgradePromptSettings(store.settings)
  if (!window.tujian?.mediaInfo) return
  const info = await window.tujian.mediaInfo()
  ffmpegOk.value = Boolean(info?.ok)
  ffmpegText.value = info?.ok ? `本机 ffmpeg：${info.path}` : (info?.message || '没有找到 ffmpeg')
})

function desktop() {
  if (window.tujian) return true
  ElMessage.warning('请在桌面窗口里使用这个工具')
  return false
}

function openTool(id) {
  resultText.value = ''
  if (id === 'ai') {
    store.openPrompt([])
    return
  }
  if (id === 'works') {
    router.push('/works')
    return
  }
  if (id === 'remix') {
    router.push('/remix')
    return
  }
  tool.value = id
  visible.value = true
  if (!accountId.value && store.doubaoAccounts[0]) accountId.value = store.doubaoAccounts[0].id
  if (!publishId.value && store.publishAccounts[0]) publishId.value = store.publishAccounts[0].id
}

function useWorks() {
  const paths = localWorks.value.map((item) => item.videoPath)
  files.value = [...new Set(files.value.concat(paths))]
}

async function pickVideos() {
  if (!desktop() || !window.tujian.pickVideos) return
  files.value = await window.tujian.pickVideos()
}

async function pickOne() {
  if (!desktop() || !window.tujian.pickVideo) return
  oneFile.value = await window.tujian.pickVideo()
}

async function runDoubaoWatermark() {
  if (!desktop() || !window.tujian.pullCleanDoubao) return
  const works = files.value.map((file) => store.works.find((item) => item.videoPath === file)).filter(Boolean)
  if (!works.length) return ElMessage.warning('先带上已生成的成片。无水印地址只在豆包对话里，不能从本地视频上抹掉。')
  running.value = true
  const saved = []
  try {
    for (const work of works) {
      const account = store.doubaoAccounts.find((item) => item.id === work.doubaoAccountId)
        || store.doubaoAccounts.find((item) => item.name === work.doubaoAccount)
        || store.doubaoAccounts[0]
      if (!account) throw new Error('先登录生成这条视频的豆包账号')
      const result = await window.tujian.pullCleanDoubao({
        id: account.id,
        name: account.name,
        login: account.login,
        mode: account.loginMode || 'password',
        chatUrl: work.doubaoChatUrl || '',
        outputFile: work.videoPath,
        outputDir: store.settings.outputDir
      })
      if (!result?.ok) throw new Error(result?.message || `${work.title} 没有拿到无水印地址`)
      work.videoPath = result.videoPath
      if (result.doubaoChatUrl) work.doubaoChatUrl = result.doubaoChatUrl
      saved.push(result.videoPath)
    }
    files.value = saved
    store.persist()
    resultText.value = `已按豆包无水印地址重新保存 ${saved.length} 个视频`
    store.addLog('success', '去水印', resultText.value)
    ElMessage.success(resultText.value)
  } catch (error) {
    ElMessage.error(error.message || '没有拿到无水印视频')
  } finally {
    running.value = false
  }
}

async function runSlice() {
  if (!desktop()) return
  running.value = true
  try {
    const payload = { file: oneFile.value, seconds: seconds.value, dir: store.settings.outputDir }
    const result = tool.value === 'hook'
      ? await window.tujian.trimVideo({ file: oneFile.value, start: '0', end: String(seconds.value), dir: store.settings.outputDir })
      : await window.tujian.sliceVideo(payload)
    if (!result?.ok) throw new Error(result?.message || '处理失败')
    resultText.value = result.message
    store.addLog('success', '剪辑', result.message)
    ElMessage.success(result.message)
  } catch (error) {
    ElMessage.error(error.message || '处理失败')
  } finally {
    running.value = false
  }
}

async function runTrim() {
  if (!desktop()) return
  running.value = true
  try {
    const result = await window.tujian.trimVideo({ file: oneFile.value, start: trimStart.value, end: trimEnd.value, dir: store.settings.outputDir })
    if (!result?.ok) throw new Error(result?.message || '裁切失败')
    resultText.value = result.message
    ElMessage.success(result.message)
  } catch (error) {
    ElMessage.error(error.message || '裁切失败')
  } finally {
    running.value = false
  }
}

async function runProbe() {
  if (!desktop()) return
  running.value = true
  try {
    const meta = await window.tujian.probeVideo(oneFile.value)
    if (!meta) throw new Error('没有读出视频信息，请确认 ffmpeg 已安装')
    probeText.value = `${meta.width || 0} x ${meta.height || 0}\n时长 ${Math.round(meta.seconds || 0)} 秒\n\n${meta.text || ''}`
  } catch (error) {
    ElMessage.error(error.message || '解析失败')
  } finally {
    running.value = false
  }
}

async function runRemix() {
  if (!desktop() || !window.tujian.remixDoubao) return
  const account = store.doubaoAccounts.find((item) => item.id === accountId.value)
  if (!account) return ElMessage.warning('先添加豆包账号')
  upgradePromptSettings(store.settings)
  const template = (store.settings.promptTemplates || []).find((item) => item.id === store.settings.activePromptTemplateId)
  const product = store.products.find((item) => item.id === remixProductId.value)
  const prompt = composePrompt({
    promptText: template?.promptText || store.settings.promptText,
    model: template?.model || store.settings.model,
    duration: template?.duration || store.settings.duration,
    ratio: template?.ratio || store.settings.ratio
  }, product)
  if (!prompt) return ElMessage.warning('先在提示词模板里写一套文案')
  running.value = true
  try {
    const result = await window.tujian.remixDoubao({
      id: account.id,
      name: account.name,
      login: account.login,
      mode: account.loginMode || 'password',
      videoPath: oneFile.value,
      prompt,
      slot: `remix-${Date.now().toString(36)}`
    })
    resultText.value = result?.confirmNote || result?.message || ''
    if (result?.confirmNeeded && !result?.confirmSent) ElMessage.warning(resultText.value || '没有检测到确认发送')
    else ElMessage.success(resultText.value || '已发给豆包')
    store.addLog(result?.confirmNeeded && !result?.confirmSent ? 'warning' : 'info', '视频二创', `${account.name} ${resultText.value}`)
  } catch (error) {
    ElMessage.error(error.message || '二创失败')
  } finally {
    running.value = false
  }
}

async function runDownload() {
  if (!desktop() || !window.tujian.pickDirectory) return
  if (!localWorks.value.length) return ElMessage.info('还没有保存在电脑上的成片')
  const dir = await window.tujian.pickDirectory()
  if (!dir) return
  running.value = true
  try {
    const result = await window.tujian.copyFiles({ files: localWorks.value.map((item) => item.videoPath), dir })
    if (!result?.ok) throw new Error(result?.message || '没有复制成功')
    resultText.value = result.message
    ElMessage.success(result.message)
  } catch (error) {
    ElMessage.error(error.message || '复制失败')
  } finally {
    running.value = false
  }
}

function extractArticle() {
  articleLines.value = article.value.split(/\n+/).map((line) => line.trim()).filter((line) => line.length >= 8)
  if (!articleLines.value.length) ElMessage.info('没有提取到足够长的句子')
}

function onCheapSelect(rows) { cheapSelected.value = rows }

function generateCheap() {
  const ids = (cheapSelected.value.length ? cheapSelected.value : cheapRows.value).map((item) => item.id)
  if (!ids.length) return ElMessage.info('没有符合价格的商品')
  visible.value = false
  store.openPrompt(ids)
}

async function copyWords() {
  const text = wordRows.value.map((item) => item.text).join(' ')
  await navigator.clipboard.writeText(text)
  ElMessage.success('已复制')
}

async function runFollow() {
  if (!desktop() || !window.tujian.followLinks) return
  const account = store.publishAccounts.find((item) => item.id === publishId.value)
  if (!account) return ElMessage.warning('先添加发布账号')
  running.value = true
  try {
    const result = await window.tujian.followLinks({ id: account.id, name: account.name, login: account.login, urls: followText.value })
    if (!result?.ok && result?.message) throw new Error(result.message)
    resultText.value = result.message
    ElMessage.success(result.message)
    store.addLog('info', '关注', result.message)
  } catch (error) {
    ElMessage.error(error.message || '没有完成')
  } finally {
    running.value = false
  }
}

function extractLinks() {
  links.value = [...new Set(String(linkText.value).match(/https?:\/\/[^\s]+/g) || [])]
  if (!links.value.length) ElMessage.info('没有找到链接')
}

async function copyLinks() {
  await navigator.clipboard.writeText(links.value.join('\n'))
  ElMessage.success('已复制')
}

async function deleteWorks() {
  const count = store.works.filter((item) => item.status === deleteStatus.value).length
  if (!count) return ElMessage.info('没有这个状态的作品')
  try {
    await ElMessageBox.confirm(`删除 ${count} 条「${deleteStatus.value}」作品记录？成片文件不会从硬盘删掉。`, '批量删除', { type: 'warning' })
  } catch { return }
  store.works = store.works.filter((item) => item.status !== deleteStatus.value)
  store.addLog('info', '作品', `按状态删除 ${count} 条`)
  ElMessage.success(`已删除 ${count} 条`)
}

async function runCleanup() {
  if (!desktop()) return
  if (!store.settings.outputDir) return ElMessage.warning('先在本地设置里选择作品输出目录')
  running.value = true
  try {
    const result = await window.tujian.cleanupDir({ dir: store.settings.outputDir, days: cleanDays.value })
    resultText.value = result?.message || ''
    ElMessage.success(resultText.value)
    store.addLog('info', '清理', resultText.value)
  } catch (error) {
    ElMessage.error(error.message || '清理失败')
  } finally {
    running.value = false
  }
}
</script>

<style scoped>
.tool-section { margin-bottom: 18px; }
.tool-section h2 { font-size: 15px; margin: 0 0 10px; }
.tool-card h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 6px; font-size: 15px; }
.tool-body { display: flex; flex-direction: column; gap: 8px; }
.file-line { font-size: 12px; color: #475467; word-break: break-all; }
.probe { white-space: pre-wrap; background: #f8fafc; border-radius: 8px; padding: 10px; max-height: 280px; overflow: auto; }
</style>
