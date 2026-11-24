const http = require('http')
const store = require('./store.cjs')
const license = require('./license.cjs')
const douyin = require('./douyin.cjs')
const auth = require('./auth.cjs')
const adminTokens = new Set()

function send(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS'
  })
  res.end(JSON.stringify(payload))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) } catch (error) { reject(error) }
    })
    req.on('error', reject)
  })
}

function tokenOf(req) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
}

function publicState(space, user) {
  return {
    ok: true,
    snapshot: space.snapshot,
    license: publicLicense(space.license),
    displayName: user?.displayName || '',
    generatedLicenses: space.generatedLicenses,
    userStatus: user?.status || '正常',
    systemNow: license.systemNow().toISOString()
  }
}

function publicLicense(item) {
  if (!item) return null
  const next = { ...item }
  if (next.permanent) next.code = ''
  return next
}

function accountRows(db) {
  return db.users.map((user) => {
    const space = db.byUser?.[user.id]
    const item = space?.license
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName || '',
      status: user.status || '正常',
      createdAt: user.createdAt || '',
      activatedAt: user.activatedAt || item?.activatedAt || '',
      licenseLabel: item?.unlocked ? (item.permanent ? '永久' : (item.label || '已授权')) : '未填写授权码'
    }
  })
}

function loadUser(req) {
  const db = store.readDb()
  const userId = db.sessions[tokenOf(req)]
  if (!userId) return null
  const space = store.spaceFor(db, userId)
  return { db, userId, space }
}

function parseAccounts(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split(/[,，|\t]/).map((item) => item.trim()).filter(Boolean)
    if (parts.length <= 1) return { name: parts[0], login: parts[0], password: '' }
    if (parts.length === 2) return { name: parts[0], login: parts[0], password: parts[1] }
    return { name: parts[0], login: parts[1], password: parts.slice(2).join(',') }
  })
}

function applyShopAuth(settings, captured) {
  if (!captured) return
  if (captured.appKey) settings.douyinAppKey = captured.appKey
  if (captured.appSecret) settings.douyinAppSecret = captured.appSecret
  if (captured.accessToken) settings.douyinAccessToken = captured.accessToken
  if (captured.shopId) settings.douyinShopId = captured.shopId
  if (captured.shopName) settings.douyinShopName = captured.shopName
}

let emitCatalog = () => {}
let plazaSaveTimer = null

function schedulePlazaSave(save) {
  clearTimeout(plazaSaveTimer)
  plazaSaveTimer = setTimeout(() => {
    plazaSaveTimer = null
    save()
  }, 1200)
}

function cancelPlazaSave() {
  clearTimeout(plazaSaveTimer)
  plazaSaveTimer = null
}

async function syncCatalog(space, body, save = () => {}) {
  const settings = space.snapshot.settings
  const accountId = String(body.accountId || space.snapshot.activeAccountId || '')
  const shop = require('./shopAuth.cjs')
  let captured = { products: [] }
  if (accountId) {
    let streamed = false
    try {
      captured = await shop.capture(accountId, body.target === 'plaza' ? 'plaza' : 'products', {
        pageLimit: settings.plazaPageLimit,
        onProducts: async (batch) => {
          if (body.target !== 'plaza' || !batch.length) return
          const reset = !streamed
          streamed = true
          const previous = space.snapshot.plaza.filter((row) => (row.accountId || '') === accountId)
          const others = space.snapshot.plaza.filter((row) => (row.accountId || '') !== accountId)
          const added = new Map(previous.map((row) => [row.id, row.added]))
          const base = reset ? [] : previous
          const seen = new Set(base.map((row) => row.id))
          const next = base.slice()
          const fresh = []
          batch.forEach((item) => {
            if (!item.id || seen.has(item.id)) return
            seen.add(item.id)
            const row = {
              ...item,
              accountId,
              added: Boolean(added.get(item.id)) || space.snapshot.products.some((product) => product.id === item.id && (product.accountId || '') === accountId)
            }
            next.push(row)
            fresh.push(row)
          })
          if (!fresh.length) return
          space.snapshot.plaza = others.concat(next)
          schedulePlazaSave(save)
          emitCatalog({ accountId, reset, products: fresh, count: next.length })
        }
      })
    } catch { captured = { products: [] } }
    applyShopAuth(settings, captured)
  }
  let result
  if (captured.products?.length) {
    result = { products: captured.products, total: captured.products.length }
  } else if (settings.douyinAppKey && settings.douyinAppSecret && settings.douyinAccessToken) {
    try {
      result = await douyin.listProducts({
        appKey: settings.douyinAppKey,
        appSecret: settings.douyinAppSecret,
        accessToken: settings.douyinAccessToken,
        page: Number(body.page) || 1,
        size: Number(body.size) || 20
      })
    } catch (error) {
      if (!captured.products?.length) throw error
      result = { products: captured.products, total: captured.products.length }
    }
  } else {
    const error = new Error(captured.message || '这个账号还没有扫码。扫一次达人工作台后，选品和广场都用这次登录。')
    error.status = 400
    error.logs = captured.logs || []
    throw error
  }
  const target = body.target === 'plaza' ? 'plaza' : 'products'
  const cleanTitle = (title) => {
    const banned = ['第一', '最牛', '最好', '最佳', '最强', '最低价', '最便宜', '唯一', '顶级', '极致', '万能', '史无前例', '国家级', '世界级', '绝对', '百分百', '100%', '百分之百', '根治', '治愈', '治疗', '疗效', '药效', '祖传', '药到病除', '包治', '专治', '抗癌', '防癌', '稳赚', '必赚', '躺赚', '保证赚钱', '无效退款', '包过', '加微信', '加我微信', '加V', '加v', '微信', 'VX', 'vx', '私信我', '扣群', 'QQ群', '淘口令', '复制口令', '小黄车', '点链接', '拍链接', '领链接']
    let text = String(title || '')
    const hits = []
    banned.sort((a, b) => b.length - a.length).forEach((word) => {
      if (!word || !text.includes(word)) return
      hits.push(word)
      text = text.split(word).join('')
    })
    text = text.replace(/\s{2,}/g, ' ').trim()
    return { title: text || String(title || '').trim(), hits, changed: hits.length > 0 }
  }
  if (target === 'products') {
    result.products.forEach((item) => {
      item.accountId = accountId
      const cleaned = cleanTitle(item.title)
      if (cleaned.changed) {
        item.rawTitle = item.title
        item.title = cleaned.title
        item.bannedHits = cleaned.hits
      }
      const index = space.snapshot.products.findIndex((row) => row.id === item.id && (row.accountId || '') === accountId)
      if (index >= 0) {
        space.snapshot.products[index] = { ...space.snapshot.products[index], ...item, scriptReady: space.snapshot.products[index].scriptReady }
      } else {
        space.snapshot.products.unshift(item)
      }
    })
  } else {
    const others = space.snapshot.plaza.filter((row) => (row.accountId || '') !== accountId)
    const mine = result.products.map((item) => {
      const cleaned = cleanTitle(item.title)
      return {
        ...item,
        accountId,
        title: cleaned.title,
        rawTitle: cleaned.changed ? item.title : (item.rawTitle || ''),
        bannedHits: cleaned.hits,
        added: space.snapshot.products.some((row) => row.id === item.id && (row.accountId || '') === accountId)
      }
    })
    space.snapshot.plaza = others.concat(mine)
  }
  return { ...result, logs: captured.logs || [], message: captured.message || '' }
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (req.method === 'OPTIONS') return send(res, 204, {})
  if (req.method === 'GET' && url.pathname === '/api/system-time') {
    return send(res, 200, { ok: true, systemNow: license.systemNow().toISOString() })
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/enter') {
    const db = store.readDb()
    const result = auth.enter(db)
    if (!result.ok) return send(res, 403, result)
    store.spaceFor(db, result.user.id)
    store.writeDb(db)
    return send(res, 200, { ok: true, token: result.token, user: result.user, systemNow: license.systemNow().toISOString() })
  }
  if (req.method === 'POST' && (url.pathname === '/api/auth/register' || url.pathname === '/api/auth/login')) {
    const body = await readBody(req)
    const db = store.readDb()
    const result = url.pathname.endsWith('register')
      ? auth.register(db, body.username, body.password)
      : auth.login(db, body.username, body.password)
    if (!result.ok) return send(res, 400, result)
    store.spaceFor(db, result.user.id)
    store.writeDb(db)
    return send(res, 200, { ok: true, token: result.token, user: result.user, systemNow: license.systemNow().toISOString() })
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const db = store.readDb()
    auth.logout(db, tokenOf(req))
    store.writeDb(db)
    return send(res, 200, { ok: true })
  }
  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    const loaded = loadUser(req)
    if (!loaded) return send(res, 401, { ok: false, message: '请先登录' })
    const user = loaded.db.users.find((item) => item.id === loaded.userId)
    return send(res, 200, { ok: true, user: { id: user.id, username: user.username, status: user.status || '正常', displayName: user.displayName || '' }, systemNow: license.systemNow().toISOString() })
  }

  const loaded = loadUser(req)
  if (!loaded) return send(res, 401, { ok: false, message: '请先登录' })
  const { db, space } = loaded
  const save = () => store.writeDb(db)

  if (req.method === 'GET' && url.pathname === '/api/state') {
    const user = db.users.find((item) => item.id === loaded.userId)
    return send(res, 200, publicState(space, user))
  }
  if (req.method === 'POST' && url.pathname === '/api/account/profile') {
    const body = await readBody(req)
    const name = String(body.displayName || '').trim()
    if (!name) return send(res, 400, { ok: false, message: '请填写使用用户' })
    if (name.length > 20) return send(res, 400, { ok: false, message: '使用用户不超过 20 个字' })
    const user = db.users.find((item) => item.id === loaded.userId)
    if (!user) return send(res, 404, { ok: false, message: '没有这个账号' })
    user.displayName = name
    save()
    return send(res, 200, { ok: true, displayName: name })
  }
  if (req.method === 'PUT' && url.pathname === '/api/state') {
    const body = await readBody(req)
    const snapshot = body.snapshot || body
    space.snapshot = {
      ...store.emptySnapshot(),
      ...snapshot,
      settings: { ...store.emptySettings(), ...(snapshot.settings || {}) }
    }
    space.snapshot.rpaFlows = (space.snapshot.rpaFlows || []).filter((item) => item.platform === '抖音')
    space.normalized = true
    save()
    return send(res, 200, { ok: true })
  }
  if (req.method === 'POST' && url.pathname === '/api/state/reset') {
    const settings = space.snapshot.settings
    const activeAccountId = space.snapshot.activeAccountId
    space.snapshot = store.emptySnapshot()
    space.snapshot.settings = settings
    space.snapshot.activeAccountId = activeAccountId
    save()
    return send(res, 200, publicState(space))
  }
  if (req.method === 'POST' && url.pathname === '/api/shop/auth') {
    const body = await readBody(req)
    const shop = require('./shopAuth.cjs')
    const accountId = String(body.accountId || space.snapshot.activeAccountId || '')
    const result = await shop.capture(accountId)
    applyShopAuth(space.snapshot.settings, result)
    save()
    return send(res, 200, { ...publicState(space), auth: result })
  }
  if (req.method === 'POST' && url.pathname === '/api/catalog/sync') {
    const body = await readBody(req)
    try {
      const result = await syncCatalog(space, body, save)
      cancelPlazaSave()
      save()
      return send(res, 200, { ...publicState(space), count: result.products.length, total: result.total, logs: result.logs || [], message: result.message || '' })
    } catch (error) {
      cancelPlazaSave()
      save()
      throw error
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/license/activate') {
    const body = await readBody(req)
    const now = license.systemNow()
    const result = license.activate(body.code, now)
    if (!result.ok) return send(res, 400, result)
    space.license = result.license
    const user = db.users.find((item) => item.id === loaded.userId)
    if (user) {
      user.activatedAt = now.toISOString()
      if (!user.status) user.status = '正常'
    }
    save()
    return send(res, 200, { ok: true, license: publicLicense(space.license), userStatus: user?.status || '正常', systemNow: now.toISOString() })
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/unlock') {
    const body = await readBody(req)
    if (String(body.password || '') !== 'admin') return send(res, 400, { ok: false, message: '管理密码不正确' })
    adminTokens.add(tokenOf(req))
    return send(res, 200, { ok: true, systemNow: license.systemNow().toISOString() })
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/lock') {
    adminTokens.delete(tokenOf(req))
    return send(res, 200, { ok: true })
  }
  if (req.method === 'POST' && url.pathname === '/api/license/configure') {
    if (!adminTokens.has(tokenOf(req))) return send(res, 403, { ok: false, message: '需要先进入管理' })
    const body = await readBody(req)
    const now = license.systemNow()
    const result = license.applyPlan(body.plan || 'permanent', now)
    if (!result.ok) return send(res, 400, result)
    space.license = result.license
    save()
    return send(res, 200, { ok: true, license: publicLicense(space.license), systemNow: now.toISOString() })
  }
  if (req.method === 'POST' && url.pathname === '/api/license/generate') {
    if (!adminTokens.has(tokenOf(req))) return send(res, 403, { ok: false, message: '需要先进入管理' })
    const body = await readBody(req)
    const result = license.generate(body.plan)
    if (!result.ok) return send(res, 400, result)
    result.createdAt = license.systemNow().toISOString()
    space.generatedLicenses.unshift(result)
    space.generatedLicenses = space.generatedLicenses.slice(0, 100)
    save()
    return send(res, 200, { ok: true, item: result, generatedLicenses: space.generatedLicenses, systemNow: license.systemNow().toISOString() })
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/accounts') {
    if (!adminTokens.has(tokenOf(req))) return send(res, 403, { ok: false, message: '需要先进入管理' })
    return send(res, 200, { ok: true, accounts: accountRows(db) })
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/accounts/status') {
    if (!adminTokens.has(tokenOf(req))) return send(res, 403, { ok: false, message: '需要先进入管理' })
    const body = await readBody(req)
    const status = body.status === '停用' ? '停用' : '正常'
    const user = db.users.find((item) => item.id === body.id)
    if (!user) return send(res, 404, { ok: false, message: '没有这个账号' })
    if (user.username === 'admin' && status === '停用') return send(res, 400, { ok: false, message: '管理员账号不能停用' })
    user.status = status
    save()
    return send(res, 200, { ok: true, accounts: accountRows(db) })
  }
  if (req.method === 'POST' && url.pathname === '/api/accounts/secret') {
    const body = await readBody(req)
    const secrets = require('./secrets.cjs')
    const id = String(body.id || '').trim()
    if (!id) return send(res, 400, { ok: false, message: '缺少账号' })
    if (body.remove) {
      secrets.remove(id)
      return send(res, 200, { ok: true })
    }
    if (!String(body.password || '').trim()) return send(res, 400, { ok: false, message: '请填写密码' })
    secrets.save(id, body.login, body.password)
    return send(res, 200, { ok: true })
  }
  if (req.method === 'POST' && url.pathname === '/api/accounts/batch') {
    const body = await readBody(req)
    const secrets = require('./secrets.cjs')
    const rows = parseAccounts(body.text)
    if (!rows.length) return send(res, 400, { ok: false, message: '没有解析到账号' })
    const list = body.kind === 'publish' ? space.snapshot.publishAccounts : space.snapshot.doubaoAccounts
    rows.forEach((row) => {
      const id = `${body.kind === 'publish' ? 'PB' : 'DB'}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
      if (row.password) secrets.save(id, row.login, row.password)
      if (body.kind === 'publish') {
        list.unshift({
          id, name: row.name, login: row.login, hasPassword: Boolean(row.password),
          enabled: true, accountId: row.login, phone: row.login, fans: '0', todayPublish: 0,
          group: space.snapshot.groups[0] || '默认分组', cart: true, loginStatus: '待登录',
          publishMode: '手动确认', fetchMode: '手动', createdAt: license.systemNow().toISOString().slice(0, 16).replace('T', ' ')
        })
      } else {
        list.unshift({
          id, name: row.name, login: row.login, hasPassword: Boolean(row.password),
          group: space.snapshot.groups[0] || '默认分组', quota: '0/5', enabled: true,
          loginStatus: '待登录', worker: '空闲', recent: '成功 0 · 失败 0',
          createdAt: license.systemNow().toISOString().slice(0, 16).replace('T', ' ')
        })
      }
    })
    save()
    return send(res, 200, { ...publicState(space), count: rows.length })
  }
  send(res, 404, { ok: false, message: '接口不存在' })
}

function start(port = 17321, emit) {
  if (typeof emit === 'function') emitCatalog = emit
  const db = store.readDb()
  if (auth.ensureAdmin(db)) store.writeDb(db)
  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      send(res, error.status || 500, { ok: false, message: error.message || '接口异常', logs: error.logs || [] })
    })
  })
  server.listen(port, '127.0.0.1')
  return server
}

module.exports = { start }
