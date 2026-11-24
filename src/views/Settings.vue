<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>本地设置</h1>
      </div>
    </div>
    <div class="panel">
      <el-tabs v-model="tab">
        <el-tab-pane label="发布" name="publish" />
        <el-tab-pane label="豆包" name="doubao" />
        <el-tab-pane label="违禁词" name="banned" />
        <el-tab-pane label="浏览器" name="browser" />
        <el-tab-pane label="通知" name="notice" />
        <el-tab-pane label="局域网" name="lan" />
        <el-tab-pane label="存储" name="storage" />
      </el-tabs>
      <div v-show="tab === 'banned'" class="publish-sheet">
        <h3>标题违禁词</h3>
        <p class="muted">入库、同步、按 ID 导入时会自动从标题里去掉这些词。一行一个，可增删。留空时仍使用内置默认词库，下面自定义词会叠加进去。</p>
        <el-input
          v-model="bannedText"
          type="textarea"
          :rows="14"
          placeholder="例如：&#10;第一&#10;最便宜&#10;包治"
        />
        <div style="margin-top: 10px; display: flex; gap: 8px">
          <el-button @click="restoreBanned">恢复默认词库到编辑框</el-button>
          <el-button type="primary" @click="saveBanned">保存违禁词</el-button>
        </div>
      </div>
      <div v-show="tab === 'publish'" class="publish-sheet">
        <h3>发布成功后</h3>
        <p class="muted">这些勾选会直接进抖音上传流程：等上传完成再点发布，并按选项写标题、标签、挂车、声明和私密。</p>
        <el-checkbox v-model="publishPage.deleteSources">发布成功后删除本机原片文件（不勾选则「我的作品」仍可预览）</el-checkbox>
        <h3>领取过滤</h3>
        <p class="muted">勾选的类型才会进入自动发布队列和「启动发布队列」。</p>
        <el-checkbox v-model="publishPage.claimMix">混剪</el-checkbox>
        <el-checkbox v-model="publishPage.claimLive">直播切片</el-checkbox>
        <el-checkbox v-model="publishPage.claimDoubao">豆包AI生成</el-checkbox>
        <h3>抖音发布页</h3>
        <el-checkbox v-model="publishPage.dyTitle">根据商品标题填写作品标题</el-checkbox>
        <el-checkbox v-model="publishPage.dyFakeTitle">标题做短句润色（推荐开）</el-checkbox>
        <el-checkbox v-model="publishPage.dyTags">根据商品标题选择话题</el-checkbox>
        <el-checkbox v-model="publishPage.dyCart">挂商品链接</el-checkbox>
        <el-checkbox v-model="publishPage.dyDeclare">AI 自主声明</el-checkbox>
        <el-checkbox v-model="publishPage.dySchedule">抖音平台定时</el-checkbox>
        <el-input-number v-model="publishPage.dyDelay" :min="0" :max="30" />
        <span class="num-hint">延迟天数，例如 8</span>
        <el-checkbox v-model="publishPage.dyPrivate">发布为私密</el-checkbox>
        <el-checkbox v-model="publishPage.dyManage">发布成功后内容管理</el-checkbox>
        <p class="muted">挂商品需要商品有链接。定时发布会点「定时发布」，具体日历控件若页面改版可能要你在窗口里补点一次。</p>
        <h3>本机 RPA 流程</h3>
        <p class="muted">本机流程可在 RPA 页管理。定时发布会打开抖音上传页自动填标题、标签并点发布。</p>
        <el-button type="primary" @click="router.push('/rpa')">管理本机流程</el-button>
      </div>
      <div v-show="tab === 'doubao'" class="rule-sheet">
        <h3>会话流程</h3>
        <p class="muted">豆包说出左边这句话时，按右边的动作回复。命中「要不要」会发「马上生成视频」。</p>
        <div v-for="(row, index) in replyRules.first" :key="`first-${index}`" class="rule-row">
          <el-checkbox v-model="row.enabled" />
          <el-input v-model="row.match" />
          <el-select v-model="row.action" style="width: 110px">
            <el-option label="发文字" value="text" />
            <el-option label="先点按钮" value="click" />
          </el-select>
          <el-input v-model="row.reply" />
          <el-button @click="moveRow(replyRules.first, index, -1)">上移</el-button>
          <el-button @click="moveRow(replyRules.first, index, 1)">下移</el-button>
          <el-button @click="replyRules.first.splice(index, 1)">删除</el-button>
        </div>
        <el-button @click="replyRules.first.push({ enabled: true, match: '', action: 'text', reply: '确认生成视频', buttonLabel: '' })">加一条回复</el-button>
        <h3>二次确认</h3>
        <div v-for="(row, index) in replyRules.follow" :key="`follow-${index}`" class="rule-row">
          <el-checkbox v-model="row.enabled" />
          <el-input v-model="row.match" />
          <el-input v-model="row.reply" />
          <el-button @click="moveRow(replyRules.follow, index, -1)">上移</el-button>
          <el-button @click="moveRow(replyRules.follow, index, 1)">下移</el-button>
          <el-button @click="replyRules.follow.splice(index, 1)">删除</el-button>
        </div>
        <h3>催一句</h3>
        <div class="filters">
          <el-input v-for="(_item, index) in replyRules.nudge" :key="`nudge-${index}`" v-model="replyRules.nudge[index]" style="width: 180px" />
        </div>
        <h3>版权/排队时自动重发</h3>
        <p class="muted">出现版权限制或「排队中无法并行」时，同一条任务会自动再发几次，不立刻判失败。</p>
        <div v-for="(row, index) in (failRules.retryCopyright || [])" :key="`retry-c-${index}`" class="rule-row">
          <el-checkbox v-model="row.enabled" />
          <el-input v-model="row.match" />
          <el-button @click="failRules.retryCopyright.splice(index, 1)">删除</el-button>
        </div>
        <div v-for="(row, index) in (failRules.retryBusy || [])" :key="`retry-b-${index}`" class="rule-row">
          <el-checkbox v-model="row.enabled" />
          <el-input v-model="row.match" />
          <el-button @click="failRules.retryBusy.splice(index, 1)">删除</el-button>
        </div>
        <h3>直接失败</h3>
        <p class="muted">豆包回复里出现这些话，立刻停止这条生成，不再把带水印画面存下来。</p>
        <div v-for="(row, index) in failRules.immediate" :key="`fail-${index}`" class="rule-row">
          <el-checkbox v-model="row.enabled" />
          <el-input v-model="row.match" />
          <el-button @click="moveRow(failRules.immediate, index, -1)">上移</el-button>
          <el-button @click="moveRow(failRules.immediate, index, 1)">下移</el-button>
          <el-button @click="failRules.immediate.splice(index, 1)">删除</el-button>
        </div>
        <el-button @click="failRules.immediate.push({ enabled: true, match: '', rollbackQuota: true })">加一条立刻失败</el-button>
        <div class="filters" style="margin-top: 12px">
          <el-button type="primary" @click="save">保存</el-button>
          <el-button @click="restoreRules">恢复默认</el-button>
        </div>
      </div>
      <el-form label-width="140px" style="max-width: 760px">
        <el-form-item v-show="tab === 'storage'" label="成片保存位置">
          <div class="filters" style="width: 100%">
            <el-input v-model="store.settings.outputDir" placeholder="豆包生成完的视频自动存到这里，不选就存到视频文件夹" />
            <el-button @click="chooseDir">选择目录</el-button>
          </div>
        </el-form-item>
        <el-form-item v-show="tab === 'doubao'" label="默认模型">
          <el-select v-model="store.settings.model" style="width: 100%">
            <el-option label="Seedance 2.0 Mini" value="Seedance 2.0 Mini" />
            <el-option label="Seedance 2.0" value="Seedance 2.0" />
          </el-select>
        </el-form-item>
        <el-form-item v-show="tab === 'doubao'" label="默认时长">
          <el-input
            :model-value="store.settings.duration ?? ''"
            placeholder="例如 10"
            style="width: 220px"
            @update:model-value="setDuration"
          />
          <span class="num-hint">填秒数，例如 10</span>
        </el-form-item>
        <el-form-item v-show="tab === 'doubao'" label="默认比例">
          <el-select v-model="store.settings.ratio" style="width: 220px">
            <el-option label="9:16 竖屏" value="9:16" />
            <el-option label="3:4" value="3:4" />
            <el-option label="1:1" value="1:1" />
          </el-select>
        </el-form-item>
        <el-form-item v-show="tab === 'doubao'" label="默认声音">
          <el-select v-model="store.settings.voice" style="width: 220px">
            <el-option label="自然悦耳女声" value="自然悦耳女声" />
            <el-option label="温和女声" value="温和女声" />
            <el-option label="清亮男声" value="清亮男声" />
          </el-select>
        </el-form-item>
        <el-form-item v-show="tab === 'publish'" label="发布同时打开">
          <el-input-number v-model="store.settings.publishOpen" :min="1" :max="10" />
          <span class="num-hint">例如 2，同时打开发布窗口的个数</span>
        </el-form-item>
        <el-form-item v-show="tab === 'publish'" label="发布启动间隔">
          <el-input-number v-model="store.settings.publishGap" :min="0" :max="120" />
          <span class="num-hint">例如 8，单位是秒</span>
        </el-form-item>
        <el-form-item v-show="tab === 'publish'" label="广场同步页数">
          <div class="filters" style="width: 100%">
            <el-input v-model="store.settings.plazaPageLimit" placeholder="例如 5，留空不限制" style="width: 220px" />
            <span class="num-hint">填页数，例如 5</span>
            <span class="muted">点一次同步，拉到一页就先显示。留空一直拉到没有下一页</span>
          </div>
        </el-form-item>
        <el-form-item v-show="tab === 'doubao'" label="商品图">
          <span class="muted">生成时会把这件商品保存的图片全部发给豆包，不再只发一张。</span>
        </el-form-item>
        <el-form-item v-show="tab === 'doubao'" label="豆包同时打开">
          <el-input-number v-model="store.settings.doubaoOpen" :min="1" :max="10" />
          <span class="num-hint">例如 3，同时开几个豆包窗口</span>
        </el-form-item>
        <el-form-item v-show="tab === 'doubao'" label="豆包启动间隔">
          <el-input-number v-model="store.settings.doubaoGap" :min="0" :max="60" />
          <span class="num-hint">例如 5，单位是秒</span>
        </el-form-item>
        <el-form-item v-show="tab === 'doubao'" label="自动过验证">
          <el-switch v-model="captcha.enabled" />
          <span class="muted">遇到拖拽/点选/滑块/算术验证弹窗时自动处理，不用填云码</span>
        </el-form-item>
        <p v-show="tab === 'doubao'" class="muted" style="margin: 0 0 12px">
          默认本地识别拖拽图并自动提交。失败时会把豆包窗口置前，你拖一下后软件继续跑。
        </p>
        <el-form-item v-show="tab === 'publish'" label="每日采集限额">
          <el-input-number v-model="store.settings.dailyCollectLimit" :min="1" :max="500" />
          <span class="num-hint">例如 40，一天最多采集多少件</span>
        </el-form-item>
        <el-form-item v-show="tab === 'browser'" label="窗口宽度">
          <el-input-number v-model="store.settings.windowWidth" :min="1180" :max="2560" />
          <span class="num-hint">例如 1440，保存后立刻改主窗口</span>
        </el-form-item>
        <el-form-item v-show="tab === 'browser'" label="窗口高度">
          <el-input-number v-model="store.settings.windowHeight" :min="720" :max="1600" />
          <span class="num-hint">例如 900</span>
        </el-form-item>
        <el-form-item v-show="tab === 'browser'" label="内置浏览器">
          <span class="muted">本软件用 Electron 自带 Chromium，不需要再下载单独 Chrome 内核。版本见浏览器环境页。</span>
        </el-form-item>
        <el-form-item v-show="tab === 'notice'" label="Webhook">
          <el-input v-model="store.settings.webhookUrl" placeholder="例如 https://open.feishu.cn/open-apis/bot/v2/hook/xxxx" />
          <el-button @click="testWebhook">测试发送</el-button>
          <span class="muted">生成成功、发布成功会自动 POST 这条地址</span>
        </el-form-item>
        <el-form-item v-show="tab === 'lan'" label="本机接口">
          <span class="num-hint">http://127.0.0.1:17321</span>
          <el-button @click="copyLan">复制</el-button>
          <el-button @click="openLan">浏览器打开</el-button>
          <span class="muted">作品和设置都写在这个本机接口里，局域网其他设备可用这个地址访问接口。</span>
        </el-form-item>
        <el-form-item v-show="tab === 'storage'" label="数据目录">
          <el-button @click="openUserData">打开数据目录</el-button>
          <el-button @click="openOutput">打开成片目录</el-button>
          <el-button @click="openLog">打开日志</el-button>
        </el-form-item>
        <el-form-item v-show="tab === 'publish'" label="运营分组">
          <div class="filters">
            <el-tag v-for="item in store.groups" :key="item" closable @close="store.removeGroup(item)">{{ item }}</el-tag>
            <el-button size="small" @click="createGroup">新建分组</el-button>
          </div>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="save">保存设置</el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { pickDirectory } from '@/services/bridge'
import { defaultFailRules, defaultReplyRules, ensureDoubaoRules } from '@/utils/doubaoRules'
import { defaultBannedWords } from '@/utils/banned'

const store = useAppStore()
const router = useRouter()
const tab = ref('publish')
ensureDoubaoRules(store.settings)
const replyRules = store.settings.doubaoReply
const failRules = store.settings.doubaoFail
if (!Array.isArray(store.settings.bannedWords) || !store.settings.bannedWords.length) {
  store.settings.bannedWords = defaultBannedWords()
}
const bannedText = ref((store.settings.bannedWords || []).join('\n'))
if (store.settings.windowWidth == null) store.settings.windowWidth = 1200
if (store.settings.windowHeight == null) store.settings.windowHeight = 860
if (store.settings.webhookUrl == null) store.settings.webhookUrl = ''
if (!store.settings.captchaSolver) {
  store.settings.captchaSolver = {
    enabled: true,
    token: '',
    type: '88888',
    types: { click: '88888', slider: '20111', text: '10110', math: '50100' },
    url: 'https://api.jfbym.com/api/YmServer/customApi',
    maxRetries: 4,
    fallbackHuman: true,
    humanTimeoutSec: 180,
    watchSec: 10
  }
}
const captcha = store.settings.captchaSolver
if (captcha.enabled == null) captcha.enabled = true
if (!captcha.types) {
  captcha.types = { click: captcha.type || '88888', slider: '20111', text: '10110', math: '50100' }
}
if (captcha.type && !captcha.types.click) captcha.types.click = captcha.type
captcha.type = captcha.types.click
if (!store.settings.publishPage) {
  store.settings.publishPage = {
    deleteSources: false,
    claimMix: false,
    claimLive: false,
    claimDoubao: true,
    dyTitle: true,
    dyFakeTitle: true,
    dyTags: true,
    dyCart: true,
    dyDeclare: true,
    dySchedule: false,
    dyDelay: 8,
    dyPrivate: false,
    dyManage: false,
    jdTitle: true,
    jdGoods: true,
    jdTopic: false,
    jdDeclare: true,
    jdSchedule: false,
    jdDelay: 8,
    ksTitle: true,
    ksGoods: true,
    ksDeclare: true,
    ksSchedule: false,
    xhsTitle: true,
    xhsGoods: false,
    xhsDeclare: true,
    xhsSchedule: false
  }
}
const publishPage = store.settings.publishPage
// 旧配置默认关了写标题，导致抖音页空白；纠正为开启
if (publishPage.dyTitle === false && publishPage.dyFakeTitle === false) {
  publishPage.dyTitle = true
  publishPage.dyFakeTitle = true
}
// 旧默认会删原片导致作品页「暂无成片」；改为默认保留
if (publishPage.deleteSources === true && publishPage._keepVideoMigrated !== true) {
  publishPage.deleteSources = false
  publishPage._keepVideoMigrated = true
}

function setDuration(value) {
  const text = String(value ?? '').trim()
  store.settings.durationTouched = true
  if (!text) {
    store.settings.duration = null
    return
  }
  const seconds = Math.round(Number(text))
  store.settings.duration = seconds > 0 ? Math.min(seconds, 120) : null
}

async function chooseDir() {
  const dir = await pickDirectory()
  if (dir) {
    store.settings.outputDir = dir
    store.persist()
    return
  }
  if (!window.tujian) ElMessage.info('浏览器预览里直接把目录写在输入框。桌面版会弹出选择框。')
}

async function testWebhook() {
  const url = String(store.settings.webhookUrl || '').trim()
  if (!/^https?:\/\//.test(url)) return ElMessage.warning('先填写 http 或 https 地址')
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'huang++pro 通知测试' })
    })
    if (!response.ok) throw new Error(`对方返回 ${response.status}`)
    ElMessage.success('测试已发出')
  } catch (error) {
    ElMessage.error(error.message || '测试没有发出')
  }
}

function moveRow(list, index, step) {
  const next = index + step
  if (next < 0 || next >= list.length) return
  const [item] = list.splice(index, 1)
  list.splice(next, 0, item)
}

function restoreRules() {
  const nextReply = defaultReplyRules()
  const nextFail = defaultFailRules()
  replyRules.first.splice(0, replyRules.first.length, ...nextReply.first)
  replyRules.follow.splice(0, replyRules.follow.length, ...nextReply.follow)
  replyRules.nudge.splice(0, replyRules.nudge.length, ...nextReply.nudge)
  failRules.immediate.splice(0, failRules.immediate.length, ...nextFail.immediate)
  if (!Array.isArray(failRules.weak)) failRules.weak = []
  failRules.weak.splice(0, failRules.weak.length, ...(nextFail.weak || []))
  if (!Array.isArray(failRules.retryCopyright)) failRules.retryCopyright = []
  failRules.retryCopyright.splice(0, failRules.retryCopyright.length, ...(nextFail.retryCopyright || []))
  if (!Array.isArray(failRules.retryBusy)) failRules.retryBusy = []
  failRules.retryBusy.splice(0, failRules.retryBusy.length, ...(nextFail.retryBusy || []))
  store.persist()
  ElMessage.success('已恢复默认话术')
}

async function copyLan() {
  try {
    await navigator.clipboard.writeText('http://127.0.0.1:17321')
    ElMessage.success('已复制本机接口')
  } catch {
    ElMessage.info('http://127.0.0.1:17321')
  }
}

async function openLan() {
  if (!window.tujian?.openPath) return ElMessage.info('请在桌面窗口里打开')
  await window.tujian.openPath('http://127.0.0.1:17321')
}

async function openUserData() {
  const info = await window.tujian?.getInfo?.()
  if (!info?.userData) return ElMessage.warning('请在桌面窗口里打开')
  const result = await window.tujian.openPath(info.userData)
  if (result?.ok === false) ElMessage.error(result.message || '打不开数据目录')
}

async function openOutput() {
  const dir = store.settings.outputDir || (await window.tujian?.getInfo?.())?.videos
  if (!dir || !window.tujian?.openPath) return ElMessage.warning('先设置成片保存位置，或在桌面窗口里打开')
  const result = await window.tujian.openPath(dir)
  if (result?.ok === false) ElMessage.error(result.message || '打不开成片目录')
}

async function openLog() {
  if (!window.tujian?.openLogFile) return ElMessage.warning('请在桌面窗口里打开')
  await window.tujian.openLogFile()
}

function restoreBanned() {
  bannedText.value = defaultBannedWords().join('\n')
}

function saveBanned() {
  store.settings.bannedWords = bannedText.value
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
  bannedText.value = store.settings.bannedWords.join('\n')
  store.persist()
  ElMessage.success(`已保存 ${store.settings.bannedWords.length} 个违禁词`)
}

async function save() {
  try {
    if (captcha.types?.click) captcha.type = captcha.types.click
    store.settings.bannedWords = bannedText.value
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean)
    store.applyWindowSize()
    await store.flush()
    store.addLog('info', '设置', '本地设置已保存')
    ElMessage.success('已保存')
  } catch (error) {
    ElMessage.error(error.message || '保存失败')
  }
}

async function createGroup() {
  try {
    const { value } = await ElMessageBox.prompt('分组名称', '新建分组')
    store.addGroup(value)
  } catch { /* 取消 */ }
}
</script>

<style scoped>
.publish-sheet { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; max-width: 920px; margin-bottom: 18px; }
.publish-sheet h3, .rule-sheet h3 { margin: 10px 0 0; font-size: 15px; }
.rule-sheet { display: flex; flex-direction: column; gap: 8px; }
.rule-row { display: grid; grid-template-columns: 24px minmax(160px, 1fr) 110px minmax(140px, 1fr) auto auto auto; gap: 8px; align-items: center; }
</style>
