import { defineStore } from 'pinia'
import { createSeed, defaultPromptSettings, upgradePromptSettings } from '@/mock/data'
import { composePrompt, fillTemplate, formatTime, keepProductImage, publishTitleFromGoods, topicsFromGoods, uid, withVoice } from '@/utils/format'
import { cleanTitle, defaultBannedWords, sanitizeProductTitle } from '@/utils/banned'
import { ensureDoubaoRules } from '@/utils/doubaoRules'
import { BUILTIN_SCHEDULE_DEFS, isBuiltinSchedule } from '@/utils/builtinSchedules'
import { blankPublishPage } from '@/utils/rpa'
import { api, getToken, setToken } from '@/services/api'
import { couponTags, goodsCategory, goodsTags, isFreeShipping } from '@/utils/goods'

function toPlain(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? null))
  } catch {
    return null
  }
}

function plainGeneratePayload({ account, prompt, shots, slot, saveDir, workId, captcha, replyRules, failMarkers, retryMarkers, copyNo, copyTitle, copyTags }) {
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
    copyNo: String(copyNo || ''),
    copyTitle: String(copyTitle || ''),
    copyTags: (copyTags || []).map((item) => String(item || '').replace(/^#/, '').trim()).filter(Boolean).slice(0, 5),
    captcha: {
      enabled: captcha?.enabled !== false,
      token: String(captcha?.token || ''),
      type: String(captcha?.type || types.click || '88888'),
      types: {
        click: String(types.click || '88888'),
        slider: String(types.slider || '20111'),
        text: String(types.text || '10110'),
        math: String(types.math || '50100')
      },
      url: String(captcha?.url || 'https://api.jfbym.com/api/YmServer/customApi'),
      maxRetries: Math.max(1, Math.min(6, Number(captcha?.maxRetries) || 4)),
      fallbackHuman: captcha?.fallbackHuman !== false,
      humanTimeoutSec: Math.max(30, Number(captcha?.humanTimeoutSec) || 180),
      watchSec: Math.max(2, Number(captcha?.watchSec) || 10)
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
  'schedules', 'rpaFlows', 'proxies', 'browsers', 'logs', 'doubaoChats', 'settings', 'inbox'
]

let saveTimer = null
const busyDoubao = new Set()
const doubaoRunning = new Set()
const doubaoRunningAt = new Map()
const doubaoWatchAfter = new Map()
let generateActive = 0
const generatePending = []
let generateForce = false
let lastQueueNote = 0
let nextDoubaoLaunch = 0
const MIN_PRODUCT_SHOTS = 6

function quotaLimit(account) {
  if (Number(account?.quotaLimit) > 0) return Number(account.quotaLimit)
  const matched = String(account?.quota || '').match(/\/(\d+)/)
  if (matched) return Math.max(1, Number(matched[1]))
  const plain = Number(account?.quota)
  if (plain > 0 && plain <= 100) return plain
  return 5
}

function todayKey() {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function stampDay(value) {
  const matched = String(value || '').match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (!matched) return ''
  return `${matched[1]}-${String(matched[2]).padStart(2, '0')}-${String(matched[3]).padStart(2, '0')}`
}

function chargeWorkQuota(work) {
  work.quotaChargedAt = formatTime(new Date())
  work.quotaCharged = true
  work.quotaRefunded = false
  work.quotaPending = true
}

function releaseWorkQuota(work) {
  work.quotaPending = false
  work.quotaCharged = false
  work.quotaRefunded = true
}

function keepWorkQuota(work) {
  work.quotaPending = false
  work.quotaCharged = true
  work.quotaRefunded = false
  if (!work.quotaChargedAt) work.quotaChargedAt = work.finishedAt || formatTime(new Date())
}

/** 只算今天扣下的额度。昨天的成片、昨天还在生成的任务，过了零点不再占今天的 5 个。 */
function doubaoQuotaUsed(works, account, today) {
  const day = today || todayKey()
  return (works || []).filter((work) => {
    const mine = work.doubaoAccountId === account.id || (account.name && work.doubaoAccount === account.name)
    if (!mine || work.quotaRefunded) return false
    const chargedDay = stampDay(work.quotaChargedAt)
    if (chargedDay) return chargedDay === day && (work.quotaCharged || work.quotaPending || work.videoPath)
    if (work.videoPath && stampDay(work.finishedAt) === day) return true
    return work.quotaPending && work.status === '生成中' && stampDay(work.createdAt) === day
  }).length
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
    mySchedules: (state) => (state.schedules || []).filter((item) => !isBuiltinSchedule(item)),
    systemSchedules: (state) => (state.schedules || []).filter((item) => isBuiltinSchedule(item)),
    unreadInbox: (state) => (state.inbox || []).filter((item) => !item.read && !item.done).length,
    licenseActive: (state) => {
      const license = state.license
      if (!license || !state.systemNow) return false
      if (license.permanent) return true
      return Boolean(license.expiresAt) && new Date(license.expiresAt).getTime() > new Date(state.systemNow).getTime()
    },
    doubaoToday(state) {
      const today = todayKey()
      const accounts = state.doubaoAccounts || []
      return {
        used: accounts.reduce((sum, account) => sum + doubaoQuotaUsed(state.works, account, today), 0),
        limit: accounts.reduce((sum, account) => sum + quotaLimit(account), 0),
        accounts: accounts.length
      }
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
      } else {
        if (this.settings.captchaSolver.enabled == null) this.settings.captchaSolver.enabled = true
      }
      if (!this.settings.captchaSolver.types) {
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
      if (!Array.isArray(this.inbox)) this.inbox = []
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
          const removed = new Set(row.removedImages || [])
          const merged = [...new Set([...(row.images || []), row.image, ...(found.images || []), found.image]
            .map((item) => String(item || '').trim())
            .filter((item) => item && !removed.has(item) && keepProductImage(item)))]
          if (merged.length) {
            row.images = merged
            row.image = merged[0]
          }
        }
        if (found.tags?.length && !row.tags?.length) row.tags = found.tags
        if (found.freeShipping && !row.freeShipping) row.freeShipping = true
      })
      this.syncProxy()
      this.applyWindowSize()
      this.ensureBuiltinSchedules()
    },
    /** 定时任务账号必须以当前发布账号为准，去掉已删除的 PB* 残留 */
    pruneStaleScheduleAccounts() {
      const list = Array.isArray(this.publishAccounts) ? this.publishAccounts : []
      let changed = false
      for (const task of this.schedules || []) {
        const raw = Array.isArray(task.accounts) && task.accounts.length
          ? task.accounts.map((item) => String(item || '').trim()).filter(Boolean)
          : String(task.account || '').split(/[、,，]/).map((item) => item.trim()).filter(Boolean)
        const kept = []
        for (const item of raw) {
          const found = list.find((account) => account.id === item || account.name === item)
          if (found && !kept.includes(found.id)) kept.push(found.id)
        }
        const label = kept
          .map((id) => list.find((account) => account.id === id)?.name || '')
          .filter(Boolean)
          .join('、')
        const prevIds = Array.isArray(task.accounts) ? task.accounts : []
        if (JSON.stringify(prevIds) !== JSON.stringify(kept) || String(task.account || '') !== label) {
          task.accounts = kept
          task.account = label
          changed = true
        }
      }
      return changed
    },
    ensureBuiltinSchedules() {
      if (!Array.isArray(this.schedules)) this.schedules = []
      if (!Array.isArray(this.settings.dismissedBuiltinIds)) this.settings.dismissedBuiltinIds = []
      const dismissed = new Set(this.settings.dismissedBuiltinIds)
      let changed = false
      if (this.pruneStaleScheduleAccounts()) changed = true
      for (const def of BUILTIN_SCHEDULE_DEFS) {
        if (dismissed.has(def.id)) continue
        const existing = this.schedules.find((item) => item.id === def.id)
        if (existing) {
          if (!existing.builtin) {
            existing.builtin = true
            changed = true
          }
          if (!existing.desc && def.desc) {
            existing.desc = def.desc
            changed = true
          }
          continue
        }
        const row = {
          ...def,
          lastRun: '',
          lastSuccessDay: '',
          time: def.id === 'SYS-collect'
            ? (String(this.settings.collectStart || def.time || '08:00'))
            : def.time
        }
        this.schedules.push(row)
        changed = true
      }
      // 选品车「开始时间」与内置采集任务双向对齐
      const collect = this.schedules.find((item) => item.id === 'SYS-collect')
      if (collect?.time && this.settings.collectStart !== collect.time) {
        this.settings.collectStart = collect.time
        changed = true
      }
      if (changed) this.persist()
    },
    dismissBuiltinSchedule(id) {
      if (!id) return
      if (!Array.isArray(this.settings.dismissedBuiltinIds)) this.settings.dismissedBuiltinIds = []
      if (!this.settings.dismissedBuiltinIds.includes(id)) {
        this.settings.dismissedBuiltinIds.push(id)
      }
      this.schedules = this.schedules.filter((item) => item.id !== id)
      this.persist()
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
    workMatchesClaim(work, pageOverride) {
      const page = pageOverride || this.settings.publishPage || {}
      const kind = work?.kind || (work?.model ? 'AI' : 'AI')
      if (kind === '混剪') return Boolean(page.claimMix)
      if (kind === '直播切片') return Boolean(page.claimLive)
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
      if (pending) return `还有 ${pending} 条「待审核」，请到审片工作台或我的作品点审核通过`
      if (claimedOut) return `有 ${claimedOut} 条已审核，但被设置里的「领取过滤」排除了（检查豆包AI生成是否勾选）`
      if (approved || publishing) return `有可发成片，请再点一次立即执行`
      return '没有审核通过的成片。请到「我的作品」把「待审核」点审核通过，或打开「审片工作台」审核'
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
    nextWorkNo() {
      return this.works.reduce((max, work) => Math.max(max, Number(work.no) || 0), 0) + 1
    },
    ensureWorkNumbers() {
      let next = this.works.reduce((max, work) => Math.max(max, Number(work.no) || 0), 0)
      let changed = false
      ;[...this.works].reverse().forEach((work) => {
        if (work.no) return
        next += 1
        work.no = next
        changed = true
      })
      if (changed) this.persist()
    },
    sourceCopy(work) {
      const product = this.products.find((item) => item.id === work?.productId) || null
      const goodsTitle = String(product?.title || work?.title || '').trim()
      const title = publishTitleFromGoods(goodsTitle, product || { title: goodsTitle })
      const tags = topicsFromGoods(goodsTitle, product || { title: goodsTitle })
        .map((tag) => String(tag || '').replace(/^#/, '').trim())
        .filter(Boolean)
        .slice(0, 5)
      return { title, tags }
    },
    async cancelAllRuntimeTasks() {
      const running = this.runtimeTasks.filter((item) => item.status === 'running')
      for (const row of running) {
        await this.cancelRuntimeTask(row.id)
      }
      return running.length
    },
    buildPublishPayload(item, account, pageOverride) {
      const page = pageOverride || this.settings.publishPage || {}
      const usingOverride = Boolean(pageOverride)
      const product = this.products.find((row) => row.id === item.productId)
        || this.plaza.find((row) => row.id === item.productId)
        || null
      const wantTitle = usingOverride
        ? Boolean(page.dyTitle || page.dyFakeTitle)
        : !(page.dyTitle === false && page.dyFakeTitle === false)
      const goodsTitle = String(product?.title || item.title || '').trim()
      const title = wantTitle
        ? publishTitleFromGoods(goodsTitle, product || { title: goodsTitle, category: product?.category || item.category, shop: product?.shop || item.shop })
        : ''
      const optimizedTitle = String(item.optimizedTitle || '').trim()
      const publishTitle = optimizedTitle || String(title || '').trim() || (wantTitle ? publishTitleFromGoods(goodsTitle || '今日好物分享', { title: goodsTitle || '今日好物分享' }) : '')
      const productId = String(product?.id || item.productId || '').replace(/[^\d]/g, '')
      const productLink = String(product?.link || product?.goodsUrl || item.productLink || '').trim()
        || (productId ? `https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=${productId}` : '')
      const wantCart = (usingOverride ? page.dyCart !== false : page.dyCart !== false) && Boolean(productId || productLink)
      const wantTags = page.dyTags !== false
      const optimizedTags = Array.isArray(item.optimizedTags)
        ? item.optimizedTags.map((tag) => String(tag || '').replace(/^#/, '').trim()).filter((tag) => tag && tag.length <= 12).slice(0, 5)
        : []
      const tags = wantTags
        ? (optimizedTags.length
          ? optimizedTags
          : topicsFromGoods(goodsTitle || item.title, product || { title: goodsTitle || item.title })
            .map((tag) => String(tag || '').replace(/^#/, '').trim())
            .filter((tag) => tag && tag.length <= 12 && !/^https?:/i.test(tag) && !/haohuo|jinritemai/i.test(tag)))
        : []
      return {
        id: String(account.id || ''),
        name: String(account.name || ''),
        login: String(account.login || ''),
        mode: String(account.loginMode || 'password'),
        videoPath: String(item.videoPath || ''),
        title: String(publishTitle || ''),
        tags,
        productLink,
        productId,
        options: {
          dyTitle: wantTitle,
          dyFakeTitle: usingOverride ? Boolean(page.dyFakeTitle) : page.dyFakeTitle !== false,
          dyTags: wantTags,
          dyCart: wantCart,
          dyDeclare: usingOverride ? page.dyDeclare !== false : page.dyDeclare !== false,
          dySchedule: Boolean(page.dySchedule),
          dyDelay: Number(page.dyDelay) || 0,
          dyPrivate: Boolean(page.dyPrivate),
          dyManage: page.dyManage === true,
          deleteSources: page.deleteSources === true
        },
        workId: String(item.id || '')
      }
    },
    async publishWorksBatch(works, account, pageOverride) {
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
        const payload = this.buildPublishPayload(item, account, pageOverride)
        item.publishTitle = payload.title
        item.publishTags = payload.tags
        const statusBefore = item.status
        item.status = '发布中'
        item.publishAccount = account.name
        item.publishAccountId = account.id
        const tagHint = Array.isArray(payload.tags) && payload.tags.length
          ? '，话题 ' + payload.tags.map((t) => '#' + t).join(' ')
          : ''
        this.addLog('info', '发布', item.title + '：作品标题留空，不代填' + tagHint)
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
            item.status = statusBefore === '已发布' ? '已发布' : '审核通过'
            item.publishFailAt = formatTime(new Date())
            item.publishFailReason = result?.message || '没有放进上传页'
            this.noteCartFull(account, item.publishFailReason)
            this.endTask(taskId, item.publishFailReason, 'failed')
            this.addLog('warning', '发布', `${item.title}：${item.publishFailReason}`)
            continue
          }
          item.lastPublishClicked = Boolean(result.published)
          if (result.published) posted += 1
          if (result.published) {
            item.status = '已发布'
            item.publishedAt = formatTime(new Date())
            item.finishedAt = item.publishedAt
            // 即使勾了删原片，也保留 videoPath，避免「我的作品」变成暂无成片
            if (result.deleted) item.sourceDeleted = true
            this.notifyWebhook(`【huang++pro】已发布：${item.title}`)
          } else {
            // 没点到抖音「发布」：原先已发布的保持已发布，方便再点一次；其余回到已审核给定时任务
            item.status = statusBefore === '已发布' ? '已发布' : '审核通过'
          }
          this.endTask(taskId, result.message || '发布流程已走完')
          this.addLog(result.published ? 'success' : 'warning', '发布', result.message || `${item.title} 已打开上传页`)
        } catch (error) {
          item.status = statusBefore === '已发布' ? '已发布' : '审核通过'
          const message = /could not be cloned|An object could not be cloned/i.test(String(error?.message || error))
            ? '发布参数序列化失败，已重试修复；请再点一次立即执行'
            : (error.message || '发布中断')
          item.publishFailAt = formatTime(new Date())
          item.publishFailReason = message
          this.noteCartFull(account, message)
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
    async republishWork(workId) {
      const work = this.works.find((item) => item.id === workId)
      if (!work) return '没有找到这条作品'
      if (!work.videoPath) return '这条没有成片，不能再发布'
      if (!window.tujian?.publishWork) return '请在桌面窗口里发布'
      const account = this.publishAccounts.find((item) => item.id === work.publishAccountId)
        || this.publishAccounts.find((item) => item.enabled)
        || this.publishAccounts[0]
      if (!account) return '先添加一个发布账号'
      this.addLog('info', '发布', `再发布「${work.title}」，上次状态是 ${work.status}`)
      await this.publishWorksBatch([work], account)
      return work.lastPublishClicked ? '' : '已再次打开上传页，但没有确认点到「发布」。作品仍可再点一次'
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
        this.ensureWorkNumbers()
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
      // 关掉再打开：只续上还在生成的原对话，不重新发送提示词
      const interrupted = this.works.filter((item) => item.status === '生成中' && !item.videoPath)
      interrupted.forEach((work) => {
        const chargedDay = stampDay(work.quotaChargedAt || work.createdAt)
        work.quotaPending = chargedDay === todayKey()
        work.quotaCharged = work.quotaPending
        if (!work.doubaoChatUrl) {
          this.addLog('info', '豆包', `「${work.title}」仍是生成中，没有对话链接，不会重新发送`)
          return
        }
        this.addLog('info', '任务', `续传「${work.title}」（接着原来的豆包对话等成片，不重新生成）`)
        setTimeout(() => this.resumeOneDoubaoWork(work.id), 800)
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
        work.status = '生成中'
        work.failReason = result?.message || '原对话还没出成片，不重新发送'
        this.addLog('info', '豆包', `「${work.title}」${work.failReason}`)
        this.persist()
        work.resumeTries = (work.resumeTries || 0) + 1
        if (work.resumeTries < 6) {
          setTimeout(() => {
            if (work.status === '生成中' && !work.videoPath) this.resumeOneDoubaoWork(work.id)
          }, 120 * 1000)
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
    pushReloginNotice({ accountKind, accountId, accountName, scope, text }) {
      if (!Array.isArray(this.inbox)) this.inbox = []
      const key = `${accountKind}:${accountId}:${scope || ''}`
      if (this.inbox.some((item) => item.key === key && !item.done)) return
      this.inbox.unshift({
        id: uid('MSG'),
        key,
        accountKind,
        accountId,
        accountName: accountName || '',
        scope: scope || '',
        title: '需要重新登录',
        text,
        read: false,
        done: false,
        createdAt: formatTime(new Date())
      })
    },
    clearReloginNotice(accountKind, accountId, scope) {
      const key = `${accountKind}:${accountId}:${scope || ''}`
      let changed = false
      for (const item of this.inbox || []) {
        if (item.key === key && !item.done) {
          item.done = true
          item.read = true
          changed = true
        }
      }
      return changed
    },
    async patrolAccountLogins() {
      if (!window.tujian?.accountStatus) return '请在桌面窗口里检测登录'
      let auto = 0
      let pending = 0
      for (const account of this.doubaoAccounts || []) {
        if (account.enabled === false) continue
        let st = { loginStatus: '待登录' }
        try {
          st = await window.tujian.accountStatus({ kind: 'doubao', id: account.id })
        } catch { continue }
        account.loginStatus = st.loginStatus === '已登录' ? '已登录' : '待登录'
        if (account.loginStatus === '已登录') {
          this.clearReloginNotice('doubao', account.id, 'doubao')
          continue
        }
        if (account.loginMode === 'password' && window.tujian.silentPasswordLogin) {
          try {
            const result = await window.tujian.silentPasswordLogin({
              kind: 'doubao',
              id: account.id,
              name: account.name,
              login: account.login
            })
            if (result?.loginStatus === '已登录') {
              account.loginStatus = '已登录'
              auto += 1
              this.clearReloginNotice('doubao', account.id, 'doubao')
              this.addLog('info', '登录', `${account.name} 豆包已用保存的密码自动登录`)
              continue
            }
          } catch { /* 静默失败只记日志 */ }
          this.addLog('warning', '登录', `${account.name} 豆包自动登录未成功`)
          continue
        }
        this.pushReloginNotice({
          accountKind: 'doubao',
          accountId: account.id,
          accountName: account.name,
          scope: 'doubao',
          text: `${account.name} 的豆包需要重新登录，点「去登录」打开页面并发送验证码`
        })
        pending += 1
      }
      for (const account of this.publishAccounts || []) {
        if (account.enabled === false) continue
        let st = {}
        try {
          st = await window.tujian.accountStatus({ kind: 'publish', id: account.id })
        } catch { continue }
        account.buyinLoginStatus = st.buyinLoginStatus || (st.loginStatus === '已登录' ? '已登录' : '待登录')
        account.creatorLoginStatus = st.creatorLoginStatus || '待登录'
        account.loginStatus = account.buyinLoginStatus
        const passwordMode = account.loginMode === 'password'
        for (const scope of ['buyin', 'creator']) {
          const field = scope === 'buyin' ? 'buyinLoginStatus' : 'creatorLoginStatus'
          const label = scope === 'buyin' ? '达人工作台' : '抖音创作者'
          if (account[field] === '已登录') {
            this.clearReloginNotice('publish', account.id, scope)
            continue
          }
          if (passwordMode && window.tujian.silentPasswordLogin) {
            try {
              const result = await window.tujian.silentPasswordLogin({
                kind: 'publish',
                id: account.id,
                name: account.name,
                login: account.login,
                scope
              })
              const ok = scope === 'creator'
                ? result?.creatorLoginStatus === '已登录' || result?.loginStatus === '已登录'
                : result?.buyinLoginStatus === '已登录' || result?.loginStatus === '已登录'
              if (ok) {
                account[field] = '已登录'
                if (scope === 'buyin') account.loginStatus = '已登录'
                auto += 1
                this.clearReloginNotice('publish', account.id, scope)
                this.addLog('info', '登录', `${account.name} ${label}已用保存的密码自动登录`)
                continue
              }
            } catch { /* ignore */ }
            this.addLog('warning', '登录', `${account.name} ${label}自动登录未成功`)
            continue
          }
          this.pushReloginNotice({
            accountKind: 'publish',
            accountId: account.id,
            accountName: account.name,
            scope,
            text: `${account.name} 的${label}登录已过期，点「去登录」扫码`
          })
          pending += 1
        }
      }
      this.persist()
      return `登录巡检完成：自动登录 ${auto} 个，待扫码 ${pending} 条。扫码的在「消息」里点去登录`
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
    resolveSchedulePage(task) {
      if (!Array.isArray(task?.picks)) return null
      const page = blankPublishPage(this.settings.publishPage?.dyDelay)
      let claimSpecified = false
      const turnOn = (key) => {
        if (!key) return
        page[key] = true
        if (String(key).startsWith('claim')) claimSpecified = true
      }
      task.picks.forEach((pick) => {
        const text = String(pick || '')
        if (text.startsWith('opt:')) turnOn(text.slice(4))
        if (text.startsWith('flow:')) {
          const flow = (this.rpaFlows || []).find((item) => item.id === text.slice(5))
          ;(flow?.options || []).forEach((key) => turnOn(key))
        }
      })
      if (!claimSpecified) page.claimDoubao = true
      return page
    },
    scheduleFlows(task) {
      return (Array.isArray(task?.picks) ? task.picks : [])
        .map((pick) => (this.rpaFlows || []).find((item) => item.id === String(pick || '').replace(/^flow:/, '') && String(pick).startsWith('flow:')))
        .filter(Boolean)
    },
    async runRpaFlow(flow, { account, work, page } = {}) {
      const acc = account || this.publishAccounts.find((item) => item.enabled !== false) || this.publishAccounts[0]
      if (!flow) return { ok: false, message: '没有找到这条流程' }
      if (!acc) return { ok: false, message: '先添加一个发布账号' }
      if (!window.tujian?.openAccount) return { ok: false, message: '请在桌面窗口里执行' }
      const target = work || this.works.find((item) => item.status === '审核通过' && item.videoPath)
        || this.works.find((item) => item.videoPath && ['已生成', '发布中'].includes(item.status))
      let stopped = ''
      let didPublish = false
      for (const step of flow.steps || []) {
        this.addLog('info', 'RPA', `${flow.name} · ${step}`)
        if (/打开|环境/.test(step)) {
          const opened = await window.tujian.openAccount({
            kind: 'publish',
            id: acc.id,
            name: acc.name,
            login: acc.login,
            mode: acc.loginMode || 'password',
            url: 'https://creator.douyin.com/creator-micro/content/upload'
          })
          acc.loginStatus = opened?.loginStatus || acc.loginStatus
          if (!opened?.ok) {
            stopped = opened?.message || '发布页没有打开'
            break
          }
        } else if (/登录/.test(step)) {
          const status = await window.tujian.accountStatus?.({ kind: 'publish', id: acc.id })
          acc.loginStatus = status?.loginStatus || acc.loginStatus
          if (acc.loginStatus !== '已登录') {
            stopped = '这个账号还没登录。请在打开的窗口里登录后再执行。'
            break
          }
        } else if (/上传|文案|挂购物车|提交发布|发布/.test(step)) {
          if (didPublish) continue
          if (!target?.videoPath) {
            stopped = '没有审核通过的成片'
            break
          }
          const payload = this.buildPublishPayload(target, acc, page)
          const published = await window.tujian.publishWork(payload)
          didPublish = true
          if (published?.loginStatus) acc.loginStatus = published.loginStatus
          if (!published?.ok) {
            stopped = published?.message || '成片没有放进上传页'
            break
          }
          target.publishAccount = acc.name
          target.publishAccountId = acc.id
          target.publishTitle = payload.title
          target.publishTags = payload.tags
          if (published.published) {
            target.status = '已发布'
            target.publishedAt = formatTime(new Date())
            if (published.deleted) target.sourceDeleted = true
            this.notifyWebhook(`【huang++pro】已发布：${target.title}`)
          } else if (/提交发布|挂购物车/.test(step)) {
            target.status = '发布中'
            stopped = published.message || '成片已放进上传页，发布按钮没有点成功'
            break
          } else {
            target.status = '发布中'
          }
        } else {
          this.addLog('info', 'RPA', `${flow.name}：步骤「${step}」没有内置动作，已跳过`)
        }
      }
      flow.lastRun = formatTime(new Date())
      this.persist()
      if (stopped) {
        this.addLog('warning', 'RPA', `${flow.name} 停在：${stopped}`)
        return { ok: false, message: stopped, published: false }
      }
      this.addLog('success', 'RPA', `${flow.name} 已在发布账号窗口里执行`)
      return { ok: true, message: `${flow.name} 已执行`, published: target?.status === '已发布' }
    },
    runDueSchedules() {
      if (this.settings.localScheduleOn === false) return
      const now = this.systemNow ? new Date(this.systemNow) : new Date()
      if (Number.isNaN(now.getTime())) return
      const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      const day = formatTime(now).slice(0, 10)
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
        if (task.mode === '单次' && task.date && task.date !== day) return
        if (task.mode !== '单次' && task.date && task.date !== day) return
        const cycle = task.cycle || 'day'
        if (task.mode !== '单次' && cycle === 'week') {
          const today = now.getDay() === 0 ? 7 : now.getDay()
          const days = (Array.isArray(task.weekdays) ? task.weekdays : []).map((item) => Number(item))
          if (!days.includes(today)) return
        }
        if (task.mode !== '单次' && cycle === 'month') {
          const monthDay = Number(task.monthDay) || 0
          if (!monthDay || now.getDate() !== monthDay) return
        }
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
    schedulePublishAccounts(task) {
      const names = Array.isArray(task?.accounts) && task.accounts.length
        ? task.accounts.map((item) => String(item || '').trim()).filter(Boolean)
        : String(task?.account || '').split(/[、,，]/).map((item) => item.trim()).filter(Boolean)
      const enabled = this.publishAccounts.filter((item) => item.enabled !== false)
      if (!names.length) return enabled
      return enabled.filter((item) => names.includes(item.name) || names.includes(item.id))
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
      if (task.type === '登录巡检') {
        const message = await this.patrolAccountLogins()
        task.lastRun = stamp
        task.lastSuccessDay = stamp.slice(0, 10)
        this.persist()
        this.endTask(taskId, message)
        this.addLog('info', '定时', `${task.name}：${message}`)
        return message
      }
      if (task.type === '审核通过后发布' || task.type === '发布队列' || !task.type) {
        const pageOverride = this.resolveSchedulePage(task)
        const ready = this.works.filter((item) => {
          if (!item?.videoPath || !['审核通过', '发布中'].includes(item.status)) return false
          return this.workMatchesClaim(item, pageOverride || undefined)
        })
        const accounts = this.schedulePublishAccounts(task)
        const namedFlows = this.scheduleFlows(task)
        task.lastRun = stamp
        this.persist()
        if (!ready.length) {
          const message = `${task.name}：${when}，${this.explainNoPublishReady()}`
          this.endTask(taskId, message)
          this.addLog('info', '定时', message)
          return message
        }
        if (!accounts.length || !window.tujian?.publishWork) {
          const message = `${task.name}：有 ${ready.length} 条可发布，但没有勾选发布账号或没在桌面窗口里运行`
          this.endTask(taskId, message, 'failed')
          this.addLog('warning', '定时', message)
          return message
        }
        if (!immediate && task.lastLoginFailAt && Date.now() - Number(task.lastLoginFailAt) < 30 * 60 * 1000) {
          const message = `${task.name}：距上次发布未成功不足 30 分钟，暂不拉起抖音。登录创作者后可点「立即执行」`
          this.endTask(taskId, message)
          this.addLog('info', '定时', message)
          return message
        }
        const buckets = accounts.map(() => [])
        ready.forEach((work, index) => {
          const preferred = accounts.findIndex((item) => item.id === work.publishAccountId || item.name === work.publishAccount)
          buckets[preferred >= 0 ? preferred : index % accounts.length].push(work)
        })
        let posted = 0
        let blocked = 0
        for (let index = 0; index < accounts.length; index += 1) {
          const account = accounts[index]
          const batch = buckets[index]
          if (!batch.length) continue
          try {
            if (window.tujian?.ensurePublishLogin) {
              const ensured = await window.tujian.ensurePublishLogin({
                id: account.id,
                name: account.name,
                login: account.login,
                mode: account.loginMode || 'qr',
                url: 'https://creator.douyin.com/creator-micro/content/upload',
                cookieOnly: true
              })
              if (ensured?.loginStatus) account.loginStatus = ensured.loginStatus
              if (ensured?.creatorLoginStatus) account.creatorLoginStatus = ensured.creatorLoginStatus
              if (!ensured?.ok) {
                blocked += 1
                this.addLog('warning', '定时', `${account.name}：${ensured?.message || '创作者未登录'}`)
                continue
              }
            }
          } catch (error) {
            blocked += 1
            this.addLog('warning', '定时', `${account.name}：检查登录态失败 ${error.message || ''}`)
            continue
          }
          if (namedFlows.length) {
            for (const item of batch) {
              const result = await this.runRpaFlow(namedFlows[0], { account, work: item, page: pageOverride })
              if (result?.published || item.status === '已发布' || item.status === '发布中') posted += result?.ok ? 1 : 0
            }
          } else {
            posted += await this.publishWorksBatch(batch, account, pageOverride)
          }
        }
        if (posted > 0) {
          task.lastSuccessDay = stamp.slice(0, 10)
          task.lastLoginFailAt = 0
          if (task.mode === '单次') task.enabled = false
        } else {
          task.lastLoginFailAt = Date.now()
        }
        this.persist()
        const names = accounts.map((item) => item.name).join('、')
        const message = posted
          ? `${task.name} 已用 ${names} 发布 ${posted} 条`
          : `${task.name}：${when}，${names} 没有发出成片${blocked ? '，有账号未登录' : ''}。已暂停自动拉页 30 分钟`
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
    noteCartFull(account, message) {
      if (!account || !/购物车已满|挂车已满|商品数量已达上限/.test(String(message || ''))) return
      account.cartFull = true
      account.cartFullAt = formatTime(new Date())
    },
    syncDoubaoStats() {
      const today = todayKey()
      this.doubaoAccounts.forEach((account) => {
        if (account.quotaDate && account.quotaDate !== today) account.quotaDate = ''
        const limit = quotaLimit(account)
        account.quotaLimit = limit
        const mine = this.works.filter((work) => work.doubaoAccountId === account.id || work.doubaoAccount === account.name)
        const done = mine.filter((work) => work.videoPath || ['已生成', '审核通过', '发布中', '已发布'].includes(work.status))
        const failed = mine.filter((work) => work.failReason && !work.videoPath && work.status !== '生成中')
        const used = doubaoQuotaUsed(this.works, account, today)
        account.quota = `${used}/${limit}`
        const latest = done.slice().sort((a, b) => String(b.finishedAt || '').localeCompare(String(a.finishedAt || '')))[0]
        account.recent = latest ? `${latest.title} · ${latest.finishedAt}` : `成功 ${done.length} · 失败 ${failed.length}`
        account.successCount = done.length
        account.failCount = failed.length
      })
      this.publishAccounts.forEach((account) => {
        if (account.cartFull && stampDay(account.cartFullAt) !== today) account.cartFull = false
        const publishedToday = this.works.filter((work) => work.publishAccountId === account.id && work.status === '已发布' && stampDay(work.publishedAt || work.finishedAt) === today).length
        account.todayPublishDay = today
        account.todayPublish = publishedToday
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
      this.promptVisible = true
      Promise.all((ids || []).map((id) => this.enrichProduct(id))).catch(() => {})
    },
    applyProgress({ workId, progress, status, videoPath, confirmSent, confirmNeeded, confirmNote, doubaoChatUrl, optimizedTitle, optimizedTags }) {
      const work = this.works.find((item) => item.id === workId)
      if (!work) return
      if (progress != null) work.progress = progress
      if (status) work.status = status
      if (videoPath) work.videoPath = videoPath
      if (doubaoChatUrl && /doubao\.com\/chat\/[^/?#]+/i.test(doubaoChatUrl)) work.doubaoChatUrl = doubaoChatUrl
      if (optimizedTitle) work.optimizedTitle = String(optimizedTitle).slice(0, 30)
      if (Array.isArray(optimizedTags) && optimizedTags.length) {
        work.optimizedTags = optimizedTags.map((tag) => String(tag || '').replace(/^#/, '').trim()).filter(Boolean).slice(0, 5)
      }
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
    promptFitsProduct(text, product) {
      const body = String(text || '')
      if (!body.trim()) return false
      if (/\{\{title\}\}|商品标题/.test(body)) return true
      const title = String(product?.title || '').trim()
      const others = this.products.filter((item) => item.id !== product?.id && String(item.title || '').trim().length >= 4 && body.includes(item.title))
      if (others.length) return false
      if (title && body.includes(title)) return true
      return !title
    },
    promptForProduct(form, product) {
      const others = (this.products || []).map((item) => item.title).filter((item) => item && item !== product?.title)
      const packed = { ...form, otherTitles: [...(form?.otherTitles || []), ...others] }
      const shared = String(form?.promptText || '').trim()
      if (shared) return composePrompt(packed, product)
      const own = String(product?.filledPrompt || '').trim()
      if (own && this.promptFitsProduct(own, product)) return fillTemplate(own, product, others)
      const template = String(this.settings.promptText || '').trim()
      if (template) return composePrompt({ ...packed, promptText: template }, product)
      const rebuilt = composePrompt({
        ...packed,
        voice: form?.voice || this.settings.voice,
        promptText: '',
        lockText: form?.lockText || this.settings.productLock,
        storyline: form?.storyline || this.settings.storyline,
        caption: form?.caption || this.settings.caption,
        script: form?.script || this.settings.oral,
        compliance: form?.compliance || this.settings.compliance
      }, product)
      if (String(rebuilt || '').trim()) return rebuilt
      return composePrompt({
        ...packed,
        promptText: '围绕商品「商品标题」生成一条 9:16 抖音带货视频。只按上传的这件商品原图实拍口播，不要换成其他商品。直接生成视频。',
        duration: form?.duration,
        ratio: form?.ratio || '9:16',
        model: form?.model,
        voice: form?.voice || this.settings.voice
      }, product)
    },
    productImagesOf(product) {
      const removed = new Set(product?.removedImages || [])
      return [...new Set([...(product?.images || []), product?.image]
        .map((item) => String(item || '').trim())
        .filter((item) => item && !removed.has(item) && keepProductImage(item))
        .map((item) => (item.startsWith('//') ? `https:${item}` : item)))]
    },
    productShots(work) {
      const product = this.products.find((item) => item.id === work?.productId)
      const removed = new Set(product?.removedImages || [])
      const pool = [...(product?.images || []), product?.image, ...(work?.images || []), work?.image]
      return [...new Set(pool
        .map((item) => {
          const text = String(item || '').trim()
          if (!text || removed.has(text) || text.startsWith('blob:') || text.startsWith('data:') || !keepProductImage(text)) return ''
          return text.startsWith('//') ? `https:${text}` : text
        })
        .filter(Boolean))]
    },
    async enrichProduct(productId) {
      const product = this.products.find((item) => item.id === productId)
      if (!product || !window.tujian?.lookupProduct) return product
      const current = this.productImagesOf(product)
      const placeholder = /^商品 |^导入商品 /.test(String(product.title || ''))
      if (current.length >= MIN_PRODUCT_SHOTS && !placeholder) {
        product.images = current
        product.image = current[0] || ''
        return product
      }
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
        const removed = new Set(product.removedImages || [])
        const images = [...new Set([...(looked.images || []), looked.image, ...(product.images || []), product.image]
          .map((item) => String(item || '').trim())
          .filter((item) => item && !removed.has(item) && keepProductImage(item)))]
        if (looked.title && !/^商品 |^导入商品 /.test(looked.title)) {
          const cleaned = cleanTitle(looked.title, this.settings.bannedWords)
          product.rawTitle = cleaned.changed ? looked.title : (product.rawTitle || '')
          product.title = cleaned.title
          product.bannedHits = cleaned.hits
        }
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
      const storedPrompt = work.prompt || product?.filledPrompt || template?.promptText || this.settings.promptText || ''
      const prompt = product && this.promptFitsProduct(storedPrompt, product)
        ? storedPrompt
        : this.promptForProduct({
          promptText: template?.promptText || this.settings.promptText || '',
          model: work.model || template?.model || this.settings.model,
          duration: work.duration || template?.duration || this.settings.duration,
          ratio: work.ratio || template?.ratio || this.settings.ratio,
          lockText: work.lockText,
          storyline: work.storyline,
          caption: work.caption,
          script: work.script,
          compliance: work.compliance,
          voice: work.voice || this.settings.voice
        }, product || { title: work.title })
      const voiced = withVoice(prompt, work.voice || this.settings.voice)
      if (!String(voiced || '').trim()) {
        this.addLog('error', '豆包', `「${work.title}」没有提示词，重新生成已取消`)
        return '这条商品还没有提示词。先在设置或确认框里写好提示词'
      }
      if (!images.length) {
        this.addLog('error', '豆包', `「${work.title}」没有商品图，重新生成已取消`)
        return '这条商品没有照片。请先同步选品/补图，提示词和图片必须一起发'
      }
      work.images = images
      work.image = images[0]
      work.prompt = voiced
      work.videoPath = ''
      work.doubaoChatUrl = ''
      work.publishAccountId = ''
      work.publishAccount = ''
      work.failReason = ''
      work.progress = 5
      work.doubaoSlot = 'acct'
      work.status = '待生成'
      for (let i = generatePending.length - 1; i >= 0; i -= 1) {
        if (generatePending[i] === workId) generatePending.splice(i, 1)
      }
      const account = this.pickIdleDoubaoAccount()
      if (!account) {
        this.addLog('error', '豆包', '没有空闲且还有额度的豆包账号。这条已排到当前这条成片保存之后')
        this.kickGenerate(workId, { immediate: true, force: true })
        return '这个豆包号正在做上一条，成片保存后会在同一个窗口里接着做'
      }
      work.doubaoAccountId = account.id
      work.doubaoAccount = account.name
      busyDoubao.delete(account.id)
      this.persist()
      this.addLog('info', '豆包', `重新生成「${work.title}」，使用 ${account.name} 的同一个窗口`)
      this.kickGenerate(workId, { immediate: true, force: true })
      return ''
    },
    kickGenerate(workId, options = {}) {
      if (options.force) generateForce = true
      const pending = generatePending.filter((id) => id !== workId)
      if (options.immediate || options.force) pending.unshift(workId)
      else pending.push(workId)
      generatePending.length = 0
      generatePending.push(...pending)
      this.pumpGenerate({ immediate: Boolean(options.immediate || options.force), force: generateForce })
    },
    explainDoubaoQueue() {
      const account = this.doubaoAccount()
      const today = todayKey()
      const used = account ? doubaoQuotaUsed(this.works, account, today) : 0
      const limit = account ? quotaLimit(account) : 5
      if (generatePending.length && account && used >= limit) return `这个豆包号今天的 ${limit} 条额度用完了，图片和提示词没有发送`
      if (generatePending.length && account && doubaoRunning.has(account.id)) return '豆包窗口正在处理上一条，这几条会紧接着发送图片和提示词'
      if (generatePending.length) return '图片和提示词没有发送。先确认豆包账号已登录，并且今天还有额度'
      return '正在打开豆包，并发送图片和提示词'
    },
    pickIdleDoubaoAccount(skipped = [], options = {}) {
      const force = Boolean(options.force)
      const today = todayKey()
      const accounts = (this.doubaoAccounts || []).filter((item) => {
        if (!item.enabled || skipped.includes(item.id) || doubaoRunning.has(item.id)) return false
        if (!force) {
          const used = doubaoQuotaUsed(this.works, item, today)
          if (used >= quotaLimit(item)) return false
          if (item.quotaDate && item.quotaDate === today) return false
          const generating = this.works.filter((row) => row.doubaoAccountId === item.id && row.status === '生成中').length
          if (generating >= 5) return false
        }
        return true
      }).sort((a, b) => {
        const load = (id) => this.works.filter((row) => row.doubaoAccountId === id && row.quotaPending && row.status === '生成中').length
        return load(a.id) - load(b.id)
      })
      return accounts.find((item) => item.loginStatus === '已登录') || accounts[0] || null
    },
    pickWatchDoubaoAccount() {
      const now = Date.now()
      const accounts = (this.doubaoAccounts || []).filter((item) => {
        if (!item.enabled || doubaoRunning.has(item.id)) return false
        if ((doubaoWatchAfter.get(item.id) || 0) > now) return false
        return this.works.some((row) => row.doubaoAccountId === item.id && row.status === '生成中' && row.doubaoChatUrl)
      })
      return accounts[0] || null
    },
    pumpGenerate(options = {}) {
      this.releaseStuckGenerations()
      const force = Boolean(options.force) || generateForce
      if (generateActive > 0 && !doubaoRunning.size) generateActive = 0
      if (force) {
        for (const id of [...doubaoRunning]) {
          if (Date.now() - (doubaoRunningAt.get(id) || 0) < 180000) continue
          doubaoRunning.delete(id)
          doubaoRunningAt.delete(id)
          generateActive = Math.max(0, generateActive - 1)
          this.addLog('warning', '豆包', '上一批卡住了，已重新打开窗口继续发送')
        }
      }
      const today = todayKey()
      ;(this.doubaoAccounts || []).forEach((item) => {
        if (item.quotaDate === today && doubaoQuotaUsed(this.works, item, today) < quotaLimit(item)) item.quotaDate = ''
      })
      const configured = Math.max(1, Math.min(10, Number(this.settings.doubaoOpen) || 1))
      const idleCount = (this.doubaoAccounts || []).filter((item) => {
        if (!item.enabled || doubaoRunning.has(item.id)) return false
        if (!force) {
          const used = doubaoQuotaUsed(this.works, item, today)
          if (used >= quotaLimit(item)) return false
          if (item.quotaDate && item.quotaDate === today) return false
          const generating = this.works.filter((row) => row.doubaoAccountId === item.id && row.status === '生成中').length
          if (generating >= 5) return false
        }
        return true
      }).length
      const needed = Math.ceil(generatePending.length / 5)
      const limit = Math.min(10, Math.max(configured, Math.min(Math.max(idleCount, force ? 1 : 0), needed || configured)))
      while (generateActive < limit) {
        if (generatePending.length) {
          const account = this.pickIdleDoubaoAccount([], { force })
          if (account) {
            const generating = this.works.filter((row) => row.doubaoAccountId === account.id && row.status === '生成中').length
            const quotaLeft = quotaLimit(account) - doubaoQuotaUsed(this.works, account, today)
            const room = force ? Math.min(5, generatePending.length) : Math.min(5 - generating, quotaLeft)
            if (room > 0) {
              const ids = []
              while (ids.length < room && generatePending.length) ids.push(generatePending.shift())
              if (ids.length) {
                this.launchDoubaoBatch(ids, account.id, false, options)
                continue
              }
            }
          }
        }
        const watchAccount = this.pickWatchDoubaoAccount()
        if (watchAccount) {
          const ids = this.works.filter((row) => row.doubaoAccountId === watchAccount.id && row.status === '生成中' && row.doubaoChatUrl).slice(0, 5).map((row) => row.id)
          this.launchDoubaoBatch(ids, watchAccount.id, true, options)
          continue
        }
        break
      }
      if (generatePending.length && !this.pickIdleDoubaoAccount([], { force }) && !this.pickWatchDoubaoAccount() && Date.now() - lastQueueNote > 60000) {
        lastQueueNote = Date.now()
        this.addLog('warning', '豆包', `还有 ${generatePending.length} 条在排队。每个号最多同时挂 5 条，额度用完后要等明天或换一个豆包号。`)
      }
    },
    releaseStuckGenerations() {
      this.works.forEach((work) => {
        if (work.status !== '生成中' || work.doubaoChatUrl || work.videoPath) return
        if (work.doubaoAccountId && doubaoRunning.has(work.doubaoAccountId)) return
        if (generatePending.includes(work.id)) return
        work.status = '待生成'
        work.failReason = ''
        if (work.quotaPending) releaseWorkQuota(work)
      })
    },
    launchDoubaoBatch(workIds, accountId, watch, options = {}) {
      doubaoRunning.add(accountId)
      doubaoRunningAt.set(accountId, Date.now())
      generateActive += 1
      const gap = options.immediate || watch ? 0 : Math.max(0, Number(this.settings.doubaoGap) || 0) * 1000
      const now = Date.now()
      const at = gap ? Math.max(now, nextDoubaoLaunch) : now
      nextDoubaoLaunch = at + (gap || 0)
      const delay = Math.max(0, at - now)
      options.immediate = false
      this.addLog('info', '豆包', watch ? '正在检查已挂上的任务' : `开始发送 ${workIds.length} 条图片和提示词`)
      Promise.resolve()
        .then(() => (delay ? new Promise((resolve) => setTimeout(resolve, delay)) : null))
        .then(() => this.runDoubaoBatch(workIds, accountId, watch))
        .catch((error) => this.addLog('error', '豆包', error.message || '生成中断'))
        .finally(() => {
          doubaoRunning.delete(accountId)
          doubaoRunningAt.delete(accountId)
          generateActive = Math.max(0, generateActive - 1)
          if (!generatePending.length) generateForce = false
          this.pumpGenerate({ force: generateForce })
        })
    },
    async runDoubaoBatch(workIds, accountId, watch = false) {
      const account = (this.doubaoAccounts || []).find((item) => item.id === accountId)
      const works = (workIds || []).map((id) => this.works.find((item) => item.id === id)).filter(Boolean)
      if (!account || !works.length) return
      if (!window.tujian?.generateDoubao) {
        works.forEach((work) => {
          if (watch) return
          work.status = '生成失败'
          work.failReason = '请在桌面窗口里用网页版豆包生成'
        })
        this.addLog('warning', '豆包', '请在桌面窗口里用网页版豆包生成')
        this.persist()
        return
      }
      ensureDoubaoRules(this.settings)
      const jobs = []
      const taskIds = new Map()
      for (const work of works) {
        if (!watch && this.isWorkCancelled(work.id)) {
          cancelledWorks.delete(String(work.id))
          work.status = '待生成'
          work.failReason = '已在任务中心手动结束'
          continue
        }
        const product = this.products.find((item) => item.id === work.productId)
        const storedPrompt = work.prompt || product?.filledPrompt || ''
        const prompt = product && this.promptFitsProduct(storedPrompt, product)
          ? storedPrompt
          : this.promptForProduct({
            promptText: this.settings.promptText,
            lockText: work.lockText,
            storyline: work.storyline,
            caption: work.caption,
            script: work.script,
            compliance: work.compliance,
            duration: work.duration,
            ratio: work.ratio,
            model: work.model,
            voice: work.voice || this.settings.voice
          }, product || { title: work.title })
        const voiced = withVoice(
          `${prompt || storedPrompt}\n\n只根据本条上传的商品图生成，编号${work.no || work.id}，不要沿用上一条对话或上一条视频的画面。`,
          work.voice || this.settings.voice
        )
        const removed = new Set(product?.removedImages || [])
        const shots = this.productShots(work)
        const fallbackShots = shots.length
          ? shots
          : [...new Set([...(work.images || []), work.image]
            .map((item) => String(item || '').trim())
            .filter((item) => item && !removed.has(item) && (/^https?:\/\//i.test(item) || item.startsWith('//') || /^file:/i.test(item) || /^local-video:/i.test(item) || /^[a-zA-Z]:[\\/]/.test(item)))
            .map((item) => (item.startsWith('//') ? `https:${item}` : item)))]
        if (!watch) {
          if (!String(voiced || '').trim() || !fallbackShots.length) {
            work.status = '生成失败'
            work.failReason = !String(voiced || '').trim() ? '提示词是空的。提示词和图片必须一起发' : '没有商品图。提示词和图片必须一起发'
            this.addLog('warning', '豆包', `「${work.title}」${work.failReason}`)
            continue
          }
          work.prompt = voiced
          work.images = fallbackShots.slice(0, 12)
          work.image = fallbackShots[0]
          if (!work.no) work.no = this.nextWorkNo()
          work.status = '生成中'
          work.progress = 10
          work.failReason = ''
          work.confirmNote = ''
          work.doubaoAccount = account.name
          work.doubaoAccountId = account.id
          work.doubaoSlot = 'acct'
          chargeWorkQuota(work)
        }
        jobs.push({
          workId: work.id,
          prompt: voiced,
          images: fallbackShots.slice(0, 12),
          chatUrl: work.doubaoChatUrl || ''
        })
        taskIds.set(work.id, this.beginTask({
          kind: '生成',
          title: work.title,
          workId: work.id,
          accountId: account.id,
          note: watch ? '检查已分配的任务' : '正在挂新工作任务'
        }))
      }
      if (!jobs.length) {
        this.persist()
        return
      }
      account.worker = '生成中'
      this.syncDoubaoStats()
      this.addLog('info', '豆包', watch
        ? `${account.name} 正在检查这个窗口里的 ${jobs.length} 条任务`
        : `${account.name} 开 1 个窗口，挂 ${jobs.length} 条新工作任务（每个窗口最多 5 条）`)
      this.persist()
      let result
      try {
        result = await window.tujian.generateDoubao(toPlain({
          id: account.id,
          name: account.name,
          login: account.login,
          mode: account.loginMode || 'password',
          slot: 'acct',
          saveDir: this.settings.outputDir,
          watch,
          jobs,
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
        }))
      } catch (error) {
        const message = /could not be cloned/i.test(String(error?.message || error))
          ? '参数无法传给桌面进程，请再点一次开始生成'
          : (error.message || '生成中断')
        jobs.forEach((job) => {
          const work = works.find((item) => item.id === job.workId)
          if (!work || watch) return
          work.status = '生成失败'
          releaseWorkQuota(work)
          work.failReason = message
          this.endTask(taskIds.get(work.id), message, 'failed')
        })
        this.addLog('error', '豆包', message)
        this.persist()
        return
      }
      const rows = Array.isArray(result?.results) ? result.results : []
      let stillRunning = false
      for (const job of jobs) {
        const work = works.find((item) => item.id === job.workId)
        if (!work) continue
        if (this.isWorkCancelled(work.id)) {
          cancelledWorks.delete(String(work.id))
          if (!watch) releaseWorkQuota(work)
          work.status = '待生成'
          work.failReason = '已在任务中心手动结束'
          this.endTask(taskIds.get(work.id), work.failReason, 'cancelled')
          continue
        }
        const row = rows.find((item) => item.workId === work.id) || { outcome: 'failed', message: result?.message || '没有返回这条任务的结果' }
        this.finishDoubaoTask(work, account, row, taskIds.get(work.id), watch)
        if (work.status === '生成中') stillRunning = true
      }
      if (stillRunning) doubaoWatchAfter.set(account.id, Date.now() + 20000)
      else doubaoWatchAfter.delete(account.id)
      const still = this.works.some((item) => item.doubaoAccountId === account.id && item.status === '生成中')
      if (!still) account.worker = '空闲'
      this.syncDoubaoStats()
      this.persist()
    },
    finishDoubaoTask(work, account, row, taskId, watch) {
      if (row.doubaoChatUrl) work.doubaoChatUrl = row.doubaoChatUrl
      work.confirmNeeded = Boolean(row.confirmNeeded)
      work.confirmSent = Boolean(row.confirmSent)
      if (row.confirmNote) work.confirmNote = row.confirmNote
      if (row.outcome === 'success' && row.videoPath) {
        work.videoPath = row.videoPath
        work.status = '已生成'
        work.progress = 100
        work.generatedAt = formatTime(new Date())
        work.finishedAt = work.generatedAt
        work.failReason = ''
        keepWorkQuota(work)
        this.doneNotice = `${work.title}视频生成完成`
        this.endTask(taskId, '成片已保存（已去水印）')
        this.addLog('success', '豆包', `「${work.title}」生成成功，已自动去掉水印，保存在 ${row.videoPath}`)
        this.notifyWebhook(`【huang++pro】生成完成：${work.title}`)
        return
      }
      if (row.outcome === 'quota') {
        releaseWorkQuota(work)
        account.quotaDate = todayKey()
        work.status = '待生成'
        work.failReason = '这个豆包号额度不够，已改排'
        this.endTask(taskId, work.failReason)
        if (!generatePending.includes(work.id)) generatePending.unshift(work.id)
        this.addLog('warning', '豆包', `${account.name} ${work.failReason}`)
        return
      }
      if (row.outcome === 'failed') {
        releaseWorkQuota(work)
        work.status = '生成失败'
        work.progress = 0
        work.failReason = row.message || '这条任务生成失败'
        this.endTask(taskId, work.failReason, 'failed')
        this.addLog('warning', '豆包', `「${work.title}」${work.failReason}`)
        return
      }
      work.status = '生成中'
      work.confirmNote = row.confirmNote || (row.confirmNeeded ? '这条任务还要确定' : '生成中')
      this.endTask(taskId, work.confirmNote)
      this.addLog(row.confirmNeeded && !row.confirmSent ? 'warning' : 'info', '豆包', `「${work.title}」${work.confirmNote}`)
    },
    async runDoubao(workId, skipped = [], forcedAccountId = '') {
      const work = this.works.find((item) => item.id === workId)
      if (!work) return
      if (this.isWorkCancelled(workId)) {
        cancelledWorks.delete(String(workId))
        work.status = '待生成'
        work.failReason = '已在任务中心手动结束'
        this.persist()
        return
      }
      const today = todayKey()
      const accounts = this.doubaoAccounts.filter((item) => {
        if (!item.enabled || (item.quotaDate && item.quotaDate === today) || skipped.includes(item.id)) return false
        if (forcedAccountId && item.id !== forcedAccountId) return false
        return doubaoQuotaUsed(this.works, item, today) < quotaLimit(item)
      }).sort((a, b) => {
        const load = (id) => this.works.filter((row) => row.doubaoAccountId === id && row.quotaPending && row.status === '生成中').length
        return load(a.id) - load(b.id)
      })
      const account = accounts.find((item) => item.loginStatus === '已登录') || accounts[0]
      if (!account) {
        work.status = '待生成'
        work.failReason = skipped.length ? '豆包账号额度都不够，生成已停' : '先添加并登录一个豆包账号'
        this.addLog('warning', '豆包', work.failReason)
        this.persist()
        return
      }
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
      const storedPrompt = work.prompt || product?.filledPrompt || ''
      const prompt = product && this.promptFitsProduct(storedPrompt, product)
        ? storedPrompt
        : this.promptForProduct({
          promptText: this.settings.promptText,
          lockText: work.lockText,
          storyline: work.storyline,
          caption: work.caption,
          script: work.script,
          compliance: work.compliance,
          duration: work.duration,
          ratio: work.ratio,
          model: work.model,
          voice: work.voice || this.settings.voice
        }, product || { title: work.title })
      const voiced = withVoice(prompt, work.voice || this.settings.voice)
      if (voiced) work.prompt = voiced
      if (!window.tujian?.generateDoubao) {
        work.status = '生成失败'
        work.failReason = '请在桌面窗口里用网页版豆包生成'
        account.worker = '空闲'
        this.endTask(taskId, work.failReason, 'failed')
        this.addLog('warning', '豆包', work.failReason)
        this.persist()
        return
      }
      if (!String(voiced || '').trim()) {
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
      if (!work.no) work.no = this.nextWorkNo()
      const sourceCopy = this.sourceCopy(work)
      work.sourceTitle = sourceCopy.title
      work.sourceTags = sourceCopy.tags
      const slot = 'acct'
      work.doubaoSlot = slot
      chargeWorkQuota(work)
      this.syncDoubaoStats()
      this.addLog('info', '豆包', `${account.name} 正在打开豆包，发送提示词和 ${shots.length} 张商品图（额度先占 1，失败会退回）`)
      ensureDoubaoRules(this.settings)
      const payload = plainGeneratePayload({
        account,
        prompt: voiced,
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
        },
        copyNo: work.no,
        copyTitle: sourceCopy.title,
        copyTags: sourceCopy.tags
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
        releaseWorkQuota(work)
        work.status = '待生成'
        work.failReason = '已在任务中心手动结束'
        this.endTask(taskId, work.failReason, 'cancelled')
        this.syncDoubaoStats()
        this.persist()
        return
      }
      if (result?.loginStatus) account.loginStatus = result.loginStatus
      if (result?.optimizedTitle) work.optimizedTitle = result.optimizedTitle
      if (Array.isArray(result?.optimizedTags) && result.optimizedTags.length) work.optimizedTags = result.optimizedTags
      markConfirm(result)
      if (result?.quota) {
        releaseWorkQuota(work)
        account.quotaDate = today
        account.worker = '空闲'
        this.endTask(taskId, '额度不够，换号重试')
        this.syncDoubaoStats()
        this.addLog('warning', '豆包', `${account.name} 额度不够，这条改排到下一个还有额度的号`)
        work.status = '待生成'
        if (!generatePending.includes(workId)) generatePending.unshift(workId)
        this.persist()
        return
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
      if (chatUrl) work.doubaoChatUrl = chatUrl
      if (/关掉|被关/.test(String(result?.message || ''))) {
        work.status = '生成中'
        work.quotaPending = true
        work.quotaCharged = true
        work.quotaRefunded = false
        if (!work.quotaChargedAt) work.quotaChargedAt = formatTime(new Date())
        work.failReason = '软件或窗口关掉了，重新打开后会接着原来的生成，不会重发'
        account.worker = '生成中'
        this.endTask(taskId, work.failReason)
        this.addLog('info', '豆包', `「${work.title}」${work.failReason}`)
        this.persist()
        return
      }
      if (videoPath) {
        work.videoPath = videoPath
        if (chatUrl) work.doubaoChatUrl = chatUrl
        work.status = '已生成'
        work.progress = 100
        work.generatedAt = formatTime(new Date())
        work.finishedAt = work.generatedAt
        keepWorkQuota(work)
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
      releaseWorkQuota(work)
      work.failReason = result?.message || '网页版豆包没有返回视频'
      account.worker = '空闲'
      this.endTask(taskId, work.failReason, 'failed')
      this.syncDoubaoStats()
      this.addLog('warning', '豆包', work.failReason)
      this.persist()
      } catch (error) {
        work.status = '生成失败'
        work.progress = 0
        releaseWorkQuota(work)
        work.failReason = /could not be cloned/i.test(String(error?.message || error))
          ? '参数无法传给桌面进程，请再点一次重新生成'
          : (error.message || '生成中断')
        this.endTask(taskId, work.failReason, 'failed')
        this.addLog('error', '豆包', work.failReason)
        this.persist()
      } finally {
        busyDoubao.delete(account.id)
        const still = this.works.some((item) => item.id !== work.id && item.doubaoAccountId === account.id && item.quotaPending && item.status === '生成中')
        if (!still && account.worker === '生成中') account.worker = '空闲'
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
        if (product?.id && this.works.some((item) => item.productId === product.id && ['待生成', '生成中'].includes(item.status))) {
          this.addLog('info', '作品', `「${product.title}」已经在排队或生成中，不再重复加一条`)
          return
        }
        const picked = form.imagesByProduct?.[product?.id || '']
        const images = (Array.isArray(picked) ? picked : this.productImagesOf(product)).filter(Boolean)
        const work = {
          id: uid('W'),
          productId: product?.id || '',
          no: this.nextWorkNo(),
          title: product?.title || '未命名带货视频',
          hue: product?.hue ?? 210,
          status: '待生成',
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
          prompt: String(form.promptsByProduct?.[product?.id || ''] || '').trim() || this.promptForProduct(form, product),
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
      const ready = []
      created.forEach((id) => {
        const work = this.works.find((item) => item.id === id)
        if (!work) return
        work.doubaoSlot = 'acct'
        if (!String(work.prompt || '').trim()) {
          work.status = '生成失败'
          work.failReason = '提示词是空的。提示词和图片必须一起发'
          this.addLog('warning', '豆包', `「${work.title}」${work.failReason}`)
          return
        }
        if (!(work.images || []).length && !work.image) {
          work.status = '生成失败'
          work.failReason = '没有商品图。请先同步/导入完整商品，或在确认框里上传图片'
          this.addLog('warning', '豆包', `「${work.title}」${work.failReason}`)
          return
        }
        ready.push(id)
      })
      generateForce = true
      ready.forEach((id) => {
        if (!generatePending.includes(id)) generatePending.push(id)
      })
      if (account && ready.length) {
        if (doubaoRunning.has(account.id)) {
          this.addLog('info', '豆包', '上一批还在这个窗口里跑，这几条会排在后面，不会再发一遍')
        } else {
          const ids = []
          while (ids.length < 5 && generatePending.length) ids.push(generatePending.shift())
          if (ids.length) {
            try {
              this.launchDoubaoBatch(ids, account.id, false, { immediate: true, force: true })
            } catch (error) {
              this.addLog('error', '豆包', error.message || '打开豆包后没有发出图片和提示词')
            }
          }
        }
      }
      this.persist()
      this.queueOpen = true
      return created
    },
    async collectGeneratedDoubao() {
      const account = (this.doubaoAccounts || []).find((item) => item.enabled && item.loginStatus === '已登录')
        || (this.doubaoAccounts || []).find((item) => item.enabled)
        || null
      if (!account) return { ok: false, count: 0, message: '先添加并登录一个豆包账号' }
      if (!window.tujian?.collectDoubaoVideos) return { ok: false, count: 0, message: '请在桌面的 huang++pro 窗口里收录' }
      const known = (this.works || []).map((work) => {
        const matched = String(work.doubaoChatUrl || '').match(/chat\/([^/?#]+)/i)
        return matched ? matched[1] : ''
      }).filter(Boolean)
      let result
      try {
        result = await window.tujian.collectDoubaoVideos({
          id: account.id,
          name: account.name,
          login: account.login || '',
          mode: account.loginMode || 'password',
          known,
          saveDir: this.settings.outputDir
        })
      } catch (error) {
        return { ok: false, count: 0, message: error?.message || '收录失败' }
      }
      const videos = Array.isArray(result?.videos) ? result.videos : []
      let count = 0
      videos.forEach((item) => {
        if (!item?.videoPath) return
        if ((this.works || []).some((work) => work.videoPath === item.videoPath || (item.chatUrl && work.doubaoChatUrl === item.chatUrl))) return
        this.works.unshift({
          id: uid('W'),
          productId: '',
          no: this.nextWorkNo(),
          title: item.title || '豆包已生成视频',
          hue: 210,
          status: '已生成',
          progress: 100,
          model: '',
          duration: '',
          ratio: '9:16',
          voice: '',
          image: '',
          images: [],
          prompt: '',
          kind: 'AI',
          doubaoAccount: account.name,
          doubaoAccountId: account.id,
          doubaoChatUrl: item.chatUrl || '',
          videoPath: item.videoPath,
          failReason: '',
          createdAt: formatTime(new Date()),
          finishedAt: formatTime(new Date()),
          generatedAt: formatTime(new Date())
        })
        count += 1
      })
      if (count) this.addLog('success', '豆包', `一次收录了 ${count} 条豆包已生成的视频`)
      else this.addLog('info', '豆包', result?.message || '没有新的已生成视频')
      this.persist()
      return { ok: Boolean(result?.ok), count, message: count ? `已收录 ${count} 条豆包已生成的视频` : (result?.message || '这个豆包号里没有新的已生成视频') }
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
      product.removedImages = [...new Set([...(product.removedImages || []), ...removed])].filter((item) => !next.includes(item))
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
