const fs = require('fs')
const path = require('path')

let filePath = ''
let cache = null
let writeChain = Promise.resolve()
let pendingWrites = 0

function emptySettings() {
  return {
    outputDir: '',
    publishOpen: 2,
    publishGap: 8,
    doubaoOpen: 3,
    doubaoGap: 5,
    dailyCollectLimit: 40,
    collectStart: '08:00',
    collectedToday: 0,
    collectedDate: '',
    model: 'Seedance 2.0 Mini',
    duration: 12,
    ratio: '9:16',
    voice: '自然悦耳女声',
    productLock: '我现在是一个抖音千万级带货博主。请围绕商品「 商品标题 」，直接用 Seedance 2.0Mini 生成适配抖音平台 10 秒 9:16 竖屏高清短视频， 视频内容要严格遵守抖音社区规范，全程规避极限词、夸大功效词、违规承诺类话术，无敏感内容，无任何价格口播或者文字，要符合千川投流要求。',
    storyline: '黄金 3 秒强吸睛开场，一位普通气质女生自然上手体验，真实展示使用过程，呈现对产品的喜爱；中段镜头切换，聚焦刻画产品实物细节，搭配精致逼真图片特效，产品外观保持真实不失真，严格锁定产品原图样式。',
    caption: '核心卖点搭配科技感艺术字弹窗展示，只提炼可视化卖点，文字简洁醒目；整体画面自然真实流畅，无生硬 AI 感，创意有冲击力，开篇抓人，内容信息饱满不空洞。',
    oral: '配套带货向口播文案，选用悦耳自然女声配音，人声清晰可听见，口播音频融入视频，口播文案贴合画面节奏，只描述可直观看到的外观、使用感受、实物特点，不做功效夸大、效果保证。',
    compliance: '禁止违反生活常识、物理常识。禁止任何人脸、品牌商标、知名 IP、版权角色；视频画面、口播不提任何品牌名称，不添加无法实现的画面效果，不虚构效果；不使用绝对化极限词汇，不做疗效、承诺类表述；口播产品名称一定要清晰，不要混淆其他产品名称，整体风格贴近真实达人实拍，提升带货转化潜力。',
    douyinAppKey: '',
    douyinAppSecret: '',
    douyinAccessToken: '',
    douyinShopId: '',
    douyinShopName: '',
    plazaPageLimit: ''
  }
}

function emptySnapshot() {
  return {
    points: 0,
    publishNo: 1,
    groups: ['默认分组'],
    activeAccountId: '',
    products: [],
    plaza: [],
    works: [],
    doubaoAccounts: [],
    digitalHumans: [],
    publishAccounts: [],
    collectAccounts: [],
    schedules: [],
    rpaFlows: [
      { id: 'rpa01', name: '抖音发布', platform: '抖音', enabled: true, lastRun: '', steps: ['打开环境', '检查登录', '上传视频', '填写文案', '挂购物车', '提交发布'] },
      { id: 'rpa03', name: '登录检测', platform: '抖音', enabled: true, lastRun: '', steps: ['打开环境', '打开创作者中心', '读取登录状态', '写回账号列表'] }
    ],
    proxies: [],
    browsers: [],
    logs: [],
    settings: emptySettings()
  }
}

function init(userData) {
  filePath = path.join(userData, 'huang-data.json')
}

function normalizeSpace(space) {
  const snapshot = { ...emptySnapshot(), ...(space.snapshot || {}) }
  snapshot.settings = { ...emptySettings(), ...(snapshot.settings || {}) }
  snapshot.rpaFlows = (snapshot.rpaFlows || []).filter((item) => item.platform === '抖音')
  if (!snapshot.rpaFlows.length) snapshot.rpaFlows = emptySnapshot().rpaFlows
  return {
    snapshot,
    license: space.license || null,
    generatedLicenses: Array.isArray(space.generatedLicenses) ? space.generatedLicenses : []
  }
}

function readDb() {
  if (cache) return cache
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (!data || typeof data !== 'object') {
      cache = freshDb()
      return cache
    }
    if (!data.byUser) {
      cache = {
        version: 2,
        users: [],
        sessions: {},
        legacy: normalizeSpace(data),
        legacyUsed: false,
        byUser: {}
      }
      return cache
    }
    data.users = Array.isArray(data.users) ? data.users : []
    data.sessions = data.sessions || {}
    data.byUser = data.byUser || {}
    cache = data
    return cache
  } catch {
    cache = freshDb()
    return cache
  }
}

function freshDb() {
  return { version: 2, users: [], sessions: {}, legacy: null, legacyUsed: false, byUser: {} }
}

function writeDb(data) {
  cache = data
  pendingWrites += 1
  writeChain = writeChain.then(() => new Promise((resolve) => {
    setImmediate(() => {
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true })
        const tempPath = `${filePath}.tmp`
        fs.writeFileSync(tempPath, JSON.stringify(cache), 'utf8')
        fs.renameSync(tempPath, filePath)
      } catch (error) {
        console.error(error)
      }
      resolve()
    })
  })).finally(() => {
    pendingWrites -= 1
  })
}

function flushWrites() {
  return writeChain
}

function hasPendingWrite() {
  return pendingWrites > 0
}

function spaceFor(db, userId) {
  const current = db.byUser[userId]
  if (current?.normalized && current.snapshot) return current
  const initial = current || (db.legacy && !db.legacyUsed ? db.legacy : { snapshot: emptySnapshot(), license: null, generatedLicenses: [] })
  const space = normalizeSpace(initial)
  space.normalized = true
  db.byUser[userId] = space
  if (!current && db.legacy && !db.legacyUsed) db.legacyUsed = true
  return space
}

function userIdByToken(token) {
  if (!token) return ''
  const db = readDb()
  return db.sessions[token] || ''
}

module.exports = {
  init,
  readDb,
  writeDb,
  flushWrites,
  hasPendingWrite,
  spaceFor,
  userIdByToken,
  emptySnapshot,
  emptySettings
}
