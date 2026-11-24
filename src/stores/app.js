import { defineStore } from 'pinia'
import { createSeed, defaultPromptSettings, upgradePromptSettings } from '@/mock/data'
import { composePrompt, formatTime, uid, fillTemplate, publishTitleFromGoods, topicsFromGoods } from '@/utils/format'
import { cleanTitle, defaultBannedWords, sanitizeProductTitle } from '@/utils/banned'
import { ensureDoubaoRules } from '@/utils/doubaoRules'
import { api, getToken, setToken } from '@/services/api'
import { couponTags, goodsCategory, goodsTags, isFreeShipping } from '@/utils/goods'

function toPlain(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? null))
  } catch {
    return null
  }
}

function plainGeneratePayload({ account, prompt, shots, slot, saveDir, workId, captcha, replyRules, failMarkers, retryMarkers }) {
  const types = captcha?.types || {}
  const reply = replyRules || {}
  const mapRules = (list) => (Array.isArray(list) ? list : []).map((item) => ({
    enabled: item?.enabled !== false,
    match: String(item?.match || ''),
    action: String(item?.action || 'text'),
    reply: String(item?.reply || ''),
    buttonLabel: String(item?.buttonLabel || '')
  }))
  return {
    id: String(account?.id || ''),
    name: String(account?.name || ''),
    login: String(account?.login || ''),
    mode: String(account?.loginMode || 'password'),
    prompt: String(prompt || ''),
    image: String(shots?.[0] || ''),
    images: (shots || []).map((item) => String(item || '')).filter(Boolean),
    slot: String(slot || 'gen'),
    imageCount: 0,
    saveDir: String(saveDir || ''),
    workId: String(workId || ''),
    captcha: {
      enabled: Boolean(captcha?.enabled && String(captcha?.token || '').trim()),
      token: String(captcha?.token || ''),
      type: String(captcha?.type || types.click || '88888'),
      types: {
        click: String(types.click || '88888'),
        slider: String(types.slider || '20111'),
        text: String(types.text || '10110'),
        math: String(types.math || '50100')
      },
      url: String(captcha?.url || 'https://api.jfbym.com/api/YmServer/customApi'),
      maxRetries: Math.max(1, Math.min(5, Number(captcha?.maxRetries) || 3)),
      fallbackHuman: captcha?.fallbackHuman !== false,
      humanTimeoutSec: Math.max(30, Number(captcha?.humanTimeoutSec) || 180),
      watchSec: Math.max(2, Number(captcha?.watchSec) || 8)
    },
    failMarkers: (failMarkers || []).map((item) => String(item || '')).filter(Boolean),
    retryMarkers: {
      copyright: (retryMarkers?.copyright || []).map((item) => String(item || '')).filter(Boolean),
      busy: (retryMarkers?.busy || []).map((item) => String(item || '')).filter(Boolean)
    },
    replyRules: {
      first: mapRules(reply.first),
      follow: mapRules(reply.follow),
      nudge: (Array.isArray(reply.nudge) ? reply.nudge : []).map((item) => String(item || '')).filter(Boolean)
    }
  }
}

const cancelledWorks = new Set()
let taskSeq = 0

export const PERSIST_KEYS = [
  'points', 'publishNo', 'groups', 'activeAccountId', 'products', 'plaza', 'works',
  'doubaoAccounts', 'digitalHumans', 'publishAccounts', 'collectAccounts',
  'schedules', 'rpaFlows', 'proxies', 'browsers', 'logs', 'doubaoChats', 'settings'
]

let saveTimer = null
const busyDoubao = new Set()
let generateActive = 0
const generatePending = []
let nextDoubaoLaunch = 0

function quotaLimit(account) {
  if (Number(account?.quotaLimit) > 0) return Number(account.quotaLimit)
  const matched = String(account?.quota || '').match(/\/(\d+)/)
  if (matched) return Math.max(1, Number(matched[1]))
  const plain = Number(account?.quota)
  if (plain > 0 && plain <= 100) return plain
  return 5
}

export const useAppStore = defineStore('app', {
  state: () => ({
    ready: false,
    queueOpen: false,
    helpOpen: false,
    serviceOpen: false,
    doneNotice: '',
    promptVisible: false,
    promptProductIds: [],
    apiError: '',
    user: null,
    displayName: '',
    userStatus: '正常',
    adminAccounts: [],
    adminMode: false,
    systemNow: '',
    runtimeTasks: [],
    ...createSeed()
  }),
  getters: {
    unpublishedCount: (state) => state.works.filter((item) => ['待生成', '已生成', '审核通过', '发布中'].includes(item.status)).length,
    queueWorks: (state) => state.works.filter((item) => ['生成中', '待生成', '发布中'].includes(item.status)),
    activeRuntimeTasks: (state) => state.runtimeTasks.filter((item) => item.status === 'running'),
    onlinePublishCount: (state) => state.publishAccounts.filter((item) => item.enabled).length,
    licenseActive: (state) => {
      const license = state.license
      if (!license || !state.systemNow) return false
      if (license.permanent) return true
      return Boolean(license.expiresAt) && new Date(license.expiresAt).getTime() > new Date(state.systemNow).getTime()
    }
  },
  actions: {
    applyServer(data) {
      const snapshot = data.snapshot || {}
      for (const key of PERSIST_KEYS) {
        if (snapshot[key] !== undefined) this[key] = snapshot[key]
      }
      this.settings = upgradePromptSettings({ ...defaultPromptSettings(), ...(snapshot.settings || {}) })
      ensureDoubaoRules(this.settings)
      if (!this.settings.captchaSolver) {
        this.settings.captchaSolver = {
          enabled: false,
          token: '',
          type: '88888',
          types: { click: '88888', slider: '20111', text: '10110', math: '50100' },
          url: 'https://api.jfbym.com/api/YmServer/customApi',
          maxRetries: 3,
          fallbackHuman: true,
          humanTimeoutSec: 180,
          watchSec: 8
        }
      } else if (!this.settings.captchaSolver.types) {
        this.settings.captchaSolver.types = {
          click: this.settings.captchaSolver.type || '88888',
          slider: '20111',
          text: '10110',
          math: '50100'
        }
      }
      this.license = data.license || null
      if (data.userStatus) this.userStatus = data.userStatus
      if (data.displayName != null) this.displayName = data.displayName
      if (data.systemNow) this.systemNow = data.systemNow
      this.syncDoubaoStats()
      if (Array.isArray(data.generatedLicenses)) this.generatedLicenses = data.generatedLicenses
      if (!this.activeAccountId && this.publishAccounts[0]) this.activeAccountId = this.publishAccounts[0].id
      const plazaById = new Map()
      if (!Array.isArray(this.settings.bannedWords) || !this.settings.bannedWords.length) {
        this.settings.bannedWords = defaultBannedWords()
      }
      this.plaza.forEach((item) => {
        const cleaned = cleanTitle(item?.title, this.settings.bannedWords)
        if (cleaned.changed) {
          item.rawTitle = item.rawTitle || item.title
          item.title = cleaned.title
          item.bannedHits = cleaned.hits
        }
        if (item?.id && (item.image || item.images?.length)) plazaById.set(`${item.accountId || ''}:${item.id}`, item)
        if (item?.id && !plazaById.has(item.id) && (item.image || item.images?.length)) plazaById.set(item.id, item)
      })
      this.products.forEach((row) => {
        const cleaned = cleanTitle(row.title, this.settings.bannedWords)
        if (cleaned.changed) {
          row.rawTitle = row.rawTitle || row.title
          row.title = cleaned.title
          row.bannedHits = cleaned.hits
        }
        const found = plazaById.get(`${row.accountId || ''}:${row.id}`) || plazaById.get(row.id)
        if (!found) return
        if (!row.imagesEdited) {
          if (!row.image) row.image = found.image || found.images?.[0] || ''
          if (found.images?.length && !row.images?.length) row.images = found.images.filter((src) => !(row.removedImages || []).includes(src))
        }
        if (found.tags?.length && !row.tags?.length) row.tags = found.tags
        if (found.freeShipping && !row.freeShipping) row.freeShipping = true
      })
      this.syncProxy()
      this.applyWindowSize()
    },
    applyWindowSize() {
      if (!window.tujian?.resizeAppWindow) return
      const width = Number(this.settings.windowWidth) || 1440
      const height = Number(this.settings.windowHeight) || 900
      window.tujian.resizeAppWindow({ width, height }).catch(() => {})
    },
    notifyWebhook(text) {
      const url = String(this.settings.webhookUrl || '').trim()
      if (!/^https?:\/\//.test(url) || !text) return
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          msg_type: 'text',
          content: { text },
          msgtype: 'text',
          markdown: { content: text }
        })
      }).catch((error) => {
        this.addLog('warning', '通知', `Webhook 没有发出：${error.message || '请求失败'}`)
      })
    },
    workMatchesClaim(work) {
      const page = this.settings.publishPage || {}
      const kind = work?.kind || (work?.model ? 'AI' : 'AI')
      if (kind === '混剪') return Boolean(page.claimMix)
      if (kind === '直播切片') return Boolean(page.claimLive)
      // 默认豆包 AI 成片可领取；只有明确关掉才排除
      return page.claimDoubao !== false
    },
    // 定时/队列可发：已审核，或上次只打开了上传页卡在「发布中」的成片
    isPublishReady(work) {
      if (!work?.videoPath) return false
      if (!['审核通过', '发布中'].includes(work.status)) return false
      return this.workMatchesClaim(work)
    },
    explainNoPublishReady() {
      const withVideo = this.works.filter((item) => item.videoPath)
      const approved = withVideo.filter((item) => item.status === '审核通过').length
      const publishing = withVideo.filter((item) => item.status === '发布中').length
      const pending = withVideo.filter((item) => item.status === '已生成').length
      const claimedOut = withVideo.filter((item) => ['审核通过', '发布中'].includes(item.status) && !this.workMatchesClaim(item)).length
      if (pending) return `还有 ${pending} 条「待审核」，请到单片工作台或我的作品点审核通过`
      if (claimedOut) return `有 ${claimedOut} 条已审核，但被设置里的「领取过滤」排除了（检查豆包AI生成是否勾选）`
      if (approved || publishing) return `有可发成片，请再点一次立即执行`
      return '没有审核通过的成片。请到「我的作品」把「待审核」点审核通过，或打开「单片工作台」审核'
    },
    fakeTitle(title, product) {
      return publishTitleFromGoods(title, product)
    },
    beginTask( partial = {}) {
      const id = `RT-${Date.now()}-${taskSeq += 1}`
      const row = {
        id,
        kind: partial.kind || '任务',
        title: partial.title || '未命名任务',
        workId: partial.workId || '',
        accountId: partial.accountId || '',
        windowKey: partial.windowKey || '',
        status: 'running',
        note: partial.note || '执行中',
        startedAt: formatTime(new Date())
      }
      this.runtimeTasks.unshift(row)
      if (this.runtimeTasks.length > 80) this.runtimeTasks.length = 80
      return id
    },
    endTask(taskId, note = '', status = 'done') {
      const row = this.runtimeTasks.find((item) => item.id === taskId)
      if (!row) return
      row.status = status
      row.note = note || (status === 'cancelled' ? '已结束' : '已完成')
      row.finishedAt = formatTime(new Date())
    },
    isWorkCancelled(workId) {
      return cancelledWorks.has(String(workId || ''))
    },
    async cancelRuntimeTask(taskId) {
      const row = this.runtimeTasks.find((item) => item.id === taskId)
      if (!row || row.status !== 'running') return '这个任务已经不在执行'
      if (row.workId) cancelledWorks.add(String(row.workId))
      if (row.accountId) busyDoubao.delete(row.accountId)
      const work = this.works.find((item) => item.id === row.workId)
      if (work && (work.status === '生成中' || work.status === '发布中')) {
        work.status = row.kind === '发布' ? '审核通过' : '待生成'
        work.failReason = '已在任务中心手动结束'
        work.progress = 0
      }
      try {
        if (row.windowKey && window.tujian?.closeSession) {
          await window.tujian.closeSession(row.windowKey)
        } else if (row.accountId && window.tujian?.closeSessionPrefix) {
          const prefix = row.kind === '发布' ? `publish:${row.accountId}` : `doubao:${row.accountId}`
          await window.tujian.closeSessionPrefix(prefix)
        }
      } catch { /* 窗口可能已关 */ }
      this.endTask(taskId, '已在任务中心手动结束', 'cancelled')
      this.addLog('warning', '任务', `已结束：${row.title}（${row.kind}）`)
      this.persist()
      return `已结束「${row.title}」`
    },
    async cancelAllRuntimeTasks() {
      const running = this.runtimeTasks.filter((item) => item.status === 'running')
      for (const row of running) {
        await this.cancelRuntimeTask(row.id)
      }
      return running.length
    },
    buildPublishPayload(item, account) {
      const page = this.settings.publishPage || {}
      const product = this.products.find((row) => row.id === item.productId)
        || this.plaza.find((row) => row.id === item.productId)
        || null
      // 根据商品标题智能生成作品短标题；设置里两项都关才跳过
      const wantTitle = !(page.dyTitle === false && page.dyFakeTitle === false)
      const goodsTitle = String(product?.title || item.title || '').trim()
      const title = wantTitle
        ? publishTitleFromGoods(goodsTitle, product || { title: goodsTitle, category: product?.category || item.category, shop: product?.shop || item.shop })
        : ''
      // 兜底：生成结果为空时仍给一个可填短标题，避免发布页标题空白
      const publishTitle = String(title || '').trim() || (wantTitle ? publishTitleFromGoods(goodsTitle || '今日好物分享', { title: goodsTitle || '今日好物分享' }) : '')
      const productLink = String(product?.link || product?.goodsUrl || item.productLink || '').trim()
      // 有商品链接时默认挂购物车；设置里关掉 dyCart 才跳过
      const wantCart = page.dyCart !== false && Boolean(productLink)
      const tags = page.dyTags === false
        ? []
        : topicsFromGoods(goodsTitle || item.title, product || { title: goodsTitle || item.title })
          .map((tag) => String(tag || '').replace(/^#/, '').trim())
          .filter((tag) => tag && tag.length <= 12 && !/^https?:/i.test(tag) && !/haohuo|jinritemai/i.test(tag))
      return {
        id: String(account.id || ''),
        name: String(account.name || ''),
        login: String(account.login || ''),
        mode: String(account.loginMode || 'password'),
        videoPath: String(item.videoPath || ''),
        title: String(publishTitle || ''),
        tags,
        productLink,
        options: {
          dyTitle: true,
          dyFakeTitle: true,
          dyTags: page.dyTags !== false,
          dyCart: wantCart,
          dyDeclare: page.dyDeclare !== false,
          dySchedule: Boolean(page.dySchedule),
          dyDelay: Number(page.dyDelay) || 0,
          dyPrivate: Boolean(page.dyPrivate),
          deleteSources: page.deleteSources === true
        },
        workId: String(item.id || '')
      }
    },
    async publishWorksBatch(works, account) {
      if (!account || !window.tujian?.publishWork) return 0
      const limit = Math.max(1, Math.min(10, Number(this.settings.publishOpen) || 1))
      const batch = works.slice(0, limit)
      const gap = Math.max(0, Number(this.settings.publishGap) || 0)
      let posted = 0
      for (let index = 0; index < batch.length; index += 1) {
        const item = batch[index]
        if (this.isWorkCancelled(item.id)) {
          this.addLog('warning', '发布', `${item.title}：任务已取消，跳过`)
          continue
        }
        if (index > 0 && gap) await new Promise((resolve) => setTimeout(resolve, gap * 1000))
        const payload = this.buildPublishPayload(item, account)
        item.publishTitle = payload.title
        item.publishTags = payload.tags
        item.status = '发布中'
        item.publishAccount = account.name
        item.publishAccountId = account.id
        const tagHint = Array.isArray(payload.tags) && payload.tags.length
          ? '，话题 ' + payload.tags.map((t) => '#' + t).join(' ')
          : ''
        this.addLog('info', '发布', item.title + '：将填写作品标题「' + (payload.title || '空') + '」' + tagHint)
        const taskId = this.beginTask({
          kind: '发布',
          title: item.title,
          workId: item.id,
          accountId: account.id,
          note: payload.title ? ('填写标题：' + payload.title) : '正在打开发布页'
        })
        this.persist()
        try {
          const result = await window.tujian.publishWork(payload)
          if (this.isWorkCancelled(item.id)) {
            this.endTask(taskId, '已取消', 'cancelled')
            continue
          }
          if (result?.loginStatus) account.loginStatus = result.loginStatus
          if (!result?.ok || !result.attached) {
            item.status = '审核通过'
            this.endTask(taskId, result?.message || '没有放进上传页', 'failed')
            this.addLog('warning', '发布', `${item.title}：${result?.message || '没有放进上传页'}`)
            continue
          }
          posted += 1
          if (result.published) {
            item.status = '已发布'
            item.finishedAt = formatTime(new Date())
            // 即使勾了删原片，也保留 videoPath，避免「我的作品」变成暂无成片
            if (result.deleted) item.sourceDeleted = true
            this.notifyWebhook(`【huang++pro】已发布：${item.title}`)
          } else {
            // 只打开了上传页、未点到「发布」→ 仍算已审核，方便定时再发
            item.status = '审核通过'
          }
          this.endTask(taskId, result.message || '发布流程已走完')
          this.addLog(result.published ? 'success' : 'warning', '发布', result.message || `${item.title} 已打开上传页`)
        } catch (error) {
          item.status = '审核通过'
          const message = /could not be cloned|An object could not be cloned/i.test(String(error?.message || error))
            ? '发布参数序列化失败，已重试修复；请再点一次立即执行'
            : (error.message || '发布中断')
          this.endTask(taskId, message, 'failed')
          this.addLog('error', '发布', `${item.title}：${message}`)
        }
      }
      this.persist()
      return posted
    },
    async publishQueueForAccounts(accounts) {
      const list = (accounts || []).filter((item) => item?.enabled !== false)
      if (!list.length) return '先勾选发布账号'
      if (!window.tujian?.publishWork) return '请在桌面窗口里发布'
      const gap = Math.max(0, Number(this.settings.publishGap) || 0)
      let total = 0
      for (let index = 0; index < list.length; index += 1) {
        const account = list[index]
        if (index > 0 && gap) await new Promise((resolve) => setTimeout(resolve, gap * 1000))
        const ready = this.works.filter((item) => this.isPublishReady(item))
        if (!ready.length) continue
        total += await this.publishWorksBatch(ready, account)
      }
      return total ? `已用 ${list.length} 个账号发出 ${total} 条` : this.explainNoPublishReady()
    },
    mergePlazaPage(payload) {
      const accountId = payload?.accountId || ''
      const incoming = Array.isArray(payload?.products) ? payload.products : []
      if (!accountId || !incoming.length) return
      if (payload.reset) this.plaza = this.plaza.filter((row) => (row.accountId || '') !== accountId)
      const seen = new Set()
      this.plaza.forEach((row) => {
        if ((row.accountId || '') === accountId) seen.add(row.id)
      })
      incoming.forEach((item) => {
        if (!item?.id || seen.has(item.id)) return
        seen.add(item.id)
        this.plaza.push(item)
      })
    },
    async hydrate() {
      try {
        if (!getToken()) {
          const entered = await api.enter()
          setToken(entered.token)
        }
        let me
        try {
          me = await api.me()
        } catch {
          setToken('')
          const entered = await api.enter()
          setToken(entered.token)
          me = await api.me()
        }
        this.user = me.user
        this.displayName = me.user?.displayName || ''
        this.systemNow = me.systemNow
        this.adminMode = false
        this.applyServer(await api.getState())
        this.apiError = ''
        this.resumeInterruptedJobs()
      } catch (error) {
        this.user = null
        this.apiError = error.message
      }
      this.ready = true
    },
    resumeInterruptedJobs() {
      // 有成片却还停在「生成中」→ 改成待审核
      this.works.forEach((work) => {
        if (work.status === '生成中' && work.videoPath) {
          work.status = '已生成'
          work.progress = 100
          work.failReason = ''
        }
      })
      // 任务中心挂回还在跑的生成/发布
      const runningIds = new Set(this.runtimeTasks.filter((item) => item.status === 'running').map((item) => item.workId))
      this.works.forEach((work) => {
        if (!['生成中', '发布中'].includes(work.status) || runningIds.has(work.id)) return
        this.beginTask({
          kind: work.status === '发布中' ? '发布' : '生成',
          title: work.title,
          workId: work.id,
          accountId: work.status === '发布中' ? (work.publishAccountId || '') : (work.doubaoAccountId || ''),
          note: work.status === '发布中' ? '软件重启后续传·发布中' : '软件重启后续传·生成中'
        })
      })
      // 断线续传：有豆包对话链接的生成中任务，优先拉无水印；否则重新排队生成
      const interrupted = this.works.filter((item) => item.status === '生成中' && !item.videoPath)
      interrupted.forEach((work, index) => {
        this.addLog('info', '任务', `续传「${work.title}」${work.doubaoChatUrl ? '（先检测原对话是否还在生成）' : '（无对话链接，重新打开豆包）'}`)
        setTimeout(() => {
          if (work.doubaoChatUrl && window.tujian?.pullCleanDoubao) {
            const account = this.doubaoAccounts.find((item) => item.id === work.doubaoAccountId) || this.doubaoAccount()
            if (!account) {
              this.kickGenerate(work.id, { immediate: index === 0 })
              return
            }
            window.tujian.pullCleanDoubao({
              id: account.id,
              name: account.name,
              login: account.login,
              mode: account.loginMode || 'password',
              chatUrl: work.doubaoChatUrl,
              outputFile: '',
              outputDir: this.settings.outputDir,
              waitRunning: true,
              waitMs: 10 * 60 * 1000
            }).then((result) => {
              if (result?.ok && result.videoPath) {
                work.videoPath = result.videoPath
                if (result.doubaoChatUrl) work.doubaoChatUrl = result.doubaoChatUrl
                work.status = '已生成'
                work.progress = 100
                work.failReason = ''
                this.addLog('success', '豆包', `续传成功，成片已回到待审核：${work.title}`)
                this.persist()
                return
              }
              // 还在排队/生成：保持生成中，稍后自动再拉，绝不立刻重发浪费额度
              if (result?.stillRunning || result?.needRegenerate === false) {
                work.status = '生成中'
                work.failReason = result?.message || '原对话仍在生成，等待成片'
                this.addLog('info', '豆包', `「${work.title}」${work.failReason}`)
                this.persist()
                setTimeout(() => {
                  if (work.status === '生成中' && !work.videoPath) this.resumeOneDoubaoWork(work.id)
                }, 90 * 1000)
                return
              }
              if (result?.needRegenerate) {
                this.addLog('warning', '豆包', `「${work.title}」原对话已结束且无成片，才重新发起：${result.message || ''}`)
                this.kickGenerate(work.id, { immediate: true })
                return
              }
              this.addLog('warning', '豆包', `「${work.title}」续传未拿到成片：${result?.message || '未知原因'}，暂不重发`)
              this.persist()
            }).catch((error) => {
              this.addLog('warning', '豆包', `「${work.title}」续传检测失败：${error?.message || error}，暂不重发以免浪费额度`)
              this.persist()
            })
            return
          }
          this.kickGenerate(work.id, { immediate: index === 0 })
        }, 800 + index * 1200)
      })
      if (interrupted.length || this.runtimeTasks.some((item) => item.status === 'running')) {
        this.persist()
      }
    },
    resumeOneDoubaoWork(workId) {
      const work = this.works.find((item) => item.id === workId)
      if (!work || work.status !== '生成中' || work.videoPath) return
      if (!work.doubaoChatUrl || !window.tujian?.pullCleanDoubao) return
      const account = this.doubaoAccounts.find((item) => item.id === work.doubaoAccountId) || this.doubaoAccount()
      if (!account) return
      this.addLog('info', '豆包', `再次检测「${work.title}」原对话是否已出成片`)
      window.tujian.pullCleanDoubao({
        id: account.id,
        name: account.name,
        login: account.login,
        mode: account.loginMode || 'password',
        chatUrl: work.doubaoChatUrl,
        outputFile: '',
        outputDir: this.settings.outputDir,
        waitRunning: true,
        waitMs: 8 * 60 * 1000
      }).then((result) => {
        if (result?.ok && result.videoPath) {
          work.videoPath = result.videoPath
          work.status = '已生成'
          work.progress = 100
          work.failReason = ''
          this.addLog('success', '豆包', `续传拉取成功：${work.title}`)
          this.persist()
          return
        }
        if (result?.stillRunning || result?.needRegenerate === false) {
          work.failReason = result?.message || '仍在生成'
          this.persist()
          setTimeout(() => {
            if (work.status === '生成中' && !work.videoPath) this.resumeOneDoubaoWork(work.id)
          }, 120 * 1000)
          return
        }
        if (result?.needRegenerate) {
          this.addLog('warning', '豆包', `「${work.title}」确认原对话已结束，重新发起`)
          this.kickGenerate(work.id, { immediate: true })
        }
      }).catch(() => {})
    },
    async unlockAdmin(password) {
      await api.unlockAdmin(password)
      this.adminMode = true
      this.addLog('info', '管理', '已进入管理')
    },
    async lockAdmin() {
      await api.lockAdmin().catch(() => {})
      this.adminMode = false
    },
    async configureLicense(plan) {
      const data = await api.configureLicense(plan)
      this.license = data.license
      if (data.systemNow) this.systemNow = data.systemNow
      this.addLog('success', '授权', data.license.permanent ? '有效期已设为永久' : `有效期已设为${data.license.label}`)
      return data.license
    },
    async login(username, password) {
      const data = await api.login(username, password)
      setToken(data.token)
      this.user = data.user
      this.systemNow = data.systemNow
      this.applyServer(await api.getState())
    },
    async register(username, password) {
      const data = await api.register(username, password)
      setToken(data.token)
      this.user = data.user
      this.systemNow = data.systemNow
      this.applyServer(await api.getState())
    },
    async logout() {
      await api.logout().catch(() => {})
      setToken('')
      const seed = createSeed()
      for (const key of PERSIST_KEYS) this[key] = seed[key]
      this.license = null
      this.generatedLicenses = []
      this.user = null
    },
    async refreshClock() {
      if (!this.user) return
      const data = await api.systemTime()
      this.systemNow = data.systemNow
    },
    snapshot() {
      const snapshot = {}
      for (const key of PERSIST_KEYS) snapshot[key] = this[key]
      return snapshot
    },
    persist() {
      if (!this.ready) return
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        const run = () => {
          api.saveState(this.snapshot()).catch((error) => {
            this.apiError = error.message
          })
        }
        if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1600 })
        else setTimeout(run, 0)
      }, 1200)
    },
    async flush() {
      if (!this.ready) return
      clearTimeout(saveTimer)
      await api.saveState(this.snapshot())
    },
    addLog(level, module, message) {
      this.logs.unshift({
        id: uid('L'),
        level,
        module,
        message,
        operator: this.adminMode ? '管理员' : (this.user?.username || '本地用户'),
        time: formatTime(this.systemNow ? new Date(this.systemNow) : new Date())
      })
      if (this.logs.length > 2000) this.logs.length = 2000
      this.persist()
      if (window.tujian?.appendLog) {
        window.tujian.appendLog(`${formatTime(new Date())} [${level}] ${module} ${message}`).catch(() => {})
      }
    },
    syncProxy() {
      const proxy = (this.proxies || []).find((item) => item.enabled && item.host && item.port)
      if (window.tujian?.useProxy) window.tujian.useProxy(proxy || null).catch(() => {})
    },
    runDueSchedules() {
      const now = this.systemNow ? new Date(this.systemNow) : new Date()
      if (Number.isNaN(now.getTime())) return
      const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      const day = formatTime(now).slice(0, 10)
      const collectKey = `${day} ${clock}`
      if (this.settings.collectStart === clock && this.settings.lastCollectRun !== collectKey) {
        this.settings.lastCollectRun = collectKey
        this.syncCatalog('products').catch(() => {})
      }
      this.schedules.forEach((task) => {
        if (!task.enabled) return
        if (task._running) return
        if (task.mode === '循环') {
          const gap = Math.max(5, Number(task.intervalMinutes) || 30)
          const last = task.lastRun ? new Date(String(task.lastRun).replace(' ', 'T')) : null
          const elapsed = last && !Number.isNaN(last.getTime()) ? (now.getTime() - last.getTime()) / 60000 : Infinity
          if (elapsed < gap) return
          this.executeSchedule(task)
          return
        }
        if (!task.time) return
        if (task.date && task.date !== day) return
        // 当天已成功发出则不再跑；空队列不算成功，到点后每 5 分钟再试
        if (task.lastSuccessDay === day) return
        const [th, tm] = String(task.time).split(':').map((item) => Number(item))
        if (!Number.isFinite(th) || !Number.isFinite(tm)) return
        const dueMinutes = th * 60 + tm
        const nowMinutes = now.getHours() * 60 + now.getMinutes()
        if (nowMinutes < dueMinutes) return
        const last = task.lastRun ? new Date(String(task.lastRun).replace(' ', 'T')) : null
        const elapsed = last && !Number.isNaN(last.getTime()) ? (now.getTime() - last.getTime()) / 60000 : Infinity
        if (elapsed < 5) return
        this.executeSchedule(task)
      })
    },
    async executeSchedule(task, options = {}) {
      if (!task) return '没有找到这条定时任务'
      if (task._running && !options.immediate) return '这条定时任务正在执行'
      const immediate = Boolean(options.immediate)
      const stamp = formatTime(this.systemNow ? new Date(this.systemNow) : new Date())
      const when = immediate ? '立即执行' : `到了 ${task.time || '间隔'}`
      const taskId = this.beginTask({
        kind: '定时',
        title: task.name,
        accountId: this.publishAccounts.find((item) => item.name === task.account)?.id || '',
        note: when
      })
      this.addLog('info', '定时', `${task.name}：${when}`)
      task._running = true
      try {
      if (task.type === '审核通过后发布' || task.type === '发布队列' || !task.type) {
        const ready = this.works.filter((item) => this.isPublishReady(item))
        const account = this.publishAccounts.find((item) => item.name === task.account)
          || this.publishAccounts.find((item) => item.enabled)
          || this.publishAccounts[0]
        task.lastRun = stamp
        this.persist()
        if (!ready.length) {
          const message = `${task.name}：${when}，${this.explainNoPublishReady()}`
          this.endTask(taskId, message)
          this.addLog('info', '定时', message)
          return message
        }
        if (!account || !window.tujian?.publishWork) {
          const message = `${task.name}：有 ${ready.length} 条可发布，但没有发布账号或没在桌面窗口里运行`
          this.endTask(taskId, message, 'failed')
          this.addLog('warning', '定时', message)
          return message
        }
        const posted = await this.publishWorksBatch(ready, account)
        if (posted > 0) {
          task.lastSuccessDay = stamp.slice(0, 10)
          if (task.mode === '单次') task.enabled = false
        }
        this.persist()
        const message = posted
          ? `${task.name} 已把 ${posted} 条审核通过的成片送进抖音`
          : `${task.name}：${when}，但成片没有放进上传页`
        this.endTask(taskId, message, posted ? 'done' : 'failed')
        return message
      }
      if (task.type === '生成队列') {
        const pending = this.works.filter((item) => item.status === '待生成')
        pending.forEach((item) => this.kickGenerate(item.id))
        task.lastRun = stamp
        if (pending.length) task.lastSuccessDay = stamp.slice(0, 10)
        this.persist()
        const message = `${task.name}：${when}，开始生成 ${pending.length} 条`
        this.endTask(taskId, message)
        this.addLog('info', '定时', message)
        return message
      }
      task.lastRun = stamp
      this.persist()
      if (task.type === '选品采集') {
        try {
          await this.syncCatalog('products')
          task.lastSuccessDay = stamp.slice(0, 10)
          const message = `${task.name}：${when}，选品已同步`
          this.endTask(taskId, message)
          return message
        } catch (error) {
          const message = `${task.name}：选品没有拉到，${error.message || '稍后再试'}`
          this.endTask(taskId, message, 'failed')
          this.addLog('info', '定时', message)
          return message
        }
      }
      const fallback = `${task.name}：${when}（${task.type || '任务'}）`
      this.endTask(taskId, fallback)
      return fallback
      } catch (error) {
        const message = /could not be cloned/i.test(String(error?.message || error))
          ? `${task.name}：参数无法传给桌面进程，请再点一次立即执行`
          : `${task.name}：${error.message || '执行失败'}`
        this.endTask(taskId, message, 'failed')
        this.addLog('error', '定时', message)
        return message
      } finally {
        task._running = false
      }
    },
    async reset() {
      const data = await api.resetState()
      this.applyServer(data)
      this.addLog('info', '系统', '已清空选品、作品和账号。')
    },
    async pullShopAuth() {
      const logged = this.publishAccounts.find((item) => item.loginStatus === '已登录')
      const data = await api.pullShopAuth(logged?.id || this.activeAccountId)
      this.applyServer(data)
      return data.auth
    },
    writeSyncLogs(logs, summary, ok) {
      ;(logs || []).forEach((line) => this.addLog('info', '同步', line))
      if (summary) this.addLog(ok ? 'success' : 'warning', '同步', summary)
    },
    async syncCatalog(target, accountId) {
      try {
        if (accountId) this.activeAccountId = accountId
        const data = await api.syncCatalog(target, accountId || this.activeAccountId)
        this.applyServer(data)
        this.writeSyncLogs(data.logs, data.message || `同步完成 ${data.count || 0} 件`, Boolean(data.count))
        return data
      } catch (error) {
        this.writeSyncLogs(error.logs, error.message || '同步没有完成', false)
        throw error
      }
    },
    syncPlazaQuiet(accountId) {
      if (accountId) this.activeAccountId = accountId
      this.addLog('info', '同步', '添加账号后自动同步选品广场')
      return this.syncCatalog('plaza').catch(() => {})
    },
    async saveAccountSecret(id, login, password) {
      await api.saveAccountSecret(id, login, password)
    },
    async removeAccountSecret(id) {
      await api.removeAccountSecret(id)
    },
    async batchAccounts(kind, text) {
      const data = await api.batchAccounts(kind, text)
      this.applyServer(data)
      return data.count
    },
    async saveDisplayName(name) {
      const data = await api.saveProfile(name)
      this.displayName = data.displayName || ''
      if (this.user) this.user.displayName = this.displayName
      this.addLog('info', '账户', `使用用户已记为 ${this.displayName}`)
    },
    async activateLicense(code) {
      const data = await api.activate(code)
      this.license = data.license
      if (data.userStatus) this.userStatus = data.userStatus
      if (data.systemNow) this.systemNow = data.systemNow
      this.addLog('success', '授权', data.license.permanent ? '已激活永久授权' : `已激活${data.license.label}授权`)
      return data.license
    },
    async loadAdminAccounts() {
      const data = await api.adminAccounts()
      this.adminAccounts = data.accounts || []
      return this.adminAccounts
    },
    async setAccountStatus(id, status) {
      const data = await api.setAccountStatus(id, status)
      this.adminAccounts = data.accounts || []
      const mine = this.adminAccounts.find((item) => item.id === this.user?.id)
      if (mine) this.userStatus = mine.status
      this.addLog('info', '管理', `账号状态已改为${status}`)
    },
    syncDoubaoStats() {
      const today = String(this.systemNow || formatTime(new Date())).slice(0, 10)
      this.doubaoAccounts.forEach((account) => {
        const limit = quotaLimit(account)
        account.quotaLimit = limit
        const mine = this.works.filter((work) => work.doubaoAccountId === account.id || work.doubaoAccount === account.name)
        const done = mine.filter((work) => work.videoPath || ['已生成', '审核通过', '发布中', '已发布'].includes(work.status))
        const failed = mine.filter((work) => work.failReason && !work.videoPath && work.status !== '生成中')
        const todayDone = done.filter((work) => String(work.finishedAt || '').slice(0, 10) === today)
        const used = account.quotaDate === today ? limit : todayDone.length
        account.quota = `${used}/${limit}`
        const latest = done.slice().sort((a, b) => String(b.finishedAt || '').localeCompare(String(a.finishedAt || '')))[0]
        account.recent = latest ? `${latest.title} · ${latest.finishedAt}` : `成功 ${done.length} · 失败 ${failed.length}`
        account.successCount = done.length
        account.failCount = failed.length
      })
    },
    async generateLicenseCode(plan) {
      const data = await api.generateLicense(plan)
      this.generatedLicenses = data.generatedLicenses
      return data.item
    },
    addGroup(name) {
      const value = String(name || '').trim()
      if (!value || this.groups.includes(value)) return
      this.groups.push(value)
      this.addLog('info', '分组', `新增分组 ${value}`)
    },
    removeGroup(name) {
      this.groups = this.groups.filter((item) => item !== name)
      this.persist()
    },
    async openPrompt(ids = []) {
      this.promptProductIds = [...ids]
      await Promise.all((ids || []).map((id) => this.enrichProduct(id)))
      this.promptVisible = true
    },
    applyProgress({ workId, progress, status, videoPath, confirmSent, confirmNeeded, confirmNote }) {
      const work = this.works.find((item) => item.id === workId)
      if (!work) return
      if (progress != null) work.progress = progress
      if (status) work.status = status
      if (videoPath) work.videoPath = videoPath
      if (confirmNote) {
        work.confirmNote = confirmNote
        work.confirmNeeded = Boolean(confirmNeeded)
        work.confirmSent = Boolean(confirmSent)
      }
      if (status === '已生成') {
        work.finishedAt = formatTime(new Date())
        if (!this.works.some((item) => item.status === '生成中')) {
          this.doubaoAccounts.forEach((account) => {
            if (account.worker === '生成中') account.worker = '空闲'
          })
        }
        this.addLog('success', '作品', `生成完成：${work.title}`)
        return
      }
      this.persist()
    },
    doubaoAccount() {
      const list = this.doubaoAccounts || []
      return list.find((item) => item.enabled && item.loginStatus === '已登录')
        || list.find((item) => item.enabled)
        || list[0]
        || null
    },
    openDoubaoSlot(account, slot) {
      const target = account || this.doubaoAccount()
      if (!target || !window.tujian?.openAccount) return Promise.resolve(null)
      return window.tujian.openAccount({
        kind: 'doubao',
        id: target.id,
        name: target.name,
        login: target.login,
        mode: target.loginMode || 'password',
        url: 'https://www.doubao.com/chat/',
        slot: slot || 'gen'
      }).catch(() => null)
    },
    productShots(work) {
      const product = this.products.find((item) => item.id === work?.productId)
      const removed = new Set(product?.removedImages || [])
      return [...new Set([...(product?.images || []), product?.image, ...(work?.images || []), work?.image]
        .map((item) => {
          const text = String(item || '').trim()
          if (!text || removed.has(text) || text.startsWith('blob:') || text.startsWith('data:')) return ''
          return text.startsWith('//') ? `https:${text}` : text
        })
        .filter(Boolean))].slice(0, 6)
    },
    async enrichProduct(productId) {
      const product = this.products.find((item) => item.id === productId)
      if (!product || !window.tujian?.lookupProduct) return product
      const thin = !product.image && !(product.images || []).length
      const placeholder = /^商品 |^导入商品 /.test(String(product.title || ''))
      if (!thin && !placeholder) return product
      try {
        const account = this.publishAccounts.find((item) => item.id === (product.accountId || this.activeAccountId))
        const result = await window.tujian.lookupProduct({
          accountId: product.accountId || this.activeAccountId,
          link: product.link || product.id,
          name: account?.name,
          login: account?.login,
          mode: account?.loginMode || 'password'
        })
        const looked = result?.product
        if (!looked) return product
        const images = [...new Set([...(looked.images || []), looked.image, ...(product.images || []), product.image]
          .map((item) => String(item || '').trim())
          .filter((item) => /^https?:\/\//.test(item)))].slice(0, 6)
        if (looked.title && !/^商品 |^导入商品 /.test(looked.title)) product.title = looked.title
        if (Number(looked.price) > 0) product.price = Number(looked.price)
        if (Number(looked.rate) > 0) product.rate = Number(looked.rate)
        if (looked.category && !['链接导入', '未分类'].includes(looked.category)) product.category = looked.category
        if (looked.shop && looked.shop !== '待补充') product.shop = looked.shop
        if (looked.link) product.link = looked.link
        if (Number(looked.monthlySales) > 0) product.monthlySales = Number(looked.monthlySales)
        if (images.length) {
          product.images = images
          product.image = images[0]
        }
        this.persist()
      } catch { /* 补全失败就用现有字段 */ }
      return product
    },
    async regenerateWork(workId) {
      const work = this.works.find((item) => item.id === workId)
      if (!work) return '没有找到这条作品'
      if (!window.tujian?.generateDoubao) return '请在桌面窗口里重新生成'
      if (work.productId) await this.enrichProduct(work.productId)
      const product = this.products.find((item) => item.id === work.productId)
      let images = this.productShots(work)
      upgradePromptSettings(this.settings)
      const template = (this.settings.promptTemplates || []).find((item) => item.id === this.settings.activePromptTemplateId)
        || (this.settings.promptTemplates || [])[0]
      const prompt = composePrompt({
        promptText: work.prompt || product?.filledPrompt || template?.promptText || this.settings.promptText || '',
        model: work.model || template?.model || this.settings.model,
        duration: work.duration || template?.duration || this.settings.duration,
        ratio: work.ratio || template?.ratio || this.settings.ratio,
        lockText: work.lockText,
        storyline: work.storyline,
        caption: work.caption,
        script: work.script,
        compliance: work.compliance
      }, product || { title: work.title, category: '', price: '', shop: '' })
      if (!String(prompt || '').trim()) {
        this.addLog('error', '豆包', `「${work.title}」没有提示词，重新生成已取消`)
        return '这条商品还没有提示词。先在设置或确认框里写好提示词'
      }
      if (!images.length) {
        this.addLog('error', '豆包', `「${work.title}」没有商品图，重新生成已取消`)
        return '这条商品没有照片。请先同步选品/补图，提示词和图片必须一起发'
      }
      work.images = images
      work.image = images[0]
      work.prompt = prompt
      work.videoPath = ''
      work.doubaoChatUrl = ''
      work.failReason = ''
      work.progress = 5
      work.status = '生成中'
      work.doubaoSlot = `gen-${work.id}-${Date.now()}`
      // 从排队里去掉旧任务，避免卡在后面
      for (let i = generatePending.length - 1; i >= 0; i -= 1) {
        if (generatePending[i] === workId) generatePending.splice(i, 1)
      }
      const account = this.doubaoAccounts.find((item) => item.id === work.doubaoAccountId)
        || this.doubaoAccount()
      if (!account) {
        work.status = '待生成'
        this.addLog('error', '豆包', '没有可用的豆包账号')
        return '先添加一个豆包账号'
      }
      // 同账号卡死时放行，重新生成要马上开窗
      busyDoubao.delete(account.id)
      this.persist()
      this.addLog('info', '豆包', `重新生成「${work.title}」，立即打开豆包并发送提示词和 ${images.length} 张商品图`)
      generateActive += 1
      Promise.resolve()
        .then(() => this.runDoubao(workId))
        .catch((error) => this.addLog('error', '豆包', error.message || '重新生成中断'))
        .finally(() => {
          generateActive = Math.max(0, generateActive - 1)
          this.pumpGenerate()
        })
      return ''
    },
    kickGenerate(workId, options = {}) {
      const pending = generatePending.filter((id) => id !== workId)
      if (options.immediate) pending.unshift(workId)
      else pending.push(workId)
      generatePending.length = 0
      generatePending.push(...pending)
      this.pumpGenerate({ immediate: Boolean(options.immediate) })
    },
    pumpGenerate(options = {}) {
      const limit = Math.max(1, Math.min(10, Number(this.settings.doubaoOpen) || 1))
      while (generateActive < limit && generatePending.length) {
        const workId = generatePending.shift()
        generateActive += 1
        const gap = options.immediate ? 0 : Math.max(0, Number(this.settings.doubaoGap) || 0) * 1000
        const now = Date.now()
        const at = gap ? Math.max(now, nextDoubaoLaunch) : now
        nextDoubaoLaunch = at + (gap || 0)
        const delay = Math.max(0, at - now)
        options.immediate = false
        Promise.resolve()
          .then(() => (delay ? new Promise((resolve) => setTimeout(resolve, delay)) : null))
          .then(() => this.runDoubao(workId))
          .catch((error) => this.addLog('error', '豆包', error.message || '生成中断'))
          .finally(() => {
            generateActive = Math.max(0, generateActive - 1)
            this.pumpGenerate()
          })
      }
    },
    async runDoubao(workId, skipped = []) {
      const work = this.works.find((item) => item.id === workId)
      if (!work) return
      if (this.isWorkCancelled(workId)) {
        cancelledWorks.delete(String(workId))
        work.status = '待生成'
        work.failReason = '已在任务中心手动结束'
        this.persist()
        return
      }
      const today = new Date().toISOString().slice(0, 10)
      const accounts = this.doubaoAccounts.filter((item) => item.enabled && item.quotaDate !== today && !skipped.includes(item.id) && !busyDoubao.has(item.id))
      const account = accounts.find((item) => item.loginStatus === '已登录') || accounts[0]
      if (!account) {
        const waiting = this.doubaoAccounts.some((item) => item.enabled && busyDoubao.has(item.id))
        if (waiting && !skipped.length) {
          await new Promise((resolve) => setTimeout(resolve, 1200))
          return this.runDoubao(workId, skipped)
        }
        work.status = '待生成'
        work.failReason = skipped.length ? '豆包账号额度都不够，生成已停' : '先添加并登录一个豆包账号'
        this.addLog('warning', '豆包', work.failReason)
        this.persist()
        return
      }
      busyDoubao.add(account.id)
      work.status = '生成中'
      work.progress = 10
      work.duration = Number(work.duration) || ''
      work.doubaoAccount = account.name
      work.doubaoAccountId = account.id
      work.failReason = ''
      work.confirmNote = ''
      account.worker = '生成中'
      const taskId = this.beginTask({
        kind: '生成',
        title: work.title,
        workId: work.id,
        accountId: account.id,
        note: '正在打开豆包'
      })
      this.persist()
      try {
      const markConfirm = (result) => {
        if (!result?.confirmNote) return
        work.confirmNote = result.confirmNote
        work.confirmNeeded = Boolean(result.confirmNeeded)
        work.confirmSent = Boolean(result.confirmSent)
        this.addLog(result.confirmNeeded && !result.confirmSent ? 'warning' : 'info', '豆包', `${account.name} ${result.confirmNote}`)
      }
      const product = this.products.find((item) => item.id === work.productId)
      const prompt = [
        work.prompt
          || product?.filledPrompt
          || composePrompt({
            promptText: this.settings.promptText,
            lockText: work.lockText,
            storyline: work.storyline,
            caption: work.caption,
            script: work.script,
            compliance: work.compliance,
            duration: work.duration,
            ratio: work.ratio,
            model: work.model
          }, product || { title: work.title })
      ].filter(Boolean).join('\n\n')
      if (prompt && !work.prompt) work.prompt = prompt
      if (!window.tujian?.generateDoubao) {
        work.status = '生成失败'
        work.failReason = '请在桌面窗口里用网页版豆包生成'
        account.worker = '空闲'
        this.endTask(taskId, work.failReason, 'failed')
        this.addLog('warning', '豆包', work.failReason)
        this.persist()
        return
      }
      if (!String(prompt || '').trim()) {
        work.status = '生成失败'
        work.failReason = '提示词是空的。提示词和图片必须一起发'
        account.worker = '空闲'
        this.endTask(taskId, work.failReason, 'failed')
        this.addLog('warning', '豆包', work.failReason)
        this.persist()
        return
      }
      const shots = this.productShots(work)
      if (!shots.length) {
        work.status = '生成失败'
        work.failReason = '没有商品图。提示词和图片必须一起发'
        account.worker = '空闲'
        this.endTask(taskId, work.failReason, 'failed')
        this.addLog('warning', '豆包', work.failReason)
        this.persist()
        return
      }
      work.images = shots
      work.image = shots[0]
      const slot = work.doubaoSlot || `gen-${work.id}`
      work.doubaoSlot = slot
      this.addLog('info', '豆包', `${account.name} 正在打开豆包，发送提示词和 ${shots.length} 张商品图`)
      ensureDoubaoRules(this.settings)
      const payload = plainGeneratePayload({
        account,
        prompt,
        shots,
        slot,
        saveDir: this.settings.outputDir,
        workId: work.id,
        captcha: this.settings.captchaSolver || {},
        replyRules: this.settings.doubaoReply,
        failMarkers: [
          ...(this.settings.doubaoFail?.immediate || []).filter((item) => item.enabled && item.match).map((item) => item.match),
          ...(this.settings.doubaoFail?.weak || []).filter((item) => item.enabled && item.match).map((item) => item.match)
        ],
        retryMarkers: {
          copyright: (this.settings.doubaoFail?.retryCopyright || []).filter((item) => item.enabled !== false && item.match).map((item) => item.match),
          busy: (this.settings.doubaoFail?.retryBusy || []).filter((item) => item.enabled !== false && item.match).map((item) => item.match)
        }
      })
      let result
      try {
        result = await window.tujian.generateDoubao(payload)
      } catch (error) {
        if (/could not be cloned/i.test(String(error?.message || error))) {
          result = await window.tujian.generateDoubao(JSON.parse(JSON.stringify(payload)))
        } else {
          throw error
        }
      }
      if (this.isWorkCancelled(workId)) {
        cancelledWorks.delete(String(workId))
        work.status = '待生成'
        work.failReason = '已在任务中心手动结束'
        this.endTask(taskId, work.failReason, 'cancelled')
        this.persist()
        return
      }
      if (result?.loginStatus) account.loginStatus = result.loginStatus
      markConfirm(result)
      if (result?.quota) {
        account.quotaDate = today
        account.worker = '空闲'
        this.endTask(taskId, '额度不够，换号重试')
        this.syncDoubaoStats()
        this.addLog('warning', '豆包', `${account.name} 额度不够，自动换下一个账号`)
        this.persist()
        return this.runDoubao(workId, skipped.concat(account.id))
      }
      let videoPath = result?.videoPath || ''
      let chatUrl = result?.doubaoChatUrl || ''
      let clean = Boolean(result?.clean)
      const specificChat = /doubao\.com\/chat\/[^/?#]+/i.test(chatUrl)
      if (window.tujian?.pullCleanDoubao && specificChat && (!videoPath || !clean)) {
        const pulled = await window.tujian.pullCleanDoubao(toPlain({
          id: account.id,
          name: account.name,
          login: account.login,
          mode: account.loginMode || 'password',
          chatUrl,
          outputFile: videoPath,
          outputDir: this.settings.outputDir
        }))
        if (pulled?.ok && pulled.videoPath) {
          videoPath = pulled.videoPath
          chatUrl = pulled.doubaoChatUrl || chatUrl
          clean = true
        }
      }
      if (videoPath) {
        work.videoPath = videoPath
        if (chatUrl) work.doubaoChatUrl = chatUrl
        work.status = '已生成'
        work.progress = 100
        work.finishedAt = formatTime(new Date())
        account.worker = '空闲'
        if (!this.settings.outputDir && result.saveDir) this.settings.outputDir = result.saveDir
        this.syncDoubaoStats()
        this.doneNotice = `${work.title}视频生成完成`
        this.endTask(taskId, clean ? '成片已保存（已去水印）' : '成片已保存')
        this.addLog('success', '豆包', clean ? `成片已自动去掉水印，保存在 ${videoPath}` : `成片已保存到 ${videoPath}`)
        this.notifyWebhook(`【huang++pro】生成完成：${work.title}`)
        this.persist()
        return
      }
      work.status = '生成失败'
      work.progress = 0
      work.failReason = result?.message || '网页版豆包没有返回视频'
      account.worker = '空闲'
      this.endTask(taskId, work.failReason, 'failed')
      this.syncDoubaoStats()
      this.addLog('warning', '豆包', work.failReason)
      this.persist()
      } catch (error) {
        work.status = '生成失败'
        work.progress = 0
        work.failReason = /could not be cloned/i.test(String(error?.message || error))
          ? '参数无法传给桌面进程，请再点一次重新生成'
          : (error.message || '生成中断')
        this.endTask(taskId, work.failReason, 'failed')
        this.addLog('error', '豆包', work.failReason)
        this.persist()
      } finally {
        busyDoubao.delete(account.id)
        if (account.worker === '生成中') account.worker = '空闲'
        const task = this.runtimeTasks.find((item) => item.id === taskId)
        if (task?.status === 'running') this.endTask(taskId, '已结束')
      }
    },
    createWorks(productIds, form) {
      const products = productIds.length
        ? this.products.filter((item) => productIds.includes(item.id))
        : [null]
      const created = []
        products.forEach((product) => {
        const picked = form.imagesByProduct?.[product?.id || '']
        const images = Array.isArray(picked)
          ? picked
          : (product?.images?.length ? product.images : (product?.image ? [product.image] : []))
        const work = {
          id: uid('W'),
          productId: product?.id || '',
          title: product?.title || '未命名带货视频',
          hue: product?.hue ?? 210,
          status: '生成中',
          progress: 0,
          model: form.model,
          duration: form.duration,
          ratio: form.ratio,
          voice: form.voice,
          lockText: form.lockText,
          storyline: form.storyline,
          caption: form.caption,
          script: form.script,
          compliance: form.compliance,
          image: images[0] || '',
          images,
          // 确认框里的提示词优先；否则用选品库已生成的 filledPrompt
          prompt: String(form?.promptText || '').trim()
            ? composePrompt(form, product)
            : (String(product?.filledPrompt || '').trim() || composePrompt(form, product)),
          kind: form.kind || 'AI',
          doubaoAccount: '',
          failReason: '',
          createdAt: formatTime(new Date()),
          finishedAt: ''
        }
        this.works.unshift(work)
        if (product) {
          product.scriptReady = true
          product.filledPrompt = work.prompt
        }
        created.push(work.id)
      })
      this.addLog('info', '作品', `已加入生成队列 ${created.length} 条`)
      const account = this.doubaoAccount()
      if (!account) {
        this.addLog('warning', '豆包', '先添加一个豆包账号，确认后才会打开网页')
      }
      // 不预先空开豆包：由 generateDoubao 在确认有图+提示词后再打开并发送
      created.forEach((id) => {
        const work = this.works.find((item) => item.id === id)
        if (!work) return
        work.doubaoSlot = `gen-${id}`
        if (!String(work.prompt || '').trim()) {
          work.status = '生成失败'
          work.failReason = '提示词是空的。提示词和图片必须一起发'
          return
        }
        if (!(work.images || []).length && !work.image) {
          work.status = '生成失败'
          work.failReason = '没有商品图。请先同步/导入完整商品，或在确认框里上传图片'
          this.addLog('warning', '豆包', `「${work.title}」${work.failReason}`)
          return
        }
        this.kickGenerate(id)
      })
      this.persist()
      this.queueOpen = true
      return created
    },
    importProducts(rows) {
      let count = 0
      rows.forEach((row) => {
        if (!row.title) return
        const cleaned = cleanTitle(row.title, this.settings.bannedWords)
        this.products.unshift({
          id: uid('P'),
          title: cleaned.title,
          rawTitle: cleaned.changed ? row.title : '',
          bannedHits: cleaned.hits,
          price: Number(row.price) || 0,
          rate: Number(row.rate) || 0,
          category: row.category || '未分类',
          shop: row.shop || '手动导入',
          link: row.link || '',
          source: '手动导入',
          accountId: this.activeAccountId,
          monthlySales: 0,
          external: true,
          scriptReady: false,
          hue: Math.floor(Math.random() * 360),
          createdAt: formatTime(new Date())
        })
        count += 1
      })
      if (count) this.addLog('success', '选品', `表格导入 ${count} 条商品`)
      return count
    },
    removeProductImage(productId, src) {
      const product = this.products.find((item) => item.id === productId)
      if (!product || !src) return
      product.imagesEdited = true
      product.removedImages = [...new Set([...(product.removedImages || []), src])]
      product.images = (product.images || []).filter((item) => item !== src)
      if (product.image === src) product.image = product.images[0] || ''
      this.works.forEach((work) => {
        if (work.productId !== productId) return
        work.images = (work.images || []).filter((item) => item !== src)
        if (work.image === src) work.image = work.images[0] || product.image || ''
      })
      this.persist()
      this.flush()
    },
    setProductImages(productId, images) {
      const product = this.products.find((item) => item.id === productId)
      if (!product) return
      const next = [...new Set((images || []).filter(Boolean))]
      const previous = new Set([...(product.images || []), product.image].filter(Boolean))
      const removed = [...previous].filter((item) => !next.includes(item))
      product.imagesEdited = true
      product.removedImages = [...new Set([...(product.removedImages || []), ...removed])]
      product.images = next
      product.image = next[0] || ''
      this.persist()
      this.flush()
    },
    applyPrompts(productIds) {
      upgradePromptSettings(this.settings)
      const template = (this.settings.promptTemplates || []).find((item) => item.id === this.settings.activePromptTemplateId)
        || (this.settings.promptTemplates || [])[0]
      if (!template?.promptText) return 0
      const form = {
        promptText: template.promptText,
        model: template.model || this.settings.model,
        duration: template.duration || this.settings.duration,
        ratio: template.ratio || this.settings.ratio
      }
      let count = 0
      this.products.forEach((product) => {
        if (productIds?.length && !productIds.includes(product.id)) return
        product.filledPrompt = composePrompt(form, product)
        product.scriptReady = true
        product.promptTemplateId = template.id
        count += 1
      })
      if (count) {
        this.addLog('success', '提示词', `已按「${template.name}」生成 ${count} 条提示词`)
        this.persist()
      }
      return count
    },
    addFromPlaza(id) {
      const item = this.plaza.find((row) => row.id === id)
      if (!item || item.added) return null
      if (this.products.some((row) => row.id === item.id && (row.accountId || '') === (this.activeAccountId || ''))) {
        item.added = true
        this.persist()
        return null
      }
      item.added = true
      const cleaned = cleanTitle(item.title, this.settings.bannedWords)
      this.products.unshift({
        id: item.id,
        title: cleaned.title,
        rawTitle: cleaned.changed ? item.title : '',
        bannedHits: cleaned.hits,
        price: item.price,
        rate: item.rate,
        category: goodsCategory(item),
        tags: goodsTags(item),
        freeShipping: isFreeShipping(item),
        coupon: couponTags(item)[0] || '',
        shop: item.shop,
        source: '选品广场',
        accountId: this.activeAccountId,
        monthlySales: item.monthlySales,
        external: true,
        scriptReady: false,
        hue: item.hue,
        image: item.image || '',
        images: item.images?.length ? item.images : (item.image ? [item.image] : []),
        createdAt: formatTime(new Date())
      })
      this.addLog('success', '选品', `加入选品库：${item.title}`)
      return item
    },
    consumeCollectQuota() {
      const today = new Date().toISOString().slice(0, 10)
      if (this.settings.collectedDate !== today) {
        this.settings.collectedDate = today
        this.settings.collectedToday = 0
      }
      if (this.settings.collectedToday >= Number(this.settings.dailyCollectLimit || 0)) return false
      this.settings.collectedToday += 1
      this.persist()
      return true
    },
    finishPublish() {
      const list = this.works.filter((item) => item.status === '发布中')
      list.forEach((item) => {
        item.status = '已发布'
      })
      if (!list.length) {
        this.addLog('info', '发布', '当前没有发布中的作品。')
        return 0
      }
      this.publishNo += 1
      this.addLog('success', '发布', `本轮标记完成 ${list.length} 条，发布序号记为 ${this.publishNo}`)
      return list.length
    },
    previewLock(product) {
      return fillTemplate(this.settings.productLock, product)
    }
  }
})
