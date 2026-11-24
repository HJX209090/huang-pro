const { app, BrowserWindow, net, session } = require('electron')
const fs = require('fs')
const http = require('http')
const https = require('https')
const path = require('path')
const secrets = require('./secrets.cjs')
const unwatermark = require('./doubaoUnwatermark.cjs')
const doubaoCaptcha = require('./doubaoCaptcha.cjs')
const media = require('./media.cjs')
const runtimeLog = require('./runtimeLog.cjs')

const URLS = {
  doubao: 'https://www.doubao.com/chat/',
  publish: 'https://buyin.jinritemai.com/dashboard'
}
const TITLES = {
  doubao: '豆包',
  publish: '达人工作台'
}
const windows = new Map()
let activeFailMarkers = []
let activeReplyRules = null
let activeRetryCopyright = []
let activeRetryBusy = []
const opening = new Map()
let proxyRules = ''

const DEFAULT_RETRY_COPYRIGHT = [
  '输入图片可能涉及版权限制，请更换后重试',
  '输入图片可能涉及版权限制',
  '生成的视频可能涉及版权限制，请更换输入内容后重试',
  '可能涉及版权限制',
  '由于版权相关限制',
  '请更换图片后再试',
  '请更换后重试',
  '请更换输入内容后重试'
]
const DEFAULT_RETRY_BUSY = [
  '当前视频仍在排队生成中',
  '暂时无法并行发起新的视频任务',
  '无法并行发起新的视频任务',
  '仍在排队生成中',
  '请先等待这条',
  '结果出来后我会立即同步'
]

function useProxy(proxy) {
  if (!proxy?.host || !proxy?.port) {
    proxyRules = ''
    return { ok: true, proxyRules: '' }
  }
  const scheme = /socks/i.test(String(proxy.type || '')) ? 'socks5' : 'http'
  proxyRules = `${scheme}://${proxy.host}:${Number(proxy.port)}`
  return { ok: true, proxyRules }
}

async function applyProxy(ses) {
  if (!ses) return
  if (!proxyRules) {
    await ses.setProxy({ mode: 'direct' }).catch(() => {})
    return
  }
  await ses.setProxy({ proxyRules }).catch(() => {})
}
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

function bringToFront(win) {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.moveTop()
  win.focus()
  win.setAlwaysOnTop(true)
  setTimeout(() => {
    if (!win.isDestroyed()) win.setAlwaysOnTop(false)
  }, 500)
}

function samePage(current, target) {
  try {
    const left = new URL(current)
    const right = new URL(target)
    return left.origin === right.origin && left.pathname.replace(/\/$/, '') === right.pathname.replace(/\/$/, '')
  } catch {
    return String(current || '').startsWith(String(target || ''))
  }
}

async function loadPage(win, url, { quiet = false } = {}) {
  if (!win || win.isDestroyed()) return false
  // 已在目标页：不刷新（定时发布反复 load 会刷屏、易掉登录）
  try {
    const current = String(win.webContents.getURL() || '')
    if (current && samePage(current, url)) {
      runtimeLog.info('nav', `已在目标页，跳过刷新 ${String(url).slice(0, 60)}`)
      return true
    }
  } catch { /* ignore */ }
  if (!quiet) bringToFront(win)
  win.webContents.setUserAgent(CHROME_UA)
  win.webContents.session.setUserAgent(CHROME_UA)
  const once = () => Promise.race([
    win.loadURL(url, { userAgent: CHROME_UA }),
    wait(20000).then(() => {
      if (!win.isDestroyed()) win.webContents.stop()
    })
  ])
  try {
    await once()
  } catch {
    if (win.isDestroyed()) return false
    await wait(800)
    if (win.isDestroyed()) return false
    try { await once() } catch { /* 窗口已经在前面，页面可以继续加载 */ }
  }
  if (!quiet) bringToFront(win)
  return !win.isDestroyed()
}

function isSessionCookie(name = '') {
  return /^(sessionid|sessionid_ss|sid_guard|uid_tt|uid_tt_ss|sid_tt|odin_tt|passport_auth_status|passport_auth_status_ss|SASID)$/i.test(String(name || ''))
    || /sessionid|sid_guard|uid_tt|sid_tt|passport_auth|odin_tt/i.test(String(name || ''))
}

function loggedIn(cookies, kind) {
  return cookies.some((item) => {
    const domain = item.domain || ''
    const name = item.name || ''
    if (kind === 'doubao') return /doubao|volces|bytedance|douyin/.test(domain) && isSessionCookie(name)
    return /douyin|jinritemai|bytedance|buyin/.test(domain) && isSessionCookie(name)
  })
}

/** 百应/精选联盟：jinritemai 域会话 */
function buyinLoggedIn(cookies) {
  return cookies.some((item) => {
    const domain = String(item.domain || '')
    return /jinritemai|buyin|bytedance/.test(domain) && isSessionCookie(item.name)
  }) || cookies.some((item) => /douyin/.test(String(item.domain || '')) && /^sessionid/i.test(String(item.name || '')))
}

/** 创作者中心：必须有 douyin 域通行证，不能拿百应 cookie 冒充 */
function creatorLoggedIn(cookies) {
  return cookies.some((item) => {
    const domain = String(item.domain || '')
    const name = String(item.name || '')
    return /douyin\.com/.test(domain) && /^(sessionid|sessionid_ss|sid_guard|uid_tt|sid_tt)$/i.test(name)
  })
}

const PASSPORT_COOKIE_NAMES = [
  'sessionid', 'sessionid_ss', 'sid_guard', 'sid_tt', 'uid_tt', 'uid_tt_ss',
  'odin_tt', 'ttwid', 'passport_csrf_token', 'passport_csrf_token_default',
  'passport_auth_status', 'passport_auth_status_ss', 'sid_ucp_v1', 'ssid_ucp_v1'
]

/** 把百应分区里的通行证 cookie 镜像到 .douyin.com，创作者中心才能免扫码 */
async function mirrorPassportCookies(ses) {
  if (!ses) return 0
  const cookies = await ses.cookies.get({}).catch(() => [])
  const auth = (cookies || []).filter((item) => {
    const name = String(item.name || '')
    if (PASSPORT_COOKIE_NAMES.includes(name)) return Boolean(item.value)
    return /^(sessionid|sid_guard|uid_tt|sid_tt|odin_tt|ttwid|passport_)/i.test(name) && Boolean(item.value)
  })
  if (!auth.length) return 0
  const targets = [
    { domain: '.douyin.com', url: 'https://www.douyin.com/' },
    { domain: '.jinritemai.com', url: 'https://www.jinritemai.com/' },
    { domain: 'creator.douyin.com', url: 'https://creator.douyin.com/' },
    { domain: '.bytedance.com', url: 'https://www.bytedance.com/' }
  ]
  let written = 0
  for (const cookie of auth) {
    for (const target of targets) {
      try {
        await ses.cookies.set({
          url: target.url,
          name: cookie.name,
          value: cookie.value,
          domain: target.domain,
          path: cookie.path || '/',
          secure: true,
          httpOnly: Boolean(cookie.httpOnly),
          expirationDate: cookie.expirationDate || (Math.floor(Date.now() / 1000) + 86400 * 30),
          sameSite: 'no_restriction'
        })
        written += 1
      } catch { /* 个别 cookie 域策略拒绝时跳过 */ }
    }
  }
  try { await ses.cookies.flushStore() } catch { /* ignore */ }
  return written
}

function creatorLoginWallScript() {
  return `(() => {
    const body = String(document.body?.innerText || '').replace(/\\s+/g, '')
    const href = String(location.href || '')
    if (/\\/pc\\/login|\\/login|passport\\/web\\/login|scan_login/i.test(href)) return 'wall'
    if (/我是创作者|我是MCN|打开抖音App|扫码登录/.test(body) && /获取验证码|密码登录|创作者中心/.test(body)) return 'wall'
    if (/上传视频|发布视频|作品管理|内容管理|发布作品|选择视频|填写作品标题|投稿/.test(body)) return 'ok'
    if (/creator-micro|content\\/upload|content\\/manage/i.test(href) && !/login/i.test(href)) return 'ok'
    return 'unknown'
  })()`
}

/**
 * 同浏览器会话进入创作者中心。
 * 重要：已登录时禁止 buyin→douyin→creator 连环跳转（会刷屏、冲登录态）。
 * 只在当前不在创作者页 / 出现登录墙时，才导航一次到目标上传页。
 */
async function bridgeBuyinToCreator(win, targetUrl, { quiet = false, forceNav = false } = {}) {
  if (!win || win.isDestroyed()) return { ok: false, bridged: false }
  const dest = targetUrl || 'https://creator.douyin.com/creator-micro/content/upload'
  const ses = win.webContents.session
  let cookies = await ses.cookies.get({}).catch(() => [])
  const hadCreator = creatorLoggedIn(cookies)
  const current = String(win.webContents.getURL() || '')
  const onCreator = /creator\.douyin\.com/i.test(current)
  let wall = onCreator
    ? await runInFrames(win, creatorLoginWallScript()).catch(() => 'unknown')
    : 'unknown'
  runtimeLog.info('sso.bridge', `探测 creatorCookie=${hadCreator} onCreator=${onCreator} wall=${wall} url=${current.slice(0, 60)}`)

  // 已在创作者且未登录墙：完全不刷新（定时反复探测也不会刷屏）
  if (!forceNav && hadCreator && onCreator && wall !== 'wall') {
    runtimeLog.info('sso.bridge', '已在创作者中心，跳过刷新')
    return {
      ok: true,
      bridged: false,
      wall: wall || 'ok',
      loginStatus: '已登录',
      sameBrowser: true,
      message: '已在创作者中心，未刷新页面'
    }
  }

  // 没有创作者 cookie：禁止自动跳转（否则会开登录墙、连环 SSO，易掉登录）
  if (!hadCreator && !forceNav) {
    runtimeLog.info('sso.bridge', '无创作者 cookie，跳过自动导航')
    return {
      ok: false,
      bridged: false,
      wall: onCreator ? wall : 'unknown',
      loginStatus: '待确认',
      sameBrowser: true,
      message: '创作者未登录。请先手动打开创作者中心登录一次；定时不会自动拉页'
    }
  }

  // 有会话或不在目标页：只跳一次目标上传页，绝不 buyin→www→creator 连环跳
  if (!samePage(current, dest)) {
    runtimeLog.info('sso.bridge', `单次进入 ${dest.slice(0, 80)}`)
    await loadPage(win, dest, { quiet })
    await wait(1200)
  }

  wall = await runInFrames(win, creatorLoginWallScript()).catch(() => 'unknown')
  cookies = await ses.cookies.get({}).catch(() => [])
  const ok = wall === 'ok' || (wall !== 'wall' && creatorLoggedIn(cookies))
  if (!ok && !quiet) bringToFront(win)
  runtimeLog.info('sso.bridge', `结束 wall=${wall || ''} ok=${ok}`)
  return {
    ok,
    bridged: true,
    wall,
    loginStatus: ok ? '已登录' : '待确认',
    sameBrowser: true,
    message: ok
      ? '已进入创作者中心'
      : '创作者未登录。请在本窗口扫一次抖音；登录后定时不会再反复刷新'
  }
}

async function accountStatus({ kind, id }) {
  const ses = session.fromPartition(`persist:huang-${kind}-${id}`)
  const cookies = await ses.cookies.get({}).catch(() => [])
  if (kind === 'publish') {
    const buyin = buyinLoggedIn(cookies)
    const creator = creatorLoggedIn(cookies)
    return {
      loginStatus: buyin ? '已登录' : '待登录',
      buyinLoginStatus: buyin ? '已登录' : '待登录',
      creatorLoginStatus: creator ? '已登录' : '待登录',
      cookieCount: cookies.length
    }
  }
  const ok = loggedIn(cookies, kind)
  return { loginStatus: ok ? '已登录' : '待登录', cookieCount: cookies.length }
}

/** 发布前确保达人分区已登录。cookieOnly=true 时只查 cookie，绝不拉起/刷新页面 */
async function ensurePublishLogin({ id, name, login, mode, url, captcha, cookieOnly }) {
  const ses = session.fromPartition(`persist:huang-publish-${id}`)
  const cookies = await ses.cookies.get({}).catch(() => [])
  const hasBuyin = buyinLoggedIn(cookies)
  const hasCreator = creatorLoggedIn(cookies)
  const wantCreator = String(url || '').includes('creator.douyin.com')

  // 定时任务预检：只看 cookie，禁止开窗刷新（否则会循环拉抖音）
  if (cookieOnly) {
    const ok = wantCreator ? hasCreator : (hasBuyin || hasCreator)
    return {
      ok,
      loginStatus: ok ? '已登录' : '待登录',
      reused: true,
      cookieOnly: true,
      message: ok
        ? (wantCreator ? '创作者 cookie 有效' : '达人 cookie 有效')
        : (wantCreator ? '创作者未登录（请先手动打开创作者中心登录一次）' : '达人未登录')
    }
  }

  if (hasBuyin || hasCreator) {
    // 已有会话：不再为了「热身」去连环跳转；真正发布时由 publishOnCreator 按需打开上传页
    if (wantCreator && hasCreator) {
      return { ok: true, loginStatus: '已登录', reused: true, message: '创作者登录态有效，无需刷新' }
    }
    if (!wantCreator && hasBuyin) {
      return { ok: true, loginStatus: '已登录', reused: true, message: '达人登录态有效，无需刷新' }
    }
    // 只要百应、没有创作者 cookie：不自动拉页，避免定时刷屏/掉登录
    if (wantCreator && hasBuyin && !hasCreator) {
      return {
        ok: false,
        loginStatus: '待确认',
        reused: true,
        message: '百应已登录，但创作者 cookie 还没有。请先手动点一次「创作者中心」登录，之后定时不再反复拉页'
      }
    }
    return { ok: true, loginStatus: '已登录', reused: true, message: '沿用账号登录态' }
  }
  const secret = secrets.read(id)
  const account = String(login || secret?.login || '').trim()
  const password = String(secret?.password || '').trim()
  const preferMode = password ? 'password' : (mode || 'qr')
  const opened = await openAccount({
    kind: 'publish',
    id,
    name,
    login: account,
    mode: preferMode,
    url: url || URLS.publish,
    already: false,
    captcha
  })
  if (opened?.loginStatus === '已登录') {
    return { ok: true, loginStatus: '已登录', reused: false, message: '登录态已刷新' }
  }
  if (password && preferMode === 'password') {
    const key = sessionKey('publish', id, url || URLS.publish)
    const win = windows.get(key) || [...windows.entries()].find(([k]) => k.startsWith(`publish:${id}`))?.[1]
    if (win && !win.isDestroyed()) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await runInFrames(win, clickTextScript(['密码登录', '账号登录']))
        await fillLogin(win, account, password)
        await wait(1200)
        const cookies = await win.webContents.session.cookies.get({})
        if (buyinLoggedIn(cookies) || creatorLoggedIn(cookies) || loggedIn(cookies, 'publish')) {
          return { ok: true, loginStatus: '已登录', reused: false, message: '已用保存的账密自动登录' }
        }
      }
    }
  }
  return {
    ok: false,
    loginStatus: opened?.loginStatus || '待登录',
    reused: false,
    message: password
      ? '登录态已过期，自动填密后仍未登录成功，请在打开的窗口里完成一次登录'
      : '登录态已过期。请编辑账号保存密码，或先扫码/验证码登录一次'
  }
}

function loginScript(login, password) {
  return `(() => {
    const login = ${JSON.stringify(String(login || ''))}
    const password = ${JSON.stringify(String(password || ''))}
    const compact = (value) => String(value || '').replace(/\\s+/g, '')
    const nodes = []
    const walk = (root) => {
      if (!root || !root.querySelectorAll) return
      root.querySelectorAll('input, button, [role="button"], a, span, div, li').forEach((el) => nodes.push(el))
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot) })
    }
    walk(document)
    const clickTab = (labels) => {
      const hit = nodes.find((el) => {
        const text = compact(el.innerText || el.textContent)
        if (!text || text.length > 10) return false
        const rect = el.getBoundingClientRect()
        if (!(rect.width > 20 && rect.height > 12)) return false
        return labels.some((label) => text === label || text.includes(label))
      })
      if (!hit) return false
      ;(hit.closest('button, [role="button"], a, li, div') || hit).click()
      return true
    }
    clickTab(['密码登录', '账号登录', '账密登录', '邮箱登录'])
    const inputs = nodes.filter((el) => el.tagName === 'INPUT' && !el.disabled && el.type !== 'hidden')
    const pass = inputs.find((el) => el.type === 'password')
      || inputs.find((el) => /密码|password/i.test((el.placeholder || '') + (el.name || '') + (el.getAttribute('aria-label') || '')))
    if (!pass) return 'no-form'
    const account = inputs.find((el) => {
      if (el === pass) return false
      const hint = ((el.placeholder || '') + (el.name || '') + (el.getAttribute('aria-label') || '')).toLowerCase()
      if (/验证码|code|search/.test(hint)) return false
      return ['text', 'tel', 'email', 'number'].includes(el.type) || /手机|账号|邮箱|账户|user|account|phone|mail/.test(hint)
    }) || inputs.find((el) => el !== pass && ['text', 'tel', 'email'].includes(el.type))
    const setValue = (el, value) => {
      if (!el) return
      el.focus()
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
      proto.set.call(el, value)
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      el.dispatchEvent(new Event('blur', { bubbles: true }))
    }
    if (account && login) setValue(account, login)
    if (password) setValue(pass, password)
    const button = nodes.find((el) => {
      const text = compact(el.innerText || el.textContent)
      if (!text || text.length > 8) return false
      if (!/^(登录|登陆|立即登录|确认登录)$/.test(text) && !/^登录|登陆/.test(text)) return false
      const rect = el.getBoundingClientRect()
      return rect.width > 40 && rect.height > 24
    })
    if (button) (button.closest('button, [role="button"]') || button).click()
    return 'filled'
  })()`
}

function framesOf(frame, list = []) {
  list.push(frame)
  for (const child of frame.frames || []) framesOf(child, list)
  return list
}

function clickTextScript(labels) {
  return `(() => {
    const labels = ${JSON.stringify(labels)}
    const nodes = Array.from(document.querySelectorAll('button, a, div, span, li, p'))
    const hits = nodes.filter((node) => {
      const text = (node.innerText || '').replace(/\\s+/g, '')
      return text && text.length <= 8 && labels.some((label) => text.includes(label))
    })
    hits.sort((a, b) => a.innerText.length - b.innerText.length)
    if (!hits[0]) return 'miss'
    hits[0].click()
    return 'clicked'
  })()`
}

function phoneScript(phone) {
  return `(() => {
    const phone = ${JSON.stringify(String(phone || '').replace(/\\D/g, '').slice(-11))}
    const compact = (value) => String(value || '').replace(/\\s+/g, '')
    const nodes = []
    const walk = (root) => {
      if (!root || !root.querySelectorAll) return
      root.querySelectorAll('input, button, [role="button"], a, span, div, label, p').forEach((el) => nodes.push(el))
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot) })
    }
    walk(document)
    nodes.filter((el) => el.tagName === 'INPUT' && el.type === 'checkbox' && !el.checked).forEach((el) => el.click())
    nodes.filter((el) => el.getAttribute && el.getAttribute('role') === 'checkbox' && el.getAttribute('aria-checked') === 'false').forEach((el) => el.click())
    const agree = nodes.find((el) => {
      const text = compact(el.innerText || el.textContent)
      return text.length > 0 && text.length <= 36 && /已阅读|同意.*协议|我已阅读/.test(text)
    })
    if (agree) (agree.closest('label, span, div') || agree).click()
    const clickTab = (labels) => {
      const hit = nodes.find((el) => {
        const text = compact(el.innerText || el.textContent)
        if (!text || text.length > 12) return false
        return labels.some((label) => text === label || text.includes(label))
      })
      if (!hit) return false
      ;(hit.closest('button, [role="button"], a, li, div') || hit).click()
      return true
    }
    clickTab(['验证码登录', '短信登录', '手机号登录', '验证码'])
    const inputs = nodes.filter((el) => el.tagName === 'INPUT' && !el.disabled && el.type !== 'hidden' && el.type !== 'password')
    const input = inputs.find((el) => {
      const hint = (el.placeholder || '') + (el.name || '') + (el.getAttribute('aria-label') || '')
      return /手机|电话|mobile|phone/i.test(hint) && !/验证码|密码|code/.test(hint)
    }) || inputs.find((el) => el.type === 'tel')
      || inputs.find((el) => {
        const hint = (el.placeholder || '') + (el.name || '')
        return ['text', 'number'].includes(el.type) && !/验证码|密码|code|搜索/.test(hint)
      })
    if (!input || !phone) return 'no-input'
    input.focus()
    const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
    proto.set.call(input, phone)
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: phone, inputType: 'insertText' }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.dispatchEvent(new Event('blur', { bubbles: true }))
    const send = nodes.find((el) => {
      const text = compact(el.innerText || el.textContent)
      if (!text || text.length > 12) return false
      return /获取验证码|发送验证码|获取短信|发送短信/.test(text)
    })
    if (!send) return 'typed'
    const button = send.closest('button, [role="button"], a') || send
    if (button.disabled || button.getAttribute('aria-disabled') === 'true') return 'wait'
    button.click()
    return 'sent'
  })()`
}

function codeScript(code) {
  return `(() => {
    const code = ${JSON.stringify(String(code || ''))}
    const inputs = Array.from(document.querySelectorAll('input'))
    const target = inputs.find((el) => /验证码/.test((el.placeholder || '') + (el.name || '') + (el.getAttribute('aria-label') || '')))
      || inputs.find((el) => el.maxLength === 4 || el.maxLength === 6)
    if (!target) return 'no-input'
    const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
    proto.set.call(target, code)
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
    const button = Array.from(document.querySelectorAll('button')).find((el) => {
      const text = (el.innerText || '').replace(/\\s+/g, '')
      return text.length <= 8 && /登录|登陆|确认|确定/.test(text)
    })
    if (button) button.click()
    return 'filled'
  })()`
}

async function runInFrames(win, script) {
  const score = {
    published: 6, title: 5, input: 5, pass: 5, zone: 4, picked: 5, sent: 5, clicked: 4, typed: 4, filled: 4, file: 4,
    recheck: 4, risk: 4, checking: 3, ready: 4, fail: 4, enter: 3, wait: 3, skip: 2, timeout: 2, partial: 2,
    'no-button': 2, 'no-input': 1, miss: 0
  }
  let best = 'miss'
  for (const frame of framesOf(win.webContents.mainFrame)) {
    try {
      const result = await frame.executeJavaScript(script)
      if ((score[result] || 0) > (score[best] || 0)) best = result
      if (best === 'published' || best === 'title' || best === 'input' || best === 'pass' || best === 'picked' || best === 'sent' || best === 'clicked' || best === 'filled' || best === 'file' || best === 'ready' || best === 'fail') return best
    } catch { /* 这个框架没有对应元素 */ }
  }
  return best
}

/** 在所有 frame 里跑脚本，返回第一个非空对象/真值结果（给坐标等非状态值用） */
async function evalInFrames(win, script) {
  if (!win || win.isDestroyed()) return null
  for (const frame of framesOf(win.webContents.mainFrame)) {
    try {
      const result = await frame.executeJavaScript(script)
      if (result != null && result !== false && result !== 'miss' && result !== '') return result
    } catch { /* 这个框架没有对应元素 */ }
  }
  return null
}

async function fillLogin(win, login, password) {
  const script = loginScript(login, password)
  let filled = false
  for (const frame of framesOf(win.webContents.mainFrame)) {
    try {
      const result = await frame.executeJavaScript(script)
      if (result === 'filled') filled = true
    } catch { /* 这个框架没有登录框 */ }
  }
  return filled ? 'filled' : 'no-form'
}

/** 反复切到密码登录并填写账密（百应/创作者通用） */
async function autoFillPasswordLogin(win, login, password, { times = 8 } = {}) {
  const account = String(login || '').trim()
  const pass = String(password || '').trim()
  if (!win || win.isDestroyed() || !account || !pass) return 'skip'
  runtimeLog.info('login.fill', `自动填账密 account=${account.slice(0, 3)}***`)
  for (let attempt = 0; attempt < times; attempt += 1) {
    if (win.isDestroyed()) return 'destroyed'
    await runInFrames(win, clickTextScript(['密码登录', '账号登录', '账密登录', '邮箱登录', '手机号登录']))
    await wait(500)
    const filled = await fillLogin(win, account, pass)
    if (filled === 'filled') {
      runtimeLog.success('login.fill', `第 ${attempt + 1} 次已填入账密并点登录`)
      return 'filled'
    }
    await wait(700)
  }
  runtimeLog.warn('login.fill', '未找到密码登录表单')
  return 'no-form'
}

/** 自动点登录 → 填手机号 → 下一步 → 发送验证码 */
async function autoSendPhoneCode(win, phone, { times = 10 } = {}) {
  const mobile = String(phone || '').replace(/\D/g, '').slice(-11)
  if (!win || win.isDestroyed() || mobile.length < 6) return 'skip'
  runtimeLog.info('login.sms', `自动填手机号 ${mobile.slice(0, 3)}****${mobile.slice(-4)}`)
  let last = 'miss'
  for (let attempt = 0; attempt < times; attempt += 1) {
    if (win.isDestroyed()) return 'destroyed'
    await runInFrames(win, clickTextScript(['登录', '立即登录', '手机号登录', '验证码登录', '短信登录']))
    await wait(500)
    last = await runInFrames(win, phoneScript(mobile))
    if (last === 'sent') {
      runtimeLog.success('login.sms', `第 ${attempt + 1} 次已发送验证码`)
      return 'sent'
    }
    // 豆包常见：先填手机号，再点「下一步」，下一屏才有「获取验证码」
    if (last === 'typed' || last === 'no-input' || last === 'wait') {
      await runInFrames(win, clickTextScript(['下一步', '获取验证码', '发送验证码', '登录', '继续']))
      await wait(900)
      const again = await runInFrames(win, phoneScript(mobile))
      if (again === 'sent') {
        runtimeLog.success('login.sms', `下一步后已发送验证码`)
        return 'sent'
      }
      const clicked = await runInFrames(win, clickTextScript(['获取验证码', '发送验证码', '重新获取']))
      if (clicked === 'clicked') {
        runtimeLog.success('login.sms', '已点击获取验证码')
        return 'sent'
      }
      if (again === 'typed' || again === 'wait') last = again
    }
    await wait(700)
  }
  runtimeLog.warn('login.sms', `发码未完成 last=${last}`)
  return last
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 关掉「下载豆包专业版」一类弹窗，避免挡住登录和对话 */
function dismissDoubaoPromoScript() {
  return `(() => {
    const compact = (value) => String(value || '').replace(/\\s+/g, '')
    const nodes = []
    const walk = (root) => {
      if (!root || !root.querySelectorAll) return
      root.querySelectorAll('button, [role="button"], a, div, span, i, svg').forEach((el) => nodes.push(el))
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot) })
    }
    walk(document)
    const promo = nodes.find((el) => {
      const text = compact(el.innerText || el.textContent)
      return text && text.length < 80 && /下载豆包专业版|豆包专业版|下载客户端|立即下载|体验专业版/.test(text)
    })
    if (!promo) return 'none'
    const root = promo.closest('[role="dialog"], [class*="modal"], [class*="dialog"], [class*="popup"], [class*="mask"]') || document.body
    const closer = Array.from(root.querySelectorAll('button, [role="button"], a, div, span, i')).find((el) => {
      const text = compact(el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '')
      const rect = el.getBoundingClientRect()
      if (!(rect.width > 8 && rect.height > 8 && rect.width < 160)) return false
      return /^(关闭|取消|暂不|以后再说|我知道了|跳过|×|✕)$/.test(text) || /close/i.test(String(el.className || ''))
    })
    if (closer) {
      ;(closer.closest('button, [role="button"], a') || closer).click()
      return 'closed'
    }
    const box = promo.closest('[role="dialog"], [class*="modal"], [class*="dialog"], [class*="popup"]')
    if (box) {
      box.style.display = 'none'
      const mask = box.parentElement
      if (mask && /mask|overlay|modal/i.test(String(mask.className || ''))) mask.style.display = 'none'
      return 'hidden'
    }
    return 'miss'
  })()`
}

async function dismissDoubaoPromo(win) {
  if (!win || win.isDestroyed()) return 'none'
  let last = 'none'
  for (let attempt = 0; attempt < 3; attempt += 1) {
    last = await runInFrames(win, dismissDoubaoPromoScript()).catch(() => 'none')
    if (last === 'closed' || last === 'hidden') {
      runtimeLog.info('doubao.promo', '已关闭下载专业版弹窗')
      return last
    }
    await wait(400)
  }
  return last
}

function attachDoubaoPromoGuard(win) {
  if (!win || win.isDestroyed() || win.__huangPromoGuard) return
  win.__huangPromoGuard = true
  const run = () => {
    if (!win.isDestroyed()) dismissDoubaoPromo(win).catch(() => {})
  }
  win.webContents.on('did-finish-load', run)
  win.webContents.on('did-navigate-in-page', run)
  setTimeout(run, 600)
  setTimeout(run, 1800)
}

async function fillPrompt(win, prompt) {
  const text = String(prompt || '').trim()
  if (!text) return 'miss'
  return runInFrames(win, `(() => {
    const text = ${JSON.stringify(text)}
    const boxes = []
    const walk = (root) => {
      if (!root || !root.querySelectorAll) return
      root.querySelectorAll('textarea, [contenteditable="true"]').forEach((el) => boxes.push(el))
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot) })
    }
    walk(document)
    const visible = boxes.filter((el) => {
      const rect = el.getBoundingClientRect()
      return rect.width > 40 && rect.height > 12
    })
    const box = visible[visible.length - 1] || boxes[boxes.length - 1]
    if (!box) return 'miss'
    box.focus()
    if (box.tagName === 'TEXTAREA') {
      const proto = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
      proto.set.call(box, text)
    } else {
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(box)
      selection.removeAllRanges()
      selection.addRange(range)
      document.execCommand('insertText', false, text)
      if (!(box.innerText || '').includes(text.slice(0, 8))) box.textContent = text
    }
    box.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
    box.dispatchEvent(new Event('change', { bubbles: true }))
    return 'filled'
  })()`)
}

function sessionKey(kind, id, url, slot) {
  // 达人百应 + 创作者中心必须同窗口同会话：publish 不再用 :creator 拆窗
  // （巨量会话≠抖音会话，但同一 Chromium partition/窗口才能单点互通）
  const extra = slot ? `:${String(slot).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)}` : ''
  return `${kind}:${id}${extra}`
}

/** 找这个发布账号已打开的主窗口（百应/创作者共用） */
function findPublishMainWindow(id) {
  const primary = windows.get(`publish:${id}`)
  if (primary && !primary.isDestroyed()) return primary
  for (const [key, win] of windows) {
    if (!key.startsWith(`publish:${id}`) || !win || win.isDestroyed()) continue
    if (/silent-lookup|lookup-|follow|creator-boot|buyin-silent/i.test(key)) continue
    return win
  }
  return null
}

async function openAccount(payload) {
  const key = sessionKey(payload?.kind || 'publish', payload?.id || '', payload?.url, payload?.slot)
  if (opening.has(key)) {
    await opening.get(key)
    const win = windows.get(key)
    if (!payload?.hidden) bringToFront(win)
    return { ok: Boolean(win && !win.isDestroyed()), loginStatus: '待确认', message: '' }
  }
  const job = openAccountNow(payload)
  opening.set(key, job)
  try {
    return await job
  } finally {
    opening.delete(key)
  }
}

async function watchCaptcha(win, captcha, notify) {
  if (!win || win.isDestroyed()) return { hit: false, cleared: true }
  try {
    return await doubaoCaptcha.waitGate(win, captcha || { enabled: true }, notify || (() => {}), { alreadyHit: false })
  } catch {
    return { hit: false, cleared: true }
  }
}

async function openAccountNow({ kind, id, name, mode, login, force, skipSend, already, url, prompt, slot, hidden, captcha }) {
  const quiet = Boolean(hidden)
  const key = sessionKey(kind, id, url, slot)
  const target = url || URLS[kind] || ''
  const onCreator = kind === 'publish' && target.includes('creator.douyin.com')
  // 发布账号：创作者必须复用达人主窗口，禁止另开一套浏览器会话
  let existing = windows.get(key)
  if ((!existing || existing.isDestroyed()) && kind === 'publish' && !slot && !quiet) {
    existing = findPublishMainWindow(id)
    if (existing && !existing.isDestroyed()) {
      windows.set(key, existing)
      runtimeLog.info('account.open', `复用同账号达人窗口进入 ${onCreator ? '创作者' : '页面'}`)
    }
  }
  if (existing && !existing.isDestroyed() && !force) {
    if (kind === 'doubao') attachDoubaoPromoGuard(existing)
    if (!quiet) bringToFront(existing)
    let cookies = await existing.webContents.session.cookies.get({})
    const onBuyin = target.includes('buyin.jinritemai.com')
    const hasBuyin = buyinLoggedIn(cookies)
    let hasCreator = creatorLoggedIn(cookies)
    const sessionOk = kind === 'doubao'
      ? loggedIn(cookies, kind)
      : (onCreator ? hasCreator : (hasBuyin || loggedIn(cookies, kind)))
    let direct = sessionOk || (Boolean(already) && !onCreator)
    if (onCreator) {
      // 用户手动打开才 forceNav；定时/静默只在有 cookie 时软跳一次
      const bridged = await bridgeBuyinToCreator(existing, target, { quiet, forceNav: !quiet && !already })
      cookies = await existing.webContents.session.cookies.get({})
      hasCreator = creatorLoggedIn(cookies) || bridged.ok
      direct = bridged.ok || hasCreator
      await applyProxy(existing.webContents.session)
      if (prompt) await fillPrompt(existing, prompt)
      if (!quiet && !direct) bringToFront(existing)
      return {
        ok: true,
        loginStatus: direct ? '已登录' : '待确认',
        direct,
        scope: 'creator',
        sameBrowser: true,
        message: bridged.message || (direct
          ? '已在同一浏览器会话打开创作者中心'
          : '请在本窗口扫抖音码（与达人同会话）；扫完后免二次扫码')
      }
    }
    if (url && !samePage(existing.webContents.getURL(), target)) {
      const opened = await loadPage(existing, url, { quiet })
      if (!opened) return { ok: false, loginStatus: direct ? '已登录' : '待确认', message: '页面没有打开，请再点一次' }
    }
    await applyProxy(existing.webContents.session)
    if (prompt) await fillPrompt(existing, prompt)
    // 未登录：主动填账密 / 发短信；扫码模式才点扫码
    if (!direct) {
      const secret = secrets.read(id)
      const account = String(login || secret?.login || '').trim()
      if (secret?.password && account && mode !== 'qr' && mode !== 'code') {
        await autoFillPasswordLogin(existing, account, secret.password, { times: 8 })
        await wait(1000)
        cookies = await existing.webContents.session.cookies.get({})
        direct = kind === 'doubao' ? loggedIn(cookies, kind) : (buyinLoggedIn(cookies) || creatorLoggedIn(cookies))
      } else if (mode === 'code' && account) {
        await autoSendPhoneCode(existing, account, { times: 8 })
      } else if (mode === 'qr') {
        await runInFrames(existing, clickTextScript(['扫码登录', '扫码']))
      }
    }
    if (kind === 'doubao' && !direct) await watchCaptcha(existing, captcha)
    const openedMessage = prompt
      ? '提示词已填进豆包，请生成 10 秒视频后把成片选回作品'
      : (direct ? '已进入达人工作台（与创作者共用同一浏览器会话）' : '已尝试自动填写登录信息，请在窗口确认')
    return { ok: true, loginStatus: direct ? '已登录' : '待确认', direct, scope: onBuyin ? 'buyin' : '', message: openedMessage }
  }
  if (existing && !existing.isDestroyed() && force) existing.close()
  const partition = `persist:huang-${kind}-${id}`
  const win = new BrowserWindow({
    width: quiet ? 1100 : 1200,
    height: quiet ? 800 : 860,
    show: !quiet,
    skipTaskbar: quiet,
    paintWhenInitiallyHidden: true,
    focusable: !quiet,
    title: quiet ? 'huang-lookup' : `${name || '账号'} · ${onCreator ? '达人/创作者' : (TITLES[kind] || TITLES.publish)}`,
    autoHideMenuBar: true,
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  windows.set(key, win)
  if (kind === 'doubao') attachDoubaoPromoGuard(win)
  if (quiet) hardenSilentWindow(win)
  if (!quiet) {
    const siblings = [...windows.keys()].filter((item) => item.startsWith(`${kind}:${id}`) && item !== key).length
    if (siblings) win.setPosition(80 + siblings * 36, 48 + siblings * 28)
  }
  win.on('closed', () => {
    if (windows.get(key) === win) windows.delete(key)
  })
  if (!quiet) bringToFront(win)
  const ses = win.webContents.session
  await applyProxy(ses)
  const opened = await loadPage(win, url || URLS[kind] || URLS.publish, { quiet })
  if (!opened) return { ok: false, loginStatus: '待确认', message: '页面没有打开，请再点一次' }
  if (prompt) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await wait(800)
      if (win.isDestroyed()) break
      const filled = await fillPrompt(win, prompt)
      if (filled === 'filled') break
    }
  }
  if (prompt && kind === 'doubao') {
    const ready = await ses.cookies.get({})
    return {
      ok: true,
      loginStatus: loggedIn(ready, kind) ? '已登录' : '待确认',
      message: '提示词已填进豆包，请生成 10 秒视频后把成片选回作品'
    }
  }
  let cookies = await ses.cookies.get({})
  const secret = secrets.read(id)
  const account = login || secret?.login || ''
  const method = mode || 'password'
  const onBuyin = (url || URLS[kind] || '').includes('buyin.jinritemai.com')
  let hasBuyin = buyinLoggedIn(cookies)
  let hasCreator = creatorLoggedIn(cookies)
  // 创作者只认 .douyin.com 会话；百应已登不能算创作者已登
  let sessionOk = kind === 'doubao'
    ? loggedIn(cookies, kind)
    : (onCreator ? hasCreator : (hasBuyin || loggedIn(cookies, kind)))
  if (onCreator) {
    const bridged = await bridgeBuyinToCreator(win, url || 'https://creator.douyin.com/creator-micro/content/upload', {
      quiet,
      forceNav: !quiet && !already
    })
    cookies = await ses.cookies.get({})
    hasCreator = creatorLoggedIn(cookies) || bridged.ok
    if (hasCreator) {
      return {
        ok: true,
        loginStatus: '已登录',
        direct: true,
        scope: 'creator',
        sameBrowser: true,
        message: bridged.message || '已在同一浏览器会话打开创作者中心'
      }
    }
    // 创作者登录墙：有账密就主动填（抖音创作账号密码）
    if (secret?.password && account && method !== 'qr') {
      await autoFillPasswordLogin(win, account, secret.password, { times: 10 })
      await wait(1500)
      cookies = await ses.cookies.get({})
      if (creatorLoggedIn(cookies)) {
        return { ok: true, loginStatus: '已登录', direct: true, scope: 'creator', sameBrowser: true, message: '已自动填写创作者账密并登录' }
      }
    }
    return {
      ok: true,
      loginStatus: '待确认',
      direct: false,
      scope: 'creator',
      sameBrowser: true,
      message: bridged.message || '请在本窗口扫抖音码或确认账密。达人与创作者必须同一浏览器；登录后免二次扫码'
    }
  }

  if (sessionOk) {
    return { ok: true, loginStatus: '已登录', direct: true, scope: onBuyin ? 'buyin' : '', message: onBuyin ? '已进入达人工作台（与创作者共用同一浏览器会话）' : '' }
  }

  // 未登录：优先自动填账密（新建发布账号的主路径）
  if (secret?.password && account && method !== 'qr' && method !== 'code') {
    await wait(800)
    await autoFillPasswordLogin(win, account, secret.password, { times: 10 })
    await wait(1500)
    if (kind === 'doubao') await watchCaptcha(win, captcha)
    cookies = await ses.cookies.get({})
    if (buyinLoggedIn(cookies) || loggedIn(cookies, kind)) {
      return { ok: true, loginStatus: '已登录', direct: true, scope: onBuyin ? 'buyin' : '', message: '已自动填写账号密码并登录' }
    }
    return {
      ok: true,
      loginStatus: '待确认',
      scope: onBuyin ? 'buyin' : '',
      message: '已尝试自动填写账号密码，请在窗口里确认登录（验证码/滑块需人工过一下）'
    }
  }

  if (method === 'code' && !skipSend) {
    return requestCode({ kind, id, name, login: account, captcha })
  }

  // 仅扫码模式才点扫码
  if (method === 'qr') {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await wait(800)
      const clicked = await runInFrames(win, clickTextScript(['扫码登录', '扫码']))
      if (clicked === 'clicked') break
    }
    if (kind === 'doubao') await watchCaptcha(win, captcha)
    return { ok: true, loginStatus: '待确认', message: '请用抖音 App 扫描窗口里的二维码。扫完后这个账号会记住登录。' }
  }

  cookies = await ses.cookies.get({})
  const signed = onBuyin ? buyinLoggedIn(cookies) : loggedIn(cookies, kind)
  return { ok: true, loginStatus: signed ? '已登录' : '待确认', scope: onBuyin ? 'buyin' : '', message: signed && onBuyin ? '已进入达人工作台（与创作者共用同一浏览器会话）' : '' }
}

async function requestCode({ kind, id, name, login, captcha }) {
  const current = await accountStatus({ kind, id })
  if (current.loginStatus === '已登录') {
    return { ok: true, direct: true, message: '这个账号已经登录，直接进入，不用再登录一次', loginStatus: '已登录' }
  }
  await openAccount({ kind, id, name, login, mode: 'code', skipSend: true, captcha })
  const win = windows.get(`${kind}:${id}`)
  if (!win || win.isDestroyed()) return { ok: false, message: '登录窗口没有打开', loginStatus: '待确认' }
  const account = String(login || secrets.read(id)?.login || '')
  if (!account) return { ok: false, message: '先填写手机号，验证码才会发到这台手机', loginStatus: '待确认' }
  let status = 'miss'
  for (let attempt = 0; attempt < 8 && status !== 'sent'; attempt += 1) {
    await runInFrames(win, clickTextScript(['验证码登录', '短信登录', '手机号登录']))
    status = await runInFrames(win, phoneScript(account))
    if (status === 'no-input') await runInFrames(win, clickTextScript(['登录', '立即登录']))
    if (status === 'sent' || status === 'wait') await watchCaptcha(win, captcha)
    if (status !== 'sent') await wait(900)
  }
  const messages = {
    sent: '已在网页上点击获取验证码，请查看手机短信。如果没收到，在打开的窗口里再点一次。',
    wait: '获取验证码按钮还不能点，请先在打开的窗口里勾选协议。',
    'no-button': '手机号已填入，页面上没有找到获取验证码。请在打开的窗口里切到验证码登录后再点。',
    'no-input': '登录框还没出来。请在打开的窗口里切到验证码登录。',
    miss: '页面还在加载，请等登录框出来后再点获取验证码。'
  }
  const cookies = await win.webContents.session.cookies.get({})
  return {
    ok: status === 'sent',
    message: messages[status] || messages.miss,
    loginStatus: loggedIn(cookies, kind) ? '已登录' : '待确认'
  }
}

/** 新建账号后：自动打开豆包 → 填手机号 → 主动点获取验证码（验证弹窗自动处理） */
async function bootstrapDoubaoLogin({ id, name, login, captcha }) {
  const phone = String(login || secrets.read(id)?.login || '').replace(/\D/g, '').slice(-11)
  const secret = secrets.read(id)
  const page = 'https://www.doubao.com/chat/'
  runtimeLog.info('doubao.bootstrap', `打开豆包并自动登录 phone=${phone ? `${phone.slice(0, 3)}****` : '无'}`)
  // 用 code 模式打开，避免一上来就切到扫码页导致填不了手机号
  const opened = await openAccount({
    kind: 'doubao',
    id,
    name,
    login: phone || login,
    mode: secret?.password ? 'password' : 'code',
    url: page,
    force: true,
    skipSend: true,
    captcha: captcha || { enabled: true }
  })
  const target = windows.get(sessionKey('doubao', id, page))
  if (!target || target.isDestroyed()) {
    return { ok: false, loginStatus: '待确认', message: opened?.message || '豆包窗口没有打开' }
  }
  bringToFront(target)
  attachDoubaoPromoGuard(target)
  await dismissDoubaoPromo(target)
  await wait(1200)

  // 有密码：先尝试账密登录
  if (secret?.password && (phone || login)) {
    const filled = await autoFillPasswordLogin(target, phone || login, secret.password, { times: 6 })
    await watchCaptcha(target, captcha || { enabled: true })
    if (filled === 'filled') {
      await wait(1200)
      const cookies = await target.webContents.session.cookies.get({})
      if (loggedIn(cookies, 'doubao')) {
        return { ok: true, loginStatus: '已登录', message: '已自动填写豆包账密并登录' }
      }
    }
  }

  // 主路径：填手机号 + 发送验证码
  let sendStatus = 'miss'
  if (phone) {
    sendStatus = await autoSendPhoneCode(target, phone, { times: 12 })
    await watchCaptcha(target, captcha || { enabled: true })
  }
  const cookies = await target.webContents.session.cookies.get({})
  const signed = loggedIn(cookies, 'doubao')
  const parts = []
  if (phone && sendStatus === 'sent') parts.push('已填手机号并点击获取验证码')
  else if (phone && sendStatus === 'typed') parts.push('已填手机号，请再点一次获取验证码')
  else if (phone && sendStatus === 'wait') parts.push('手机号已填入，获取验证码按钮冷却中')
  else if (phone) parts.push('未点到获取验证码，请在窗口里确认')
  else parts.push('未提供手机号')
  parts.push(signed ? '已登录' : '验证码发到手机后，在窗口里填入即可')
  return {
    ok: true,
    loginStatus: signed ? '已登录' : '待确认',
    sendStatus,
    message: parts.join('；')
  }
}

function publishPartitionStatus(id) {
  return session.fromPartition(`persist:huang-publish-${id}`).cookies.get({}).then((cookies) => ({
    buyinLoginStatus: buyinLoggedIn(cookies) ? '已登录' : '待登录',
    creatorLoginStatus: creatorLoggedIn(cookies) ? '已登录' : '待登录',
    loginStatus: buyinLoggedIn(cookies) ? '已登录' : '待登录'
  })).catch(() => ({
    buyinLoginStatus: '待登录',
    creatorLoginStatus: '待登录',
    loginStatus: '待登录'
  }))
}

/**
 * 添加抖音账号：
 * 有账密 → 创作者页在隐藏窗口自动填账密；只把达人工作台亮出来并点到扫码。
 * 无账密 → 达人工作台和创作者中心都打开，并各自点出二维码。
 * 两边登录态分开记。
 */
async function bootstrapPublishLogin({ id, name, login, mode }) {
  const secret = secrets.read(id)
  const account = String(login || secret?.login || '').trim()
  const password = String(secret?.password || '').trim()
  const realAccount = account && account !== '扫码登录' ? account : ''
  const hasSecret = Boolean(password && realAccount && mode !== 'qr' && mode !== 'code')
  const buyinUrl = 'https://buyin.jinritemai.com/dashboard'
  const creatorUrl = 'https://creator.douyin.com/creator-micro/content/upload'
  runtimeLog.info('publish.bootstrap', `达人+创作者 hasSecret=${hasSecret} mode=${mode || ''}`)

  await openAccount({
    kind: 'publish',
    id,
    name: name || '创作者',
    login: realAccount,
    mode: hasSecret ? 'password' : 'qr',
    url: creatorUrl,
    slot: 'creator-boot',
    hidden: hasSecret
  })
  const creatorWin = windows.get(sessionKey('publish', id, creatorUrl, 'creator-boot'))
  if (creatorWin && !creatorWin.isDestroyed()) {
    if (hasSecret) {
      hardenSilentWindow(creatorWin)
      await autoFillPasswordLogin(creatorWin, realAccount, password, { times: 8 })
      await wait(1200)
      hardenSilentWindow(creatorWin)
    } else {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const clicked = await runInFrames(creatorWin, clickTextScript(['扫码登录', '扫码']))
        if (clicked === 'clicked') break
        await wait(500)
      }
      try { creatorWin.show() } catch { /* ignore */ }
      bringToFront(creatorWin)
    }
  }

  await openAccount({
    kind: 'publish',
    id,
    name: name || '达人',
    login: realAccount,
    mode: 'qr',
    url: buyinUrl
  })
  const buyinWin = windows.get(sessionKey('publish', id, buyinUrl)) || findPublishMainWindow(id)
  if (buyinWin && !buyinWin.isDestroyed()) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const clicked = await runInFrames(buyinWin, clickTextScript(['扫码登录', '扫码']))
      if (clicked === 'clicked') break
      await wait(500)
    }
    bringToFront(buyinWin)
  }

  const status = await publishPartitionStatus(id)
  const message = hasSecret
    ? '创作者登录已在后台自动填写账号密码（窗口不显示）。达人工作台已打开，请扫码。'
    : '已打开达人工作台和创作者中心，请分别扫码。两边登录状态分开保存。'
  return { ok: true, ...status, hiddenCreator: hasSecret, message }
}

/** 账密账号过期：隐藏窗口自动登录，不把页面亮给用户 */
async function silentPasswordLogin({ kind, id, name, login, scope }) {
  const secret = secrets.read(id)
  const account = String(login || secret?.login || '').trim()
  const password = String(secret?.password || '').trim()
  if (!account || !password || account === '扫码登录') {
    return { ok: false, loginStatus: '待登录', message: '没有保存密码' }
  }
  if (kind === 'doubao') {
    const page = 'https://www.doubao.com/chat/'
    await openAccount({
      kind: 'doubao',
      id,
      name,
      login: account,
      mode: 'password',
      url: page,
      hidden: true
    })
    const win = windows.get(sessionKey('doubao', id, page))
    if (win && !win.isDestroyed()) {
      hardenSilentWindow(win)
      await autoFillPasswordLogin(win, account, password, { times: 6 })
      await wait(1200)
      const cookies = await win.webContents.session.cookies.get({}).catch(() => [])
      const ok = loggedIn(cookies, 'doubao')
      return { ok, loginStatus: ok ? '已登录' : '待登录', silent: true }
    }
    return { ok: false, loginStatus: '待登录', silent: true }
  }
  const creator = scope === 'creator'
  const url = creator
    ? 'https://creator.douyin.com/creator-micro/content/upload'
    : 'https://buyin.jinritemai.com/dashboard'
  const slot = creator ? 'creator-boot' : 'buyin-silent'
  await openAccount({
    kind: 'publish',
    id,
    name,
    login: account,
    mode: 'password',
    url,
    slot,
    hidden: true
  })
  const win = windows.get(sessionKey('publish', id, url, slot))
  if (win && !win.isDestroyed()) {
    hardenSilentWindow(win)
    await autoFillPasswordLogin(win, account, password, { times: 8 })
    await wait(1400)
    hardenSilentWindow(win)
  }
  const status = await publishPartitionStatus(id)
  const ok = creator ? status.creatorLoginStatus === '已登录' : status.buyinLoginStatus === '已登录'
  return { ok, loginStatus: ok ? '已登录' : '待登录', ...status, silent: true, scope: scope || 'buyin' }
}

async function submitCode({ kind, id, name, login, code }) {
  const text = String(code || '').trim()
  if (!text) return { ok: false, message: '请填写验证码' }
  await openAccount({ kind, id, name, login, mode: 'code', skipSend: true })
  const win = windows.get(`${kind}:${id}`)
  if (!win || win.isDestroyed()) return { ok: false, message: '登录窗口没有打开' }
  await runInFrames(win, clickTextScript(['验证码登录', '短信登录', '手机号登录']))
  const filled = await runInFrames(win, codeScript(text))
  await wait(1200)
  const cookies = await win.webContents.session.cookies.get({})
  return {
    ok: filled === 'filled',
    message: filled === 'filled' ? '' : '页面上还没有验证码输入框，先在打开的网页里点获取验证码',
    loginStatus: loggedIn(cookies, kind) ? '已登录' : '待确认'
  }
}

function within(promise, ms) {
  return Promise.race([
    promise,
    wait(ms).then(() => '')
  ])
}

async function collectProducts({ id, target, pageLimit = 0, onPage }) {
  const logs = ['开始读取商品']
  const page = target === 'plaza'
    ? 'https://buyin.jinritemai.com/dashboard/merch-picking-library'
    : 'https://buyin.jinritemai.com/dashboard/merch-picking-cart'
  const path = target === 'plaza' ? '/pc/selection/common/material_list' : '/pc/selection_cart/list'
  let win = null
  const job = async () => {
    logs.push('连接这个账号已经登录的会话')
    win = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      width: 1280,
      height: 900,
      webPreferences: {
        partition: `persist:huang-publish-${id}`,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    })
    win.webContents.setUserAgent(CHROME_UA)
    await within(win.loadURL(page, { userAgent: CHROME_UA }).catch(() => {}), 10000)
    if (!win || win.isDestroyed()) {
      logs.push('会话窗口已关闭')
      return { texts: [], logs }
    }
    await within(win.webContents.executeJavaScript(`new Promise((resolve) => {
      if (document.readyState === 'complete') resolve('ready')
      else window.addEventListener('load', () => resolve('ready'), { once: true })
    })`).catch(() => ''), 8000)
    await wait(1200)
    const limit = Number(pageLimit) > 0 ? Math.floor(Number(pageLimit)) : 0
    logs.push(limit
      ? `向达人工作台按分页请求，最多 ${limit} 页，每页返回就先显示`
      : '向达人工作台按分页请求，不限页数，每页返回就先显示，直到没有下一页')
    const texts = []
    let cursor = 0
    let pageNo = 1
    for (let index = 0; ; index += 1) {
      if (limit && index >= limit) {
        logs.push(`已到设置的 ${limit} 页，先保存已经拿到的商品`)
        break
      }
      if (!win || win.isDestroyed()) break
      const body = target === 'plaza'
        ? { cursor, size: 30, scene: 'PCSquareFeed', search_text: '', extra: {} }
        : { page: pageNo, page_no: pageNo, page_size: 50, size: 50 }
      const text = await within(win.webContents.executeJavaScript(`(async () => {
        const response = await fetch(${JSON.stringify(path)}, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(${JSON.stringify(body)})
        })
        return await response.text()
      })()`).catch((error) => {
        logs.push(`第 ${index + 1} 页中断：${error.message || '没有返回'}`)
        return ''
      }), 12000)
      if (!text) break
      texts.push(text)
      if (onPage) {
        const signal = await onPage(text, index).catch((error) => {
          logs.push(`第 ${index + 1} 页先显示失败：${error.message || '没有写入'}`)
          return ''
        })
        if (signal === 'stop') {
          logs.push('连续几页没有新商品，停止')
          break
        }
      }
      let json = null
      try { json = JSON.parse(text) } catch { json = null }
      if (index === 0) {
        const note = json ? [json.code, json.msg || json.message || ''].filter((item) => item !== undefined && item !== null && item !== '').join(' ') : '不是商品 JSON'
        if (note) logs.push(`接口说明：${note}`)
      }
      const data = json?.data || {}
      const more = Boolean(data.has_more || data.hasMore || json?.has_more)
      const next = Number(data.cursor ?? data.next_cursor ?? data.nextCursor)
      logs.push(`第 ${index + 1} 页已返回${more ? '，还有下一页' : '，没有下一页了'}`)
      if (!more) break
      if (Number.isFinite(next) && next !== cursor) cursor = next
      else if (target === 'plaza') cursor += 30
      else break
      pageNo += 1
    }
    logs.push(`一共拿到 ${texts.length} 页`)
    return { texts, logs }
  }
  try {
    return await job()
  } finally {
    if (win && !win.isDestroyed()) win.close()
  }
}

async function warmWorkbench(id, pageUrl) {
  const secret = secrets.read(id)
  await ensurePublishLogin({
    id,
    name: '达人工作台',
    login: secret?.login || '',
    mode: secret?.password ? 'password' : 'qr',
    url: pageUrl || URLS.publish
  })
  await openAccount({
    kind: 'publish',
    id,
    name: '达人工作台',
    mode: secret?.password ? 'password' : 'qr',
    login: secret?.login || '',
    url: pageUrl || URLS.publish,
    already: true
  })
  await wait(800)
  return session.fromPartition(`persist:huang-publish-${id}`).cookies.get({})
}

function fetchBuffer(url, extra = {}) {
  return new Promise((resolve) => {
    try {
      const { referer, ...options } = extra
      const request = net.request({ url, redirect: 'follow', ...options })
      request.setHeader('User-Agent', CHROME_UA)
      request.setHeader('Referer', referer || 'https://buyin.jinritemai.com/')
      const chunks = []
      request.on('response', (response) => {
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => resolve(Buffer.concat(chunks)))
      })
      request.on('error', () => resolve(Buffer.alloc(0)))
      request.end()
    } catch {
      resolve(Buffer.alloc(0))
    }
  })
}

function saveFile(file, buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, buffer)
}

/** Windows 上 .part→成片 rename 常被杀毒/索引锁住；带重试并回退 copy */
function finalizePartFile(part, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const sleep = (ms) => {
    try {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
    } catch {
      const end = Date.now() + ms
      while (Date.now() < end) { /* spin */ }
    }
  }
  let lastError = null
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      if (fs.existsSync(file)) {
        try { fs.unlinkSync(file) } catch (error) { lastError = error }
      }
      fs.renameSync(part, file)
      return file
    } catch (error) {
      lastError = error
      sleep(120 + attempt * 80)
    }
  }
  // rename 一直被锁：改 copy + 删临时文件
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      if (fs.existsSync(file)) {
        try { fs.unlinkSync(file) } catch (error) { lastError = error }
      }
      fs.copyFileSync(part, file)
      try { fs.unlinkSync(part) } catch { /* 临时文件晚点清也行 */ }
      return file
    } catch (error) {
      lastError = error
      sleep(150 + attempt * 100)
    }
  }
  // 终稿也被锁：换一个旁路文件名，避免整条生成因 EPERM 崩掉
  const alt = file.replace(/(\.[^.]+)?$/, (ext) => `-saved${Date.now()}${ext || '.mp4'}`)
  try {
    fs.copyFileSync(part, alt)
    try { fs.unlinkSync(part) } catch { /* ignore */ }
    return alt
  } catch (error) {
    lastError = error
  }
  const msg = String(lastError?.message || lastError || '文件落盘失败')
  throw new Error(`成片保存失败（文件可能被占用）：${msg}`)
}

function requestBuffer(rawUrl, { headers = {}, timeout = 30000, insecure = false, redirects = 0 } = {}) {
  return new Promise((resolve) => {
    if (redirects > 5) return resolve(Buffer.alloc(0))
    let target
    try { target = new URL(rawUrl) } catch { return resolve(Buffer.alloc(0)) }
    const lib = target.protocol === 'http:' ? http : https
    const req = lib.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      headers: { 'Accept-Encoding': 'identity', 'User-Agent': CHROME_UA, ...headers },
      timeout,
      rejectUnauthorized: !insecure
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume()
        resolve(requestBuffer(new URL(res.headers.location, rawUrl).toString(), { headers, timeout, insecure, redirects: redirects + 1 }))
        return
      }
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('error', () => resolve(Buffer.alloc(0)))
    req.on('timeout', () => {
      req.destroy()
      resolve(Buffer.alloc(0))
    })
    req.end()
  })
}

function looksLikeVideo(buffer) {
  if (!buffer || buffer.length < 4096) return false
  if (buffer[0] === 0x1a && buffer[1] === 0x45) return true
  return buffer.subarray(0, 32).toString('latin1').includes('ftyp')
}

function startChainCapture(win) {
  const dbg = win.webContents.debugger
  const attachedHere = !dbg.isAttached()
  if (attachedHere) dbg.attach('1.3')
  const bodies = []
  const pending = new Set()
  const takeBody = async (requestId) => {
    if (!pending.has(requestId)) return
    pending.delete(requestId)
    try {
      const result = await dbg.sendCommand('Network.getResponseBody', { requestId })
      let text = result.body || ''
      if (result.base64Encoded) text = Buffer.from(text, 'base64').toString('utf8')
      if (text.trim()) bodies.push(text)
    } catch {
      pending.add(requestId)
    }
  }
  const onMessage = (_event, method, params) => {
    const url = String(params?.response?.url || '')
    if (method === 'Network.responseReceived' && url.toLowerCase().includes('doubao.com/im/chain/single') && params.requestId) {
      pending.add(params.requestId)
      setTimeout(() => { takeBody(params.requestId) }, 900)
    }
    if (method === 'Network.loadingFinished' && pending.has(params.requestId)) takeBody(params.requestId)
  }
  dbg.on('message', onMessage)
  const ready = dbg.sendCommand('Network.enable', {
    maxTotalBufferSize: 100000000,
    maxResourceBufferSize: 25000000
  }).catch(() => {})
  return {
    bodies,
    ready,
    async stop() {
      dbg.removeListener('message', onMessage)
      try { await dbg.sendCommand('Network.disable') } catch { /* 监听已经停了 */ }
      if (attachedHere && dbg.isAttached()) {
        try { dbg.detach() } catch { /* 调试连接已经结束 */ }
      }
    }
  }
}

async function cleanUrlFromBodies(pageSession, bodies) {
  for (const body of bodies) {
    const apis = unwatermark.fallbackApis(body)
    for (const api of apis) {
      const url = unwatermark.withCleanParams(api)
      const headers = { accept: 'application/json,text/plain,*/*' }
      let buf = await requestBuffer(url, { headers, timeout: 30000 })
      if (buf.length < 20 && pageSession) {
        buf = await fetchBuffer(url, {
          referer: 'https://www.doubao.com/',
          session: pageSession,
          useSessionCookies: true
        })
      }
      let payload = null
      try { payload = JSON.parse(buf.toString('utf8')) } catch { payload = null }
      const videoUrl = payload ? unwatermark.videoUrlFromPayload(payload) : ''
      if (videoUrl) return videoUrl
    }
  }
  return ''
}

async function downloadCleanFile(videoUrl, file, pageSession) {
  let video = await requestBuffer(videoUrl, { timeout: 120000 })
  if (!looksLikeVideo(video)) {
    video = await requestBuffer(videoUrl, {
      timeout: 120000,
      insecure: true,
      headers: {
        Referer: 'https://www.doubao.com/',
        Accept: '*/*'
      }
    })
  }
  if (!looksLikeVideo(video) && pageSession) {
    video = await fetchBuffer(videoUrl, {
      referer: 'https://www.doubao.com/',
      session: pageSession,
      useSessionCookies: true
    })
  }
  if (!looksLikeVideo(video)) return ''
  const part = `${file}.part`
  try {
    saveFile(part, video)
    return finalizePartFile(part, file)
  } catch (error) {
    // 不把 EPERM 抛成 IPC 远程方法崩溃；交给上层当「没保存成功」
    try { if (fs.existsSync(part)) fs.unlinkSync(part) } catch { /* ignore */ }
    return ''
  }
}

async function dropCornerText(file) {
  const cleaned = await media.stripWatermark({ file, dir: path.dirname(file) })
  return cleaned?.ok ? cleaned.output : file
}

async function saveCleanVideo(win, bodies, file) {
  const videoUrl = await cleanUrlFromBodies(win.webContents.session, bodies)
  if (!videoUrl) return ''
  const saved = await downloadCleanFile(videoUrl, file, win.webContents.session)
  return saved ? videoUrl : ''
}

function attachFilesScript(files) {
  const payload = files.map((item) => ({
    base64: item.buffer.toString('base64'),
    mime: item.mime,
    name: item.name
  }))
  return `(() => {
    const files = ${JSON.stringify(payload)}.map((item) => {
      const bytes = Uint8Array.from(atob(item.base64), (ch) => ch.charCodeAt(0))
      return new File([bytes], item.name, { type: item.mime })
    })
    const inputs = []
    const walk = (root) => {
      if (!root || !root.querySelectorAll) return
      root.querySelectorAll('input[type="file"]').forEach((el) => inputs.push(el))
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot) })
    }
    walk(document)
    const input = inputs.find((el) => /image/i.test(el.accept || '')) || inputs[inputs.length - 1]
    const boxes = []
    const walkBox = (root) => {
      if (!root || !root.querySelectorAll) return
      root.querySelectorAll('textarea, [contenteditable="true"]').forEach((el) => boxes.push(el))
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walkBox(el.shadowRoot) })
    }
    walkBox(document)
    const box = boxes.filter((el) => el.getBoundingClientRect().width > 40).pop()
    if (!input && !box) return 'miss'
    const transfer = new DataTransfer()
    files.forEach((file) => transfer.items.add(file))
    if (input) {
      input.multiple = true
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    if (box) {
      box.focus()
      const paste = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(paste, 'clipboardData', { value: transfer })
      box.dispatchEvent(paste)
    }
    return input || box ? 'file' : 'miss'
  })()`
}

function promptLandedScript(snippet) {
  return `(() => {
    const boxes = []
    const walk = (root) => {
      if (!root || !root.querySelectorAll) return
      root.querySelectorAll('textarea, [contenteditable="true"]').forEach((el) => boxes.push(el))
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot) })
    }
    walk(document)
    const found = boxes.some((box) => (box.value || box.innerText || box.textContent || '').includes(${JSON.stringify(snippet)}))
    return found ? 'filled' : 'miss'
  })()`
}

function localImagePath(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (/^[a-zA-Z]:[\\/]/.test(text) || text.startsWith('\\\\')) return text
  if (text.startsWith('file:///')) {
    try { return decodeURIComponent(text.replace(/^file:\/\/\//i, '').replace(/\//g, path.sep)) } catch { return '' }
  }
  const fromLocalVideo = text.match(/local-video:\/\/play\/\?path=([^&]+)/i)
  if (fromLocalVideo) {
    try {
      const decoded = decodeURIComponent(fromLocalVideo[1])
      if (/^[a-zA-Z]:[\\/]/.test(decoded) || decoded.startsWith('\\\\')) return decoded
    } catch { /* 路径坏了 */ }
  }
  return ''
}

async function downloadImage(url, pageSession) {
  const referers = ['https://buyin.jinritemai.com/', 'https://haohuo.jinritemai.com/', 'https://www.douyin.com/', 'https://www.doubao.com/', '']
  for (const referer of referers) {
    const plain = await fetchBuffer(url, referer ? { referer } : {})
    if (plain.length > 100) return plain
    if (pageSession) {
      const viaPage = await fetchBuffer(url, { referer: referer || 'https://www.doubao.com/', session: pageSession, useSessionCookies: true })
      if (viaPage.length > 100) return viaPage
    }
  }
  return Buffer.alloc(0)
}

function useDebugger(win, work) {
  if (!win || win.isDestroyed()) return Promise.resolve(false)
  const dbg = win.webContents.debugger
  const attachedHere = !dbg.isAttached()
  try {
    if (attachedHere) dbg.attach('1.3')
  } catch {
    return Promise.resolve(false)
  }
  return Promise.resolve()
    .then(() => {
      if (win.isDestroyed()) return false
      return work(dbg)
    })
    .catch(() => false)
    .finally(() => {
      if (attachedHere) {
        try {
          if (!win.isDestroyed() && dbg.isAttached()) dbg.detach()
        } catch { /* 调试连接已经结束 */ }
      }
    })
}

async function setFileInputs(win, filePaths) {
  return useDebugger(win, async (dbg) => {
    const { root } = await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true })
    const { nodeIds } = await dbg.sendCommand('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'input[type="file"]' })
    if (!nodeIds?.length) return false
    let chosen = nodeIds[nodeIds.length - 1]
    for (const nodeId of nodeIds) {
      const { node } = await dbg.sendCommand('DOM.describeNode', { nodeId })
      const attrs = node.attributes || []
      for (let index = 0; index < attrs.length; index += 2) {
        if (attrs[index] === 'accept' && /image/i.test(attrs[index + 1] || '')) chosen = nodeId
      }
    }
    await dbg.sendCommand('DOM.setFileInputFiles', { nodeId: chosen, files: filePaths })
    return true
  }).catch(() => false)
}

async function chooseLocalImages(win, filePaths) {
  const dbg = win.webContents.debugger
  const attachedHere = !dbg.isAttached()
  let opened = false
  const onMessage = async (_event, method) => {
    if (method !== 'Page.fileChooserOpened' || opened) return
    opened = true
    try { await dbg.sendCommand('Page.handleFileChooser', { action: 'accept', files: filePaths }) } catch { /* 选择框已经关掉 */ }
  }
  dbg.on('message', onMessage)
  try {
    if (attachedHere) dbg.attach('1.3')
    await dbg.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true })
    await runInFrames(win, clickTextScript(['参考图', '上传图片', '添加图片', '商品图']))
    for (let tick = 0; tick < 8 && !opened; tick += 1) await wait(400)
    return opened
  } catch {
    return false
  } finally {
    dbg.removeListener('message', onMessage)
    try { await dbg.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false }) } catch { /* 拦截已经结束 */ }
    if (attachedHere && dbg.isAttached()) {
      try { dbg.detach() } catch { /* 调试连接已经结束 */ }
    }
  }
}

function imagesPresentScript() {
  return `(() => {
    const inputs = []
    const walk = (root) => {
      if (!root || !root.querySelectorAll) return
      root.querySelectorAll('input[type="file"]').forEach((el) => inputs.push(el))
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot) })
    }
    walk(document)
    if (inputs.some((el) => el.files && el.files.length)) return 'file'
    return 'miss'
  })()`
}

function sendScript() {
  return `(() => {
    const buttons = []
    const boxes = []
    const walk = (root) => {
      if (!root || !root.querySelectorAll) return
      root.querySelectorAll('button, [role="button"]').forEach((el) => buttons.push(el))
      root.querySelectorAll('textarea, [contenteditable="true"]').forEach((el) => boxes.push(el))
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot) })
    }
    walk(document)
    const send = buttons.find((el) => {
      const label = ((el.innerText || '') + (el.getAttribute('aria-label') || '')).replace(/\\s+/g, '')
      return /发送/.test(label) && !el.disabled && el.getAttribute('aria-disabled') !== 'true'
    }) || buttons.find((el) => /send/i.test((el.className || '') + (el.getAttribute('aria-label') || '')) && !el.disabled)
    if (send) { send.click(); return 'clicked' }
    const box = boxes.filter((el) => el.getBoundingClientRect().width > 40).pop()
    if (!box) return 'miss'
    box.focus()
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
    return 'clicked'
  })()`
}

function confirmClickScript() {
  return `(() => {
    const compact = (value) => String(value || '').replace(/\\s+/g, '')
    const visible = (el) => {
      const rect = el.getBoundingClientRect()
      if (rect.width < 8 || rect.height < 8) return false
      const style = getComputedStyle(el)
      return style.display !== 'none' && style.visibility !== 'hidden'
    }
    const buttons = []
    const walk = (root) => {
      if (!root || !root.querySelectorAll) return
      root.querySelectorAll('button, [role="button"], a, div, span').forEach((el) => buttons.push(el))
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot) })
    }
    walk(document)
    const hits = buttons.filter((el) => {
      if (!visible(el)) return false
      const label = compact(el.innerText)
      if (!label || label.length > 12) return false
      const box = el.closest('[role="dialog"], [class*="modal"], [class*="dialog"], [class*="popup"], [class*="confirm"]')
      const scope = compact((box && box.innerText) || el.parentElement?.innerText || '')
      const sendConfirm = /确认发送|确定发送|确认生成|开始生成|直接生成|继续生成|立即生成/.test(label)
      const shortOk = /^(确认|确定|同意|继续|我知道了)$/.test(label)
      const context = /确认发送|确定发送|开始生成|生成视频|充分授权|使用规范|二次/.test(scope)
      return sendConfirm || (shortOk && (box || context))
    })
    hits.sort((a, b) => compact(a.innerText).length - compact(b.innerText).length)
    const target = hits[0] && (hits[0].closest('button, [role="button"], a') || hits[0])
    if (!target) return 'miss'
    target.click()
    return 'clicked'
  })()`
}

function doubaoStateScript(snippet, minVideos) {
  const needle = String(snippet || '').replace(/\s+/g, '').slice(0, 16)
  return `(() => {
    const needle = ${JSON.stringify(needle)}
    const compact = (value) => String(value || '').replace(/\\s+/g, '')
    const visible = (el) => {
      const rect = el.getBoundingClientRect()
      if (rect.width < 8 || rect.height < 8) return false
      const style = getComputedStyle(el)
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0
    }
    const buttons = []
    const boxes = []
    const walk = (root) => {
      if (!root || !root.querySelectorAll) return
      root.querySelectorAll('button, [role="button"], a, div, span').forEach((el) => buttons.push(el))
      root.querySelectorAll('textarea, [contenteditable="true"]').forEach((el) => boxes.push(el))
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot) })
    }
    walk(document)
    const confirm = buttons.find((el) => {
      if (!visible(el)) return false
      const label = compact(el.innerText)
      if (!label || label.length > 12) return false
      const box = el.closest('[role="dialog"], [class*="modal"], [class*="dialog"], [class*="popup"], [class*="confirm"]')
      const scope = compact((box && box.innerText) || el.parentElement?.innerText || '')
      const sendConfirm = /确认发送|确定发送|确认生成|开始生成|直接生成|继续生成|立即生成/.test(label)
      const shortOk = /^(确认|确定|同意|继续|我知道了)$/.test(label)
      const context = /确认发送|确定发送|开始生成|生成视频|充分授权|使用规范|二次/.test(scope)
      return sendConfirm || (shortOk && (box || context))
    })
    const input = boxes.filter((el) => el.getBoundingClientRect().width > 40).pop()
    const inputText = compact(input ? (input.value || input.innerText || '') : '')
    const inputHasPrompt = Boolean(needle) && inputText.includes(needle.slice(0, 8))
    const body = compact(document.body?.innerText || '')
    const echoed = Boolean(needle) && body.includes(needle.slice(0, 8)) && !inputHasPrompt
    const rules = ${JSON.stringify([...(activeReplyRules?.first || []), ...(activeReplyRules?.follow || []).map((item) => ({ ...item, action: 'text', buttonLabel: '' }))])}
    const replyPhrases = rules.map((rule) => String(rule.reply || '').replace(/\\s+/g, '')).filter(Boolean)
    const confirmEcho = (replyPhrases.some((text) => body.includes(text) && !inputText.includes(text.slice(0, 8))) || /确认，直接开始生成|确认直接开始生成/.test(body)) && !inputText.includes('确认，直接开始生成')
    const tail = body.slice(-2500)
    const ownPromptAsks = Boolean(needle) && needle.includes('确认后再开始生成')
    const asks = /视频生成参数确认/.test(tail) || (/确认后再开始生成/.test(tail) && !ownPromptAsks) || /请确认参数|回复确认后开始/.test(tail)
    const generating = /视频生成中|正在生成|生成中|排队中|排队生成|稍等片刻|仍在排队/.test(body.slice(-2500))
    const confirmVisible = Boolean(confirm)
    const copyrightMarkers = ${JSON.stringify(activeRetryCopyright)}
    const busyMarkers = ${JSON.stringify(activeRetryBusy)}
    const markers = ${JSON.stringify(activeFailMarkers)}
    const findHit = (list) => (list || []).find((item) => item && tail.includes(String(item).replace(/\\s+/g, '')))
    const copyrightHit = findHit(copyrightMarkers)
    const busyHit = findHit(busyMarkers)
    const failHit = findHit(markers)
    const replyHit = rules.find((rule) => rule && rule.enabled !== false && rule.match && tail.includes(String(rule.match).replace(/\\s+/g, '')))
    const base = {
      confirmVisible,
      confirmLabel: confirm ? compact(confirm.innerText).slice(0, 12) : '',
      inputHasPrompt,
      echoed,
      confirmEcho,
      generating: generating || Boolean(busyHit),
      asks,
      failMarker: failHit || '',
      copyrightMarker: copyrightHit || '',
      busyMarker: busyHit || '',
      replyText: replyHit?.reply || '',
      replyAction: replyHit?.action || ''
    }
    if (/额度不足|次数已用完|今日次数已用完|已达上限|没有剩余次数/.test(body.slice(-4000))) return { state: 'quota', ...base }
    const videos = Array.from(document.querySelectorAll('video'))
    const video = videos.length > ${Number(minVideos) || 0} ? videos[videos.length - 1] : null
    const src = video ? (video.currentSrc || video.src || '') : ''
    if (src && (src.startsWith('http') || (src.startsWith('blob:') && video.readyState >= 2))) return { state: 'ready', src, ...base }
    // 版权限制 / 排队占用：优先走重试，不当立刻失败
    if (copyrightHit && !generating) return { state: 'retry_copyright', ...base }
    if (busyHit) return { state: 'retry_busy', ...base }
    if (failHit && !generating && !copyrightHit && !busyHit) return { state: 'failed', ...base }
    const link = Array.from(document.querySelectorAll('a')).map((el) => el.href || '').find((href) => /\\.mp4(\\?|$)/i.test(href))
    if (link) return { state: 'ready', src: link, ...base }
    return { state: confirmVisible ? 'confirm' : 'wait', ...base }
  })()`
}

async function readDoubao(win, snippet, minVideos) {
  const script = doubaoStateScript(snippet, minVideos)
  let best = { state: 'wait', confirmVisible: false, inputHasPrompt: false, echoed: false, generating: false, asks: false }
  if (!win || win.isDestroyed()) return best
  for (const frame of framesOf(win.webContents.mainFrame)) {
    try {
      const result = await frame.executeJavaScript(script)
      if (!result || typeof result !== 'object') continue
      if (result.confirmVisible || result.state === 'ready' || result.state === 'quota' || result.state === 'failed' || result.state === 'retry_copyright' || result.state === 'retry_busy' || result.asks) return result
      if (result.inputHasPrompt || result.echoed || result.generating) best = result
    } catch { /* 这个框架读不到页面 */ }
  }
  return best
}

function delivered(state) {
  if (!state || state.confirmVisible || state.asks) return false
  if (state.state === 'ready' || state.generating) return true
  return Boolean(state.confirmEcho && !state.inputHasPrompt)
}

async function sendConfirmReply(win, minVideos, replyText) {
  const text = replyText || '确认，直接开始生成。'
  const landed = text.replace(/\s+/g, '').slice(0, 12)
  let filled = 'miss'
  for (let attempt = 0; attempt < 4 && filled !== 'filled'; attempt += 1) {
    await fillPrompt(win, text)
    await wait(400)
    filled = await runInFrames(win, promptLandedScript(landed))
  }
  let sent = 'miss'
  for (let attempt = 0; attempt < 4 && sent !== 'clicked'; attempt += 1) {
    sent = await runInFrames(win, sendScript())
    if (sent !== 'clicked') await wait(500)
  }
  await wait(1200)
  const after = await readDoubao(win, text, minVideos)
  const ok = Boolean(after.confirmEcho) || (filled === 'filled' && sent === 'clicked' && !after.inputHasPrompt && !after.asks)
  return { ...after, confirmNeeded: true, confirmSent: ok, confirmNote: ok ? `已把「${text}」发回豆包，并检测到发出` : `豆包要求确认，但这句「${text}」没有发进对话` }
}

async function pressConfirm(win, snippet, minVideos) {
  let state = await readDoubao(win, snippet, minVideos)
  if (state.state === 'quota') {
    return { ...state, quota: true, confirmNeeded: false, confirmSent: false, confirmNote: '这个豆包账号额度不够' }
  }
  if (state.inputHasPrompt && !state.echoed && !state.confirmVisible && !state.asks) {
    await runInFrames(win, sendScript())
    await wait(800)
    state = await readDoubao(win, snippet, minVideos)
  }
  if (state.confirmVisible) {
    await runInFrames(win, confirmClickScript())
    await wait(700)
    state = await readDoubao(win, snippet, minVideos)
  }
  if (state.confirmEcho) {
    return { ...state, confirmNeeded: true, confirmSent: true, confirmNote: '确认已经在对话里' }
  }
  if (state.state === 'failed') {
    return { ...state, confirmNeeded: false, confirmSent: false, confirmNote: `豆包拒绝生成：${state.failMarker}` }
  }
  if (state.asks || state.confirmVisible) {
    if (state.replyAction === 'click') {
      await runInFrames(win, confirmClickScript())
      await wait(700)
      const clicked = await readDoubao(win, snippet, minVideos)
      if (!clicked.asks && !clicked.confirmVisible) {
        return { ...clicked, confirmNeeded: true, confirmSent: true, confirmNote: '已按页面按钮确认生成' }
      }
    }
    const reply = state.replyText || '确认，直接开始生成。'
    const first = await sendConfirmReply(win, minVideos, reply)
    if (first.confirmSent) return first
    const second = await sendConfirmReply(win, minVideos)
    return second.confirmSent ? { ...second, confirmNote: '二次确认已发送，并检测到发出' } : second
  }
  if (state.generating || state.state === 'ready') {
    return { ...state, confirmNeeded: false, confirmSent: false, confirmNote: '已直接发送，没有出现确认' }
  }
  if (state.echoed && !state.inputHasPrompt) {
    return { ...state, confirmNeeded: false, confirmSent: false, confirmNote: '已直接发送，豆包还没要求确认' }
  }
  return { ...state, confirmNeeded: false, confirmSent: false, confirmNote: '已发送，等待豆包响应' }
}

async function ensureDelivered(win, snippet, notify, workId, minVideos) {
  let last = { confirmNeeded: false, confirmSent: false, confirmNote: '已发送，等待豆包响应' }
  for (let tick = 0; tick < 6; tick += 1) {
    if (!win || win.isDestroyed()) return { ...last, confirmNote: '豆包窗口被关掉了' }
    const state = await readDoubao(win, snippet, minVideos)
    if (state.state === 'quota') return { ...state, quota: true, confirmNeeded: false, confirmSent: false, confirmNote: '这个豆包账号额度不够' }
    if (state.state === 'ready') return { ...state, ready: true, confirmNeeded: last.confirmNeeded, confirmSent: last.confirmSent, confirmNote: last.confirmNote || '已直接发送，没有出现确认框' }
    if (state.confirmVisible || state.asks || (state.inputHasPrompt && !state.echoed)) {
      last = await pressConfirm(win, snippet, minVideos)
      notify?.({ workId, progress: 48, status: '生成中', confirmSent: last.confirmSent, confirmNeeded: last.confirmNeeded, confirmNote: last.confirmNote })
      if (last.quota || last.confirmSent || (!last.confirmNeeded && (last.echoed || last.generating))) return last
      continue
    }
    if (state.echoed || state.generating) {
      last = { ...state, confirmNeeded: false, confirmSent: false, confirmNote: '已直接发送，没有出现确认框' }
      notify?.({ workId, progress: 48, status: '生成中', confirmSent: false, confirmNeeded: false, confirmNote: last.confirmNote })
      return last
    }
    await wait(700)
  }
  return last
}

async function pageTail(win) {
  if (!win || win.isDestroyed()) return ''
  return win.webContents.executeJavaScript(`(document.body && document.body.innerText || '').slice(-1800)`).catch(() => '')
}

async function waitForReply(win, beforeText, message) {
  const needle = String(message || '').replace(/\s+/g, '').slice(0, 16)
  for (let tick = 0; tick < 24; tick += 1) {
    await wait(1500)
    if (!win || win.isDestroyed()) return ''
    const tail = await pageTail(win)
    if (!tail || tail === beforeText) continue
    const compact = tail.replace(/\s+/g, '')
    const at = needle ? compact.lastIndexOf(needle.slice(0, 8)) : -1
    const after = at >= 0 ? compact.slice(at + Math.min(8, needle.length)) : ''
    if (after.length > 12 && !/确认发送|确定发送|确认生成/.test(after.slice(0, 16))) return tail.slice(-700)
  }
  return ''
}

/** 版权/排队时：新开对话（或直接）重贴图 + 重发提示词 */
async function resubmitDoubaoJob(win, { text, savedImages, filePayload, freshChat = true }) {
  if (!win || win.isDestroyed()) return { ok: false, note: '窗口已关' }
  if (freshChat) {
    await runInFrames(win, clickTextScript(['新对话', '新的对话', '开启新对话']))
    await wait(900)
    await runInFrames(win, clickTextScript(['视频生成', '生成视频']))
    await wait(700)
  }
  let attached = 'miss'
  if (savedImages?.length) {
    const placed = await setFileInputs(win, savedImages)
    if (placed) {
      await wait(500)
      attached = await runInFrames(win, imagesPresentScript())
    }
    if (attached !== 'file') {
      const chosen = await chooseLocalImages(win, savedImages)
      if (chosen) attached = 'file'
    }
    if (attached !== 'file' && Array.isArray(filePayload) && filePayload.length) {
      for (let attempt = 0; attempt < 4 && attached !== 'file'; attempt += 1) {
        attached = await runInFrames(win, attachFilesScript(filePayload))
        if (attached !== 'file') await wait(500)
      }
    }
  }
  await wait(600)
  const snippet = String(text || '').slice(0, 12)
  let filled = 'miss'
  for (let attempt = 0; attempt < 8 && filled !== 'filled'; attempt += 1) {
    await fillPrompt(win, text)
    await wait(400)
    filled = await runInFrames(win, promptLandedScript(snippet))
  }
  if (filled !== 'filled') return { ok: false, note: '重发时提示词没写进输入框', attached }
  let sent = 'miss'
  for (let attempt = 0; attempt < 6 && sent !== 'clicked'; attempt += 1) {
    sent = await runInFrames(win, sendScript())
    if (sent !== 'clicked') await wait(400)
  }
  if (sent !== 'clicked') return { ok: false, note: '重发时没有点到发送', attached }
  return { ok: true, note: freshChat ? '已新开对话并重发图+提示词' : '已再次发送提示词', attached }
}

async function generateOnDoubao({ id, name, login, mode, prompt, image, images, imageCount, saveDir, workId, notify, slot, failMarkers, replyRules, captcha, retryMarkers }) {
  const copyrightList = Array.isArray(retryMarkers?.copyright) && retryMarkers.copyright.length
    ? retryMarkers.copyright
    : DEFAULT_RETRY_COPYRIGHT
  const busyList = Array.isArray(retryMarkers?.busy) && retryMarkers.busy.length
    ? retryMarkers.busy
    : DEFAULT_RETRY_BUSY
  activeRetryCopyright = copyrightList.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 40)
  activeRetryBusy = busyList.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 40)
  // 旧设置可能把版权话术放在立刻失败里：生成时剔除，改走重发
  const copyrightSet = new Set(activeRetryCopyright.map((item) => item.replace(/\s+/g, '')))
  activeFailMarkers = (Array.isArray(failMarkers) ? failMarkers : [])
    .map((item) => String(item || '').trim())
    .filter((item) => item && !copyrightSet.has(item.replace(/\s+/g, '')) && !activeRetryBusy.some((busy) => item.includes(busy) || busy.includes(item)))
    .slice(0, 30)
  activeReplyRules = replyRules && typeof replyRules === 'object' ? replyRules : null
  const captchaConfig = doubaoCaptcha.normalizeConfig(captcha)
  const page = 'https://www.doubao.com/chat/'
  await openAccount({ kind: 'doubao', id, name, login, mode: mode || 'password', url: page, slot })
  const win = windows.get(sessionKey('doubao', id, page, slot))
  if (!win || win.isDestroyed()) return { ok: false, message: '网页版豆包没有打开' }
  win.setTitle(`${name || '豆包'} · 网页版`)
  bringToFront(win)
  attachDoubaoPromoGuard(win)
  await dismissDoubaoPromo(win)
  if (!String(win.webContents.getURL() || '').startsWith('https://www.doubao.com')) {
    await loadPage(win, page)
    await dismissDoubaoPromo(win)
  }
  notify?.({ workId, progress: 20, status: '生成中' })
  const folder = saveDir || path.join(app.getPath('videos'), 'huang-plusplus-pro')
  const file = path.join(folder, `${workId || Date.now()}.mp4`)
  const text = String(prompt || '').trim()
  const urls = [...new Set((Array.isArray(images) && images.length ? images : [image]).map((item) => String(item || '')).filter(Boolean))]
  if (!text || !urls.length) {
    return { ok: false, saveDir: folder, message: !text ? '提示词是空的，图和提示词必须一起发' : '没有商品图，图和提示词必须一起发' }
  }
  const savedImages = []
  const filePayload = []
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const ready = await runInFrames(win, `(() => document.querySelector('textarea,[contenteditable="true"]') ? 'filled' : 'miss')()`)
    if (ready === 'filled') break
    if (attempt === 3) await runInFrames(win, clickTextScript(['新对话', '新的对话', '开启新对话']))
    await wait(700)
  }
  await runInFrames(win, clickTextScript(['视频生成', '生成视频']))
  await wait(1000)
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const ready = await runInFrames(win, `(() => document.querySelector('textarea,[contenteditable="true"]') ? 'filled' : 'miss')()`)
    if (ready === 'filled') break
    await wait(500)
  }
  for (let index = 0; index < urls.length; index += 1) {
    const current = urls[index]
    const local = localImagePath(current)
    if (local) {
      if (!fs.existsSync(local)) continue
      const plain = fs.readFileSync(local)
      if (plain.length < 100) continue
      const mime = /\.png$/i.test(local) ? 'image/png' : 'image/jpeg'
      savedImages.push(local)
      filePayload.push({ buffer: plain, mime, name: path.basename(local) })
      continue
    }
    if (!/^https?:\/\//.test(current)) continue
    const plain = await downloadImage(current, win.webContents.session)
    if (plain.length < 100) continue
    const mime = /\.png(\?|$)/i.test(current) ? 'image/png' : 'image/jpeg'
    const imagePath = path.join(folder, `${workId || Date.now()}-product-${index + 1}.${mime === 'image/png' ? 'png' : 'jpg'}`)
    saveFile(imagePath, plain)
    savedImages.push(imagePath)
    filePayload.push({ buffer: plain, mime, name: `product-${index + 1}.${mime === 'image/png' ? 'png' : 'jpg'}` })
  }
  if (!savedImages.length) {
    return { ok: false, saveDir: folder, message: '商品图没有下载下来。提示词和图片必须一起发，已停止发送。' }
  }
  let attached = 'miss'
  const placed = await setFileInputs(win, savedImages)
  if (placed) {
    await wait(600)
    attached = await runInFrames(win, imagesPresentScript())
  }
  if (attached !== 'file') {
    const chosen = await chooseLocalImages(win, savedImages)
    if (chosen) attached = 'file'
  }
  if (attached !== 'file') {
    for (let attempt = 0; attempt < 5 && attached !== 'file'; attempt += 1) {
      attached = await runInFrames(win, attachFilesScript(filePayload))
      if (attached !== 'file') await wait(700)
    }
  }
  await wait(1200)
  if (attached !== 'file') {
    return { ok: false, saveDir: folder, imagePaths: savedImages, message: '商品图没有放进豆包输入框。提示词和图片必须一起发，已停止发送。' }
  }
  const snippet = text.slice(0, 12)
  let filled = 'miss'
  for (let attempt = 0; attempt < 10 && filled !== 'filled'; attempt += 1) {
    await fillPrompt(win, text)
    await wait(500)
    filled = await runInFrames(win, promptLandedScript(snippet))
    if (filled !== 'filled') await wait(400)
  }
  notify?.({ workId, progress: 35, status: '生成中' })
  if (filled !== 'filled') {
    return { ok: false, needLogin: true, saveDir: folder, imagePaths: savedImages, message: '商品图已上传，但提示词没有写进输入框，所以没有发送' }
  }
  const before = await win.webContents.executeJavaScript(`document.querySelectorAll('video').length`).catch(() => 0)
  let sent = 'miss'
  for (let attempt = 0; attempt < 8 && sent !== 'clicked'; attempt += 1) {
    sent = await runInFrames(win, sendScript())
    if (sent !== 'clicked') await wait(500)
  }
  if (sent !== 'clicked') {
    return { ok: false, saveDir: folder, imagePaths: savedImages, message: '提示词和图片已准备好，但没有点到发送' }
  }
  const captchaGate = await doubaoCaptcha.waitGate(win, captchaConfig, (data) => notify?.({ workId, progress: 42, status: '生成中', ...data }))
  if (captchaGate.hit && !captchaGate.cleared) {
    return { ok: false, saveDir: folder, imagePaths: savedImages, message: captchaGate.error || '豆包验证码没有通过，本条已停在发送后' }
  }
  let chain = null
  try {
    chain = startChainCapture(win)
    await chain.ready
  } catch { chain = null }
  const endChain = async () => {
    if (!chain) return
    const current = chain
    chain = null
    await current.stop()
  }
  notify?.({ workId, progress: 45, status: '生成中' })
  let delivery = await ensureDelivered(win, snippet, notify, workId, before)
  const withConfirm = (payload) => ({
    ...payload,
    confirmNeeded: Boolean(delivery.confirmNeeded),
    confirmSent: Boolean(delivery.confirmSent),
    confirmNote: delivery.confirmNote || ''
  })
  if (delivery.quota) {
    await endChain()
    return withConfirm({ ok: false, quota: true, saveDir: folder, message: '这个豆包账号额度不够' })
  }
  let confirmTries = 0
  let heldUrl = ''
  let reloaded = false
  let readySince = 0
  let nudged = false
  let copyrightRetries = 0
  let busyRetries = 0
  let lastRetryAt = 0
  const maxCopyrightRetries = 5
  const maxBusyRetries = 4
  const waitStarted = Date.now()
  for (let tick = 0; tick < 150; tick += 1) {
    await wait(3000)
    if (win.isDestroyed()) {
      await endChain()
      return withConfirm({ ok: false, saveDir: folder, message: '豆包网页被关掉了' })
    }
    const state = await readDoubao(win, snippet, before)
    if ((state.state === 'confirm' || state.confirmVisible || state.asks) && !state.confirmEcho && !delivery.confirmSent && confirmTries < 3) {
      confirmTries += 1
      const again = await pressConfirm(win, snippet, before)
      delivery = { ...delivery, ...again, confirmNeeded: true }
      notify?.({ workId, progress: Math.min(90, 50 + tick), status: '生成中', confirmSent: delivery.confirmSent, confirmNeeded: true, confirmNote: delivery.confirmNote })
      continue
    }
    notify?.({ workId, progress: Math.min(90, 50 + tick), status: '生成中', confirmSent: delivery.confirmSent, confirmNeeded: delivery.confirmNeeded, confirmNote: delivery.confirmNote })
    if (state.state === 'quota') {
      await endChain()
      return withConfirm({ ok: false, quota: true, saveDir: folder, message: '这个豆包账号额度不够' })
    }
    // 版权限制：同一条任务自动多发几次（新对话 + 图 + 提示词）
    if (state.state === 'retry_copyright' || state.copyrightMarker) {
      if (copyrightRetries >= maxCopyrightRetries) {
        await endChain()
        return withConfirm({
          ok: false,
          saveDir: folder,
          imagePaths: savedImages,
          message: `豆包连续 ${copyrightRetries} 次提示版权限制（${state.copyrightMarker || '请更换后重试'}），已停止本条`
        })
      }
      if (Date.now() - lastRetryAt < 8000) continue
      copyrightRetries += 1
      lastRetryAt = Date.now()
      const note = `豆包提示版权限制，正在第 ${copyrightRetries}/${maxCopyrightRetries} 次重发`
      delivery = { ...delivery, confirmNote: note }
      notify?.({ workId, progress: Math.min(90, 50 + tick), status: '生成中', confirmNote: note })
      const again = await resubmitDoubaoJob(win, { text, savedImages, filePayload, freshChat: true })
      delivery = { ...delivery, confirmNote: again.ok ? `${note}：${again.note}` : `${note}失败：${again.note}` }
      delivery = await ensureDelivered(win, snippet, notify, workId, before)
      continue
    }
    // 排队/无法并行：等一会再催发或重发
    if (state.state === 'retry_busy' || state.busyMarker) {
      if (busyRetries >= maxBusyRetries && Date.now() - waitStarted > 8 * 60 * 1000) {
        await endChain()
        return withConfirm({
          ok: false,
          saveDir: folder,
          imagePaths: savedImages,
          message: `豆包一直排队/占线（${state.busyMarker || '暂时无法并行'}），已停止本条`
        })
      }
      if (Date.now() - lastRetryAt < 20000) {
        delivery = { ...delivery, confirmNote: `豆包排队中，等待后再发（已重试 ${busyRetries}/${maxBusyRetries}）` }
        notify?.({ workId, progress: Math.min(90, 50 + tick), status: '生成中', confirmNote: delivery.confirmNote })
        continue
      }
      busyRetries += 1
      lastRetryAt = Date.now()
      const note = `豆包排队/无法并行，第 ${busyRetries}/${maxBusyRetries} 次再发`
      delivery = { ...delivery, confirmNote: note }
      notify?.({ workId, progress: Math.min(90, 50 + tick), status: '生成中', confirmNote: note })
      // 排队时先不急着新开对话，直接再发一次；第 3 次起换新对话
      const again = await resubmitDoubaoJob(win, {
        text,
        savedImages,
        filePayload,
        freshChat: busyRetries >= 3
      })
      delivery = { ...delivery, confirmNote: again.ok ? `${note}：${again.note}` : `${note}失败：${again.note}` }
      delivery = await ensureDelivered(win, snippet, notify, workId, before)
      continue
    }
    if (state.state === 'failed') {
      await endChain()
      return withConfirm({ ok: false, saveDir: folder, message: `豆包拒绝生成：${state.failMarker || '页面出现失败话术'}` })
    }
    {
      const midGate = await doubaoCaptcha.checkNow(win, captchaConfig, (data) => notify?.({ workId, progress: Math.min(90, 50 + tick), status: '生成中', ...data }))
      if (midGate.hit && !midGate.cleared) {
        await endChain()
        return withConfirm({ ok: false, saveDir: folder, message: midGate.error || '生成过程中验证码没有通过' })
      }
      if (midGate.hit && midGate.cleared) {
        delivery = { ...delivery, confirmNote: midGate.auto ? '生成中验证码已自动通过' : '生成中验证码已通过' }
      }
    }
    const nudgeTexts = (activeReplyRules?.nudge || []).map((item) => String(item || '').trim()).filter(Boolean)
    if (!nudged && nudgeTexts.length && !heldUrl && state.state !== 'ready' && !state.generating && !state.busyMarker && Date.now() - waitStarted >= 15000) {
      nudged = true
      const nudgeText = nudgeTexts[Math.floor(Math.random() * nudgeTexts.length)]
      await fillPrompt(win, nudgeText)
      await runInFrames(win, sendScript())
      delivery = { ...delivery, confirmNote: `等待超过 15 秒，已发送催促「${nudgeText}」` }
      notify?.({ workId, progress: Math.min(90, 50 + tick), status: '生成中', confirmNote: delivery.confirmNote })
    }
    if (chain && !heldUrl) heldUrl = await cleanUrlFromBodies(win.webContents.session, chain.bodies.splice(0))
    if (heldUrl) {
      const saved = await downloadCleanFile(heldUrl, file, win.webContents.session)
      if (saved) {
        await endChain()
        return withConfirm({
          ok: true,
          clean: true,
          videoPath: saved,
          saveDir: folder,
          doubaoChatUrl: win.webContents.getURL(),
          message: `已按豆包无水印地址保存成片。${delivery.confirmNote || ''}`
        })
      }
      heldUrl = ''
    }
    if (state.state !== 'ready' || !state.src) continue
    if (!readySince) readySince = Date.now()
    if (!reloaded && Date.now() - readySince >= 6000) {
      reloaded = true
      const current = win.webContents.getURL()
      if (current.includes('doubao.com')) {
        try { await loadPage(win, current) } catch { /* 刷新失败就继续等接口 */ }
        await wait(2200)
      }
    }
  }
  await endChain()
  const missed = readySince
    ? '页面上已经有成片，但没有拿到豆包无水印地址，所以没有保存带水印的画面。'
    : (savedImages.length ? '提示词和商品图已发送，网页还没有给出可下载的视频。' : '网页版豆包还没有给出可下载的视频。')
  const pageUrl = win.isDestroyed() ? '' : String(win.webContents.getURL() || '')
  return withConfirm({
    ok: false,
    saveDir: folder,
    imagePaths: savedImages,
    doubaoChatUrl: /doubao\.com\/chat\/[^/?#]+/i.test(pageUrl) ? pageUrl : '',
    message: `${missed}${delivery.confirmNote || ''}`
  })
}

function attachVideoScript(buffer, filename) {
  const payload = {
    base64: buffer.toString('base64'),
    name: filename || 'video.mp4',
    mime: /\.mov$/i.test(filename) ? 'video/quicktime' : /\.webm$/i.test(filename) ? 'video/webm' : 'video/mp4'
  }
  return `(() => {
    const item = ${JSON.stringify(payload)}
    const bytes = Uint8Array.from(atob(item.base64), (ch) => ch.charCodeAt(0))
    const file = new File([bytes], item.name, { type: item.mime })
    const inputs = []
    const walk = (root) => {
      if (!root || !root.querySelectorAll) return
      root.querySelectorAll('input[type="file"]').forEach((el) => inputs.push(el))
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot) })
    }
    walk(document)
    const input = inputs.find((el) => /video/i.test(el.accept || '')) || inputs[0]
    if (!input) return 'miss'
    const transfer = new DataTransfer()
    transfer.items.add(file)
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return 'file'
  })()`
}

function creatorBoxesScript() {
  return `(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect()
      return rect.width > 40 && rect.height > 12 && rect.bottom > 0 && rect.top < (window.innerHeight || 900)
    }
    const hint = (el) => [
      el.getAttribute('placeholder'),
      el.getAttribute('aria-label'),
      el.getAttribute('data-placeholder'),
      el.getAttribute('data-text'),
      el.className
    ].filter(Boolean).join(' ')
    const nearText = (el) => {
      const parent = el.closest('div, section, form, label') || el.parentElement
      return String(parent?.innerText || '').slice(0, 80)
    }
    const fields = []
    const walk = (root) => {
      if (!root || !root.querySelectorAll) return
      root.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]').forEach((el) => fields.push(el))
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot) })
    }
    walk(document)
    const usable = fields.filter(visible)
    const titleBox = usable.find((el) => /填写作品标题|作品标题|为作品获得更多流量|添加标题/.test(hint(el) + nearText(el)))
      || usable.find((el) => /标题/.test(hint(el)) && !/话题|好友|搜索/.test(hint(el) + nearText(el)))
      || usable.find((el) => el.tagName === 'INPUT' && el.maxLength >= 20 && el.maxLength <= 80)
      || usable.find((el) => el.getAttribute('contenteditable') === 'true' && !/话题|好友/.test(nearText(el)))
    const topicBox = usable.find((el) => el !== titleBox && /添加话题|话题|@好友|#/.test(hint(el) + nearText(el)))
      || usable.find((el) => el !== titleBox && (el.tagName === 'TEXTAREA' || el.getAttribute('contenteditable') === 'true'))
    window.__huangTitle = titleBox || null
    window.__huangBody = topicBox || null
    return titleBox ? 'title' : (topicBox ? 'partial' : 'miss')
  })()`
}

function writeEditable(elExpr, textExpr) {
  return `
    const __el = ${elExpr}
    const __text = ${textExpr}
    if (!__el || !__text) return 'miss'
    __el.focus()
    __el.click()
    const isEdit = __el.getAttribute('contenteditable') === 'true' || __el.getAttribute('role') === 'textbox'
    if (isEdit) {
      const sel = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(__el)
      sel.removeAllRanges()
      sel.addRange(range)
      document.execCommand('selectAll', false, null)
      document.execCommand('delete', false, null)
      const ok = document.execCommand('insertText', false, __text)
      if (!ok) {
        __el.textContent = __text
        __el.dispatchEvent(new InputEvent('input', { bubbles: true, data: __text, inputType: 'insertText' }))
      }
    } else {
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
        || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
      if (proto?.set) proto.set.call(__el, __text)
      else __el.value = __text
      __el.dispatchEvent(new InputEvent('input', { bubbles: true, data: __text, inputType: 'insertText' }))
      __el.dispatchEvent(new Event('change', { bubbles: true }))
    }
  `
}

function creatorTitleReadyScript() {
  return `(() => {
    const pick = () => Array.from(document.querySelectorAll('input')).find((el) => {
      const ph = String(el.placeholder || el.getAttribute('data-placeholder') || '')
      // 避开付费场景标题
      if (/付费场景/.test(ph)) return false
      const rect = el.getBoundingClientRect()
      return /填写作品标题/.test(ph) && rect.width > 40 && rect.height > 10
    }) || Array.from(document.querySelectorAll('input')).find((el) => {
      const ph = String(el.placeholder || '')
      if (/付费场景|搜索|链接|话题/.test(ph)) return false
      const rect = el.getBoundingClientRect()
      return /作品标题|添加标题/.test(ph) && rect.width > 40 && rect.height > 10
    })
    if (pick()) return 'input'
    // 只有简介框不算就绪，避免误把标题写进简介
    return 'miss'
  })()`
}

function setCreatorTitleScript(title) {
  const text = String(title || '').trim().slice(0, 30)
  return `(() => {
    const text = ${JSON.stringify(text)}
    if (!text) return 'miss'
    const visible = (el) => {
      const rect = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      return rect.width > 40 && rect.height > 10 && style.visibility !== 'hidden' && style.display !== 'none'
    }
    const findTitleInput = () => {
      const all = Array.from(document.querySelectorAll('input.semi-input, input[class*="title"], input, textarea'))
      return all.find((el) => {
        if (!visible(el)) return false
        const ph = String(el.placeholder || el.getAttribute('data-placeholder') || el.getAttribute('aria-label') || '')
        if (/付费场景|搜索|链接|话题|好友/.test(ph)) return false
        return /填写作品标题/.test(ph)
      }) || all.find((el) => {
        if (!visible(el)) return false
        const ph = String(el.placeholder || el.getAttribute('data-placeholder') || '')
        if (/付费场景|搜索|链接|话题|好友/.test(ph)) return false
        return /作品标题|添加标题/.test(ph)
      }) || all.find((el) => {
        if (!visible(el)) return false
        if (el.type === 'file' || el.type === 'hidden' || el.type === 'checkbox' || el.type === 'radio') return false
        return el.maxLength >= 20 && el.maxLength <= 55
      })
    }
    const fillReactInput = (el, value) => {
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
      el.focus()
      el.click()
      const tracker = el._valueTracker
      if (tracker) tracker.setValue('')
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
        || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
      if (proto?.set) proto.set.call(el, value)
      else el.value = value
      // 抖音 React 受控：onChange 读的是 event.target.value，不能只传 DOM 节点
      const propKey = Object.keys(el).find((key) => key.startsWith('__reactProps$') || key.startsWith('__reactEventHandlers$'))
      const props = propKey ? el[propKey] : null
      const fakeTarget = { value, checked: false, type: el.type || 'text' }
      if (props?.onChange) props.onChange({ target: fakeTarget, currentTarget: fakeTarget, type: 'change', bubbles: true })
      if (props?.onInput) props.onInput({ target: fakeTarget, currentTarget: fakeTarget, type: 'input', bubbles: true })
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const titleInput = findTitleInput()
    if (!titleInput) return 'miss'
    fillReactInput(titleInput, text)
    const wrote = String(titleInput.value || '').replace(/\\s+/g, '')
    const needle = text.replace(/\\s+/g, '').slice(0, 4)
    return needle && wrote.includes(needle) ? 'title' : (wrote.length ? 'partial' : 'miss')
  })()`
}

async function waitCreatorEditor(win, notify, workId) {
  for (let tick = 0; tick < 60; tick += 1) {
    if (win.isDestroyed()) return 'fail'
    // 关掉可能挡住标题框的引导浮层
    await runInFrames(win, `(() => {
      const nodes = Array.from(document.querySelectorAll('button, [role="button"], div, span'))
      const hit = nodes.find((el) => {
        const t = String(el.innerText || '').replace(/\\s+/g, '')
        return t === '我知道了' || t === '知道了' || t === '关闭' || t === '跳过'
      })
      if (hit) hit.click()
      document.querySelectorAll('.shepherd-modal-overlay-container, .shepherd-element, [class*="guide"], [class*="shepherd"]').forEach((el) => {
        try { el.style.pointerEvents = 'none'; el.remove() } catch (_) {}
      })
      return hit ? 'clicked' : 'miss'
    })()`).catch(() => {})
    const state = await runInFrames(win, creatorTitleReadyScript())
    if (state === 'input') return state
    if (tick % 5 === 0) notify?.({ workId, progress: Math.min(88, 50 + tick), status: '发布中', confirmNote: '等待抖音「填写作品标题」输入框' })
    await wait(800)
  }
  return 'miss'
}

async function fillCreatorTitleByCdp(win, text) {
  return useDebugger(win, async (dbg) => {
    const { root } = await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true })
    const selectors = [
      'input[placeholder*="填写作品标题"]',
      'input[placeholder*="作品标题"]',
      'input[placeholder*="添加标题"]'
    ]
    let nodeId = 0
    for (const selector of selectors) {
      const { nodeIds } = await dbg.sendCommand('DOM.querySelectorAll', { nodeId: root.nodeId, selector })
      if (nodeIds?.length) {
        nodeId = nodeIds[0]
        break
      }
    }
    if (!nodeId) return false
    await dbg.sendCommand('DOM.scrollIntoViewIfNeeded', { nodeId }).catch(() => {})
    const box = await dbg.sendCommand('DOM.getBoxModel', { nodeId }).catch(() => null)
    if (!box?.model?.content?.length) return false
    const c = box.model.content
    const x = Math.round((c[0] + c[2] + c[4] + c[6]) / 4)
    const y = Math.round((c[1] + c[3] + c[5] + c[7]) / 4)
    await dbg.sendCommand('DOM.focus', { nodeId }).catch(() => {})
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    await wait(100)
    await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, windowsVirtualKeyCode: 65, code: 'KeyA', key: 'a' })
    await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, windowsVirtualKeyCode: 65, code: 'KeyA', key: 'a' })
    await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 8, code: 'Backspace', key: 'Backspace' })
    await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, code: 'Backspace', key: 'Backspace' })
    await dbg.sendCommand('Input.insertText', { text })
    return true
  }).catch(() => false)
}

async function fillCreatorTitle(win, title) {
  const text = String(title || '').trim().slice(0, 30)
  if (!text || !win || win.isDestroyed()) return 'miss'
  let titled = 'miss'
  for (let attempt = 0; attempt < 8 && titled !== 'title'; attempt += 1) {
    titled = await runInFrames(win, setCreatorTitleScript(text))
    if (titled === 'title') return titled
    // CDP：用 getBoxModel 拿顶层绝对坐标（iframe 内 getBoundingClientRect 会偏）
    await fillCreatorTitleByCdp(win, text)
    await wait(400)
    titled = await runInFrames(win, setCreatorTitleScript(text))
    if (titled === 'title') return titled
    const checked = await evalInFrames(win, `(() => {
      const text = ${JSON.stringify(text)}
      const needle = text.replace(/\\s+/g, '').slice(0, 4)
      const el = Array.from(document.querySelectorAll('input')).find((item) => {
        const ph = String(item.placeholder || '')
        return /填写作品标题|作品标题/.test(ph) && !/付费场景/.test(ph)
      })
      const wrote = String(el?.value || '').replace(/\\s+/g, '')
      return needle && wrote.includes(needle) ? 'title' : 'miss'
    })()`)
    if (checked === 'title') return 'title'
    await wait(450)
  }
  return titled
}

function insertCreatorTagScript(tag) {
  return `(() => {
    ${creatorBoxesScript().replace('return titleBox ? \'title\' : (topicBox ? \'partial\' : \'miss\')', 'void 0')}
    let box = window.__huangBody
    const tag = ${JSON.stringify(String(tag || '').replace(/^#/, ''))}
    if (!tag) return 'miss'
    if (!box) {
      const ph = Array.from(document.querySelectorAll('*')).find((el) => /#添加话题|添加话题\\s*@好友/.test(String(el.textContent || el.getAttribute('placeholder') || '')) && el.getBoundingClientRect().height > 8)
      box = ph?.closest('[contenteditable], [role="textbox"]') || ph?.parentElement?.querySelector('[contenteditable="true"], input, textarea') || null
      window.__huangBody = box
    }
    if (!box) return 'miss'
    box.focus()
    box.click()
    const payload = '#' + tag
    const isEdit = box.getAttribute('contenteditable') === 'true' || box.getAttribute('role') === 'textbox'
    if (isEdit) {
      const sel = window.getSelection()
      if (sel) {
        const range = document.createRange()
        range.selectNodeContents(box)
        range.collapse(false)
        sel.removeAllRanges()
        sel.addRange(range)
      }
      document.execCommand('insertText', false, ' ' + payload)
    } else {
      const next = String(box.value || '') + ' ' + payload
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
        || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
      if (proto?.set) proto.set.call(box, next)
      else box.value = next
      box.dispatchEvent(new InputEvent('input', { bubbles: true, data: payload, inputType: 'insertText' }))
    }
    return 'typed'
  })()`
}

function pickCreatorTagScript(tag) {
  return `(() => {
    const tag = ${JSON.stringify(String(tag || '').replace(/^#/, ''))}
    const compact = (value) => String(value || '').replace(/\\s+/g, '')
    const nodes = []
    const walk = (root) => {
      if (!root || !root.querySelectorAll) return
      root.querySelectorAll('li, [role="option"], button, div, span').forEach((el) => nodes.push(el))
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot) })
    }
    walk(document)
    const hit = nodes.find((el) => {
      const rect = el.getBoundingClientRect()
      const text = compact(el.innerText || el.textContent)
      if (rect.left < 180) return false
      if (!(rect.width > 20 && rect.height > 12 && rect.height < 90)) return false
      if (el.children && el.children.length > 4) return false
      if (!text.startsWith('#')) return false
      const bare = text.replace(/^#/, '').replace(/\\d+$/, '')
      return bare === tag
    })
    if (hit) {
      hit.click()
      return 'picked'
    }
    // 不再按 Enter，避免跳页/跳到 AI 分身
    return 'miss'
  })()`
}

function pickRecommendedTopicsScript(tags) {
  const list = (Array.isArray(tags) ? tags : []).map((item) => String(item || '').replace(/^#/, '')).filter(Boolean).slice(0, 5)
  return `(() => {
    const tags = ${JSON.stringify(list)}
    if (!tags.length) return JSON.stringify([])
    const compact = (value) => String(value || '').replace(/\\s+/g, '')
    const nodes = []
    const walk = (root) => {
      if (!root || !root.querySelectorAll) return
      root.querySelectorAll('button, div, span, a, li').forEach((el) => nodes.push(el))
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot) })
    }
    walk(document)
    const chips = nodes.filter((el) => {
      const rect = el.getBoundingClientRect()
      const text = compact(el.innerText || el.textContent)
      if (rect.left < 180) return false
      return rect.width > 24 && rect.height > 14 && rect.height < 72 && /^#/.test(text) && text.length <= 20 && (el.children?.length || 0) < 4
    })
    const placed = []
    const used = new Set()
    for (const tag of tags) {
      const hit = chips.find((el) => {
        if (used.has(el)) return false
        const bare = compact(el.innerText || el.textContent).replace(/^#/, '')
        return bare === tag || bare.includes(tag) || (tag.length >= 2 && tag.includes(bare))
      })
      if (!hit) continue
      used.add(hit)
      hit.click()
      placed.push(tag)
      if (placed.length >= 3) break
    }
    return JSON.stringify(placed)
  })()`
}

function clickPublishScript() {
  return `(() => {
    const compact = (value) => String(value || '').replace(/\\s+/g, '')
    const buttons = []
    const walk = (root) => {
      if (!root || !root.querySelectorAll) return
      root.querySelectorAll('button, [role="button"], span, div, a').forEach((el) => buttons.push(el))
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot) })
    }
    walk(document)
    const order = { '确认发布': 0, '确定发布': 1, '立即发布': 2, '发布作品': 3, '发布': 4 }
    const candidates = []
    for (const el of buttons) {
      const text = compact(el.innerText || el.textContent)
      if (!Object.prototype.hasOwnProperty.call(order, text)) continue
      const rect = el.getBoundingClientRect()
      if (!(rect.width > 56 && rect.height > 24)) continue
      if (rect.bottom < 0 || rect.top > window.innerHeight + 80) continue
      const disabled = Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true' || /disabled|is-disabled/.test(String(el.className || ''))
      candidates.push({ el, text, disabled, top: rect.top, left: rect.left })
    }
    candidates.sort((a, b) => {
      if (order[a.text] !== order[b.text]) return order[a.text] - order[b.text]
      if (a.disabled !== b.disabled) return a.disabled ? 1 : -1
      return b.top - a.top || b.left - a.left
    })
    const hit = candidates.find((item) => !item.disabled)
    if (!hit) return candidates.length ? 'disabled' : 'miss'
    const target = hit.el.closest('button, [role="button"]') || hit.el
    target.click()
    return hit.text === '发布' ? 'published' : 'confirm'
  })()`
}

function uploadReadyScript() {
  return `(() => {
    const body = String(document.body?.innerText || '')
    // 预览失败 / 服务器开小差：要重新上传，不能当成功
    if (/预览失败|服务器开小差|服务开小差|上传失败|网络异常|请稍后重试/.test(body)) {
      if (/预览失败|失败|开小差|异常|重试|重新上传|可再次尝试/.test(body)) return 'fail'
    }
    if (/上传中|转码中|处理中|\\d+%/.test(body) && !/上传完成|重新上传|服务器开小差|预览失败/.test(body)) return 'wait'
    const buttons = []
    const walk = (root) => {
      if (!root || !root.querySelectorAll) return
      root.querySelectorAll('button, [role="button"]').forEach((el) => buttons.push(el))
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot) })
    }
    walk(document)
    const publish = buttons.find((el) => {
      const text = String(el.innerText || '').replace(/\\s+/g, '')
      return (text === '发布' || text === '定时发布') && !el.disabled && el.getAttribute('aria-disabled') !== 'true'
    })
    if (publish && !/预览失败|服务器开小差/.test(body)) return 'ready'
    const titleInput = Array.from(document.querySelectorAll('input')).some((el) => /填写作品标题|作品标题/.test(String(el.placeholder || '')))
    if (titleInput && !/预览失败|服务器开小差/.test(body)) return 'ready'
    if (/上传完成|封面|作品描述|添加话题|填写作品标题/.test(body) && !/服务器开小差|上传失败|预览失败/.test(body)) return 'ready'
    return 'wait'
  })()`
}

/** 发文助手 / 发布助手 / 快速检测 状态 */
function publishAssistScript() {
  return `(() => {
    const compact = (value) => String(value || '').replace(/\\s+/g, '')
    const body = compact(document.body?.innerText || '')
    const hasAssist = /发文助手|发布助手|内容检测|风险检测|快速检测/.test(body)
    const checking = /检测中|正在检测|分析中|识别中/.test(body)
    // 「作品未见异常」是当前快速检测通过文案；封面缺失提示不算风险
    const pass = /作品未见异常|未见异常|暂未发现|未发现问题|未发现风险|检测通过|可正常发布|暂无风险|未检出风险|没有发现异常/.test(body)
    const risk = /存在风险|建议修改文案|不合规|可能违规|不适合展示|检测到风险|禁止发布|无法发布/.test(body)
      && !/双封面缺失|建议同时设置横版|建议同时设置竖版|为增加作品的流量/.test(body)
    const nodes = Array.from(document.querySelectorAll('button, [role="button"], a, span, div'))
    const recheck = nodes.find((el) => {
      const text = compact(el.innerText || el.textContent)
      if (!text || text.length > 12) return false
      const rect = el.getBoundingClientRect()
      if (!(rect.width > 20 && rect.height > 12)) return false
      return text === '重新检测' || text === '再次检测' || text === '重新识别' || text === '再检测一次'
    })
    if (checking) return 'checking'
    if (pass) return 'pass'
    if (recheck && risk) return 'recheck'
    if (risk) return 'risk'
    if (hasAssist) return 'wait'
    return 'miss'
  })()`
}

function dismissAssistPanelScript() {
  return `(() => {
    const compact = (value) => String(value || '').replace(/\\s+/g, '')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    const nodes = Array.from(document.querySelectorAll('button, [role="button"], span, div, a, i, svg'))
    const closer = nodes.find((el) => {
      const label = compact(el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '')
      const cls = String(el.className || '') + String(el.getAttribute('aria-label') || '')
      const rect = el.getBoundingClientRect()
      if (!(rect.width > 8 && rect.height > 8 && rect.width < 64 && rect.height < 64)) {
        if (!(label === '关闭' || label === '我知道了' || label === '完成' || label === '继续发布' || label === '知道了')) return false
      }
      if (label === '关闭' || label === '我知道了' || label === '完成' || label === '继续发布' || label === '知道了') return true
      return /close|关闭|icon-close|btn-close|semi-icons-close/i.test(cls)
    })
    if (closer) {
      (closer.closest('button, [role="button"], a') || closer).click()
      return 'closed'
    }
    // 点一下空白处，收起快速检测浮层
    document.body?.click?.()
    return 'ok'
  })()`
}

function clickRecheckAssistScript() {
  return `(() => {
    const compact = (value) => String(value || '').replace(/\\s+/g, '')
    const nodes = Array.from(document.querySelectorAll('button, [role="button"], a, span, div'))
    const hit = nodes.find((el) => {
      const text = compact(el.innerText || el.textContent)
      if (!text || text.length > 12) return false
      const rect = el.getBoundingClientRect()
      if (!(rect.width > 20 && rect.height > 12)) return false
      return text === '重新检测' || text === '再次检测' || text === '重新识别' || text === '再检测一次'
    })
    if (!hit) return 'miss'
    hit.click()
    return 'clicked'
  })()`
}

async function attachVideoByPath(win, videoPath) {
  const abs = path.resolve(String(videoPath || ''))
  if (!abs || !fs.existsSync(abs)) return false
  return useDebugger(win, async (dbg) => {
    const { root } = await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true })
    const { nodeIds } = await dbg.sendCommand('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'input[type="file"]' })
    if (!nodeIds?.length) return false
    let chosen = nodeIds[0]
    for (const nodeId of nodeIds) {
      const { node } = await dbg.sendCommand('DOM.describeNode', { nodeId })
      const attrs = node.attributes || []
      for (let index = 0; index < attrs.length; index += 2) {
        if (attrs[index] === 'accept' && /video|mp4|mov|webm|\*/i.test(attrs[index + 1] || '')) chosen = nodeId
      }
    }
    await dbg.sendCommand('DOM.setFileInputFiles', { nodeId: chosen, files: [abs] })
    return true
  }).catch(() => false)
}

async function attachVideoViaChooser(win, videoPath) {
  const abs = path.resolve(String(videoPath || ''))
  if (!abs || !fs.existsSync(abs)) return false
  const dbg = win.webContents.debugger
  const attachedHere = !dbg.isAttached()
  let opened = false
  const onMessage = async (_event, method) => {
    if (method !== 'Page.fileChooserOpened' || opened) return
    opened = true
    try { await dbg.sendCommand('Page.handleFileChooser', { action: 'accept', files: [abs] }) } catch { /* 选择框已关 */ }
  }
  dbg.on('message', onMessage)
  try {
    if (attachedHere) dbg.attach('1.3')
    await dbg.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true })
    await runInFrames(win, clickByLabelsScript(['上传视频', '点击上传', '选择文件', '添加视频', '重新上传'], 16))
    for (let tick = 0; tick < 20 && !opened; tick += 1) await wait(200)
    await wait(600)
    return opened
  } catch {
    return false
  } finally {
    dbg.off('message', onMessage)
    try { await dbg.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false }) } catch { /* ignore */ }
    if (attachedHere && dbg.isAttached()) {
      try { dbg.detach() } catch { /* ignore */ }
    }
  }
}

async function attachCreatorVideo(win, videoPath) {
  // 优先本机路径直传，避免把整段视频塞进页面内存（容易「服务器开小差」）
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await attachVideoByPath(win, videoPath)) return 'file'
    await wait(400)
  }
  if (await attachVideoViaChooser(win, videoPath)) return 'file'
  // 仅小文件才走内存兜底；大文件会撑爆页面导致上传失败
  try {
    const size = fs.statSync(videoPath).size
    if (size > 8 * 1024 * 1024) return 'miss'
  } catch {
    return 'miss'
  }
  const buffer = fs.readFileSync(videoPath)
  const attached = await runInFrames(win, attachVideoScript(buffer, path.basename(videoPath)))
  return attached === 'file' ? 'file' : 'miss'
}

function clickByLabelsScript(labels, maxLen = 24) {
  return `(() => {
    const labels = ${JSON.stringify(labels)}
    const maxLen = ${Number(maxLen) || 24}
    const compact = (value) => String(value || '').replace(/\\s+/g, '')
    const bannedNav = /AI分身|内容管理|数据中心|变现|首页|创作灵感|直播|千川/
    const nodes = []
    const walk = (root) => {
      if (!root || !root.querySelectorAll) return
      root.querySelectorAll('button, [role="button"], label, span, div, a, li, p').forEach((el) => nodes.push(el))
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot) })
    }
    walk(document)
    const hits = nodes.filter((el) => {
      const text = compact(el.innerText || el.getAttribute('aria-label') || '')
      const rect = el.getBoundingClientRect()
      if (!text || text.length > maxLen || rect.width <= 18 || rect.height <= 10) return false
      if (rect.left < 180 && rect.width < 220) return false
      if (bannedNav.test(text)) return false
      if (el.closest('nav, [class*="menu"], [class*="sider"], [class*="sidebar"], [class*="left"]')) return false
      return labels.some((label) => text === label || (label.length >= 4 && text.includes(label)))
    })
    hits.sort((a, b) => compact(a.innerText).length - compact(b.innerText).length)
    if (!hits[0]) return 'miss'
    hits[0].click()
    return 'clicked'
  })()`
}

function fillVisibleInputScript(value, hints = []) {
  return `(() => {
    const value = ${JSON.stringify(String(value || ''))}
    const hints = ${JSON.stringify(hints)}
    if (!value) return 'miss'
    const fields = []
    const walk = (root) => {
      if (!root || !root.querySelectorAll) return
      root.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]').forEach((el) => fields.push(el))
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot) })
    }
    walk(document)
    const banned = /填写作品标题|作品标题|为作品获得更多流量|添加话题|@好友|作品描述|简介|谁可以看/
    const usable = fields.filter((el) => {
      const rect = el.getBoundingClientRect()
      if (!(rect.width > 60 && rect.height > 16 && rect.bottom > 0 && rect.top < window.innerHeight)) return false
      const near = String((el.closest('div,section,form,label') || el).innerText || '').slice(0, 80)
      const hint = ((el.placeholder || '') + (el.getAttribute('aria-label') || '') + (el.getAttribute('data-placeholder') || '') + (el.name || '') + near)
      // 绝不能把商品链接填进标题/话题框
      if (banned.test(hint)) return false
      if (el.getAttribute('contenteditable') === 'true' && /标题|话题/.test(near)) return false
      return true
    })
    const box = usable.find((el) => {
      const near = String((el.closest('div,section,form,label') || el).innerText || '').slice(0, 80)
      const hint = ((el.placeholder || '') + (el.getAttribute('aria-label') || '') + (el.getAttribute('data-placeholder') || '') + (el.name || '') + near).toLowerCase()
      return hints.some((item) => hint.includes(String(item).toLowerCase()))
    }) || usable.find((el) => {
      const hint = ((el.placeholder || '') + (el.getAttribute('aria-label') || '')).toLowerCase()
      return /链接|http|url|粘贴|商品id|goods/.test(hint) || el.type === 'url'
    })
    // 没有明确的链接输入框就放弃，绝不回退到标题框
    if (!box) return 'miss'
    box.focus()
    box.click()
    if (box.getAttribute('contenteditable') === 'true') {
      box.textContent = ''
      document.execCommand('insertText', false, value)
    } else {
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
        || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
      if (proto?.set) proto.set.call(box, value)
      else box.value = value
    }
    box.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }))
    box.dispatchEvent(new Event('change', { bubbles: true }))
    return 'filled'
  })()`
}

function setScheduleDateScript(days) {
  const date = new Date()
  date.setDate(date.getDate() + Math.max(0, Number(days) || 0))
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const clock = '12:00'
  const targetMonth = date.getMonth() + 1
  return `(() => {
    const stamp = ${JSON.stringify(stamp)}
    const clock = ${JSON.stringify(clock)}
    const day = ${JSON.stringify(String(date.getDate()))}
    const targetMonth = ${targetMonth}
    const notes = []
    const fields = []
    const walk = (root) => {
      if (!root || !root.querySelectorAll) return
      root.querySelectorAll('input, textarea, [contenteditable="true"]').forEach((el) => fields.push(el))
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot) })
    }
    walk(document)
    const setValue = (el, value) => {
      el.focus()
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
        || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
      if (proto?.set) proto.set.call(el, value)
      else if (el.getAttribute('contenteditable') === 'true') {
        el.textContent = value
        document.execCommand('insertText', false, value)
      } else el.value = value
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    for (const el of fields) {
      const hint = ((el.placeholder || '') + (el.getAttribute('aria-label') || '') + (el.type || '')).toLowerCase()
      const rect = el.getBoundingClientRect()
      if (rect.width < 40 || rect.height < 12) continue
      if (/date|日期|定时/.test(hint) || el.type === 'date') {
        el.click()
        setValue(el, stamp)
        notes.push('date')
      } else if (/time|时间/.test(hint) || el.type === 'time') {
        el.click()
        setValue(el, clock)
        notes.push('time')
      }
    }
    // 日历改版：先找「下月」把面板翻到目标月，再点日期格（避免点到上月同号）
    const nextBtn = Array.from(document.querySelectorAll('button, span, div, a')).find((el) => {
      const text = String(el.innerText || el.getAttribute('aria-label') || '').replace(/\\s+/g, '')
      const rect = el.getBoundingClientRect()
      return rect.width > 12 && rect.height > 12 && rect.width < 48 && (/下一月|下个月|next/i.test(text) || el.className && /next|arrow-right|right/.test(String(el.className)))
    })
    const panelText = String(document.body?.innerText || '').slice(0, 8000)
    if (nextBtn && !panelText.includes(targetMonth + '月') && !panelText.includes(stamp.slice(0, 7))) {
      nextBtn.click()
      notes.push('next')
    }
    const cells = Array.from(document.querySelectorAll('td, [role="gridcell"], button, span, div'))
    const dayCells = cells.filter((el) => {
      const text = String(el.innerText || '').trim()
      const rect = el.getBoundingClientRect()
      const cls = String(el.className || '')
      const disabled = el.getAttribute('aria-disabled') === 'true' || /disabled|禁用|灰/.test(cls + (el.getAttribute('aria-label') || ''))
      return !disabled && text === day && rect.width > 18 && rect.height > 18 && rect.width < 64 && rect.height < 64
    })
    const dayCell = dayCells.find((el) => !/prev|previous|上月|last-month/i.test(String(el.className || ''))) || dayCells[0]
    if (dayCell) {
      dayCell.click()
      notes.push('day')
    }
    return notes.length ? 'filled' : 'miss'
  })()`
}

async function applyPublishOptions(win, options = {}, productLink = '') {
  const notes = []
  if (options.dyDeclare) {
    // 绝不能用短词「AI」，会点到左侧「AI分身」
    const clicked = await runInFrames(win, clickByLabelsScript(['AI自主声明', '内容由AI生成', '自主声明', '内容声明', '声明原创'], 28))
    if (clicked === 'clicked') notes.push('declare')
  }
  if (options.dyPrivate) {
    await runInFrames(win, clickByLabelsScript(['谁可以看', '可见范围', '权限设置']))
    await wait(400)
    const clicked = await runInFrames(win, clickByLabelsScript(['私密', '仅自己可见', '仅自己']))
    if (clicked === 'clicked') notes.push('private')
  }
  if (options.dyCart) {
    if (!productLink) {
      notes.push('cart-no-link')
    } else {
      let cartOk = false
      for (let attempt = 0; attempt < 5 && !cartOk; attempt += 1) {
        // 结构改版时入口文案会变，多轮点开再填链接
        await runInFrames(win, clickByLabelsScript([
          '添加标签和商品', '添加商品', '挂载购物车', '商品链接', '添加链接',
          '关联商品', '选择商品', '挂载购物车', '带货'
        ], 32))
        await wait(650 + attempt * 120)
        const filled = await runInFrames(win, fillVisibleInputScript(productLink, ['商品链接', '粘贴商品', '粘贴链接', 'http', 'https', 'goods', 'url', '请输入链接', '商品id']))
        if (filled === 'filled') {
          await wait(350)
          await runInFrames(win, clickByLabelsScript(['添加', '确定', '完成', '确认', '挂载', '保存']))
          await wait(550)
          // 二次确认：有的改版要再点一次「添加」才真正挂上
          await runInFrames(win, clickByLabelsScript(['添加', '确定', '完成']))
          await wait(400)
          // 挂上车后勾选对应商品（页面改版时按链接/商品字样找复选框）
          await runInFrames(win, `(() => {
            const link = ${JSON.stringify(String(productLink || ''))}
            const boxes = Array.from(document.querySelectorAll('input[type="checkbox"], [role="checkbox"]'))
            const hit = boxes.find((box) => {
              const wrap = box.closest('label,li,div,tr,section') || box
              const text = String(wrap.innerText || '')
              return text.includes(link) || /已添加|购物车|商品/.test(text)
            })
            if (!hit) return 'miss'
            const checked = hit.checked === true || hit.getAttribute('aria-checked') === 'true'
            if (!checked) hit.click()
            return 'clicked'
          })()`)
          cartOk = true
          notes.push('cart')
        } else {
          await wait(450)
        }
      }
      if (!cartOk) notes.push('cart-miss')
    }
  }
  if (options.dySchedule) {
    let scheduleOk = false
    for (let attempt = 0; attempt < 5 && !scheduleOk; attempt += 1) {
      await runInFrames(win, clickByLabelsScript(['定时发布', '定时发布作品', '定时', '发布时间', '预约发布'], 24))
      await wait(600 + attempt * 100)
      // 有的改版要再点一次日期输入框才弹出日历
      await runInFrames(win, clickByLabelsScript(['选择日期', '日期', '时间', stampHint(options.dyDelay || 0)], 28))
      await wait(400)
      const filled = await runInFrames(win, setScheduleDateScript(options.dyDelay || 0))
      if (filled === 'filled') {
        await wait(350)
        await runInFrames(win, clickByLabelsScript(['确定', '完成', '确认', '选好了', 'OK']))
        await wait(300)
        // 日历改版后偶发要点两次确定
        await runInFrames(win, clickByLabelsScript(['确定', '完成', '确认']))
        scheduleOk = true
        notes.push('schedule')
      } else {
        await wait(450)
      }
    }
    if (!scheduleOk) notes.push('schedule-miss')
  }
  return notes
}

function stampHint(days) {
  const date = new Date()
  date.setDate(date.getDate() + Math.max(0, Number(days) || 0))
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

async function waitUploadReady(win, notify, workId) {
  for (let tick = 0; tick < 90; tick += 1) {
    if (win.isDestroyed()) return 'fail'
    const state = await runInFrames(win, uploadReadyScript())
    if (state === 'ready') return 'ready'
    if (state === 'fail') return 'fail'
    if (tick % 5 === 0) notify?.({ workId, progress: Math.min(90, 40 + tick), status: '发布中', confirmNote: '等待抖音上传完成后再点发布' })
    await wait(1000)
  }
  return 'wait'
}

/** 预览失败 / 开小差：点重新上传并再贴成片，最多多轮 */
async function recoverCreatorUpload(win, videoPath, notify, workId) {
  notify?.({ workId, status: '发布中', confirmNote: '检测到预览失败/服务器错误，正在重新上传' })
  await runInFrames(win, clickByLabelsScript(['重新上传', '更换视频', '删除视频', '再次尝试重新上传', '可再次尝试'], 20))
  await wait(900)
  let attached = await attachCreatorVideo(win, videoPath)
  if (attached !== 'file') {
    await wait(600)
    attached = await attachCreatorVideo(win, videoPath)
  }
  if (attached !== 'file') return 'miss'
  return waitUploadReady(win, notify, workId)
}

/** 发布前：等发文助手/快速检测；通过后收起面板继续点发布 */
async function ensurePublishAssist(win, notify, workId) {
  let rechecked = false
  let last = 'miss'
  for (let tick = 0; tick < 40; tick += 1) {
    if (win.isDestroyed()) return { state: 'fail', note: '窗口已关' }
    last = await runInFrames(win, publishAssistScript())
    if (last === 'pass') {
      notify?.({ workId, progress: 94, status: '发布中', confirmNote: '快速检测通过（作品未见异常），继续发布' })
      await runInFrames(win, dismissAssistPanelScript()).catch(() => {})
      await wait(400)
      return { state: 'pass', note: '发文助手检测通过' }
    }
    if (last === 'checking' || last === 'wait') {
      if (tick % 4 === 0) notify?.({ workId, progress: 93, status: '发布中', confirmNote: '等待发文助手/快速检测完成' })
      await wait(1200)
      continue
    }
    if ((last === 'recheck' || last === 'risk') && !rechecked) {
      rechecked = true
      notify?.({ workId, progress: 93, status: '发布中', confirmNote: '发文助手需重新检测，正在点击重新检测' })
      await runInFrames(win, clickRecheckAssistScript())
      await wait(1500)
      continue
    }
    if (last === 'risk' && rechecked) {
      return { state: 'risk', note: '发文助手仍提示风险，请在窗口里按提示修改后再发' }
    }
    if (last === 'miss') {
      if (tick >= 6) return { state: 'skip', note: '未看到发文助手，继续发布' }
      await wait(800)
      continue
    }
    await wait(1000)
  }
  if (last === 'pass') {
    await runInFrames(win, dismissAssistPanelScript()).catch(() => {})
    return { state: 'pass', note: '发文助手检测通过' }
  }
  if (last === 'risk') return { state: 'risk', note: '发文助手仍提示风险，未自动发布' }
  // 超时但页面已出现「未见异常」类结果时，按通过继续，避免卡死
  const body = await win.webContents.executeJavaScript(`String(document.body?.innerText||'')`, true).catch(() => '')
  if (/作品未见异常|未见异常|检测通过|可正常发布/.test(String(body || ''))) {
    await runInFrames(win, dismissAssistPanelScript()).catch(() => {})
    return { state: 'pass', note: '快速检测已通过，继续发布' }
  }
  return { state: 'timeout', note: '发文助手检测超时，请在窗口里确认后再发' }
}

async function publishOnCreator(payload) {
  try {
    return await publishOnCreatorInner(payload)
  } catch (error) {
    const msg = String(error?.message || error || '')
    if (/destroyed|Object has been destroyed/i.test(msg)) {
      return { ok: false, attached: false, loginStatus: '待确认', message: '发布窗口被关掉或刷新了，请再点一次「发布到抖音」' }
    }
    return { ok: false, attached: false, loginStatus: '待确认', message: msg || '发布过程出错' }
  }
}

async function publishOnCreatorInner({ id, name, login, mode, videoPath, title, tags, options, productLink, workId, notify }) {
  const page = 'https://creator.douyin.com/creator-micro/content/upload'
  const opts = options && typeof options === 'object' ? options : {}
  // 先静默看 cookie，避免定时任务先 ensure 再 open 导致连刷两轮
  const ensured = await ensurePublishLogin({ id, name, login, mode: mode || 'password', url: page, cookieOnly: true })
  if (!ensured.ok) {
    notify?.({ workId, status: '发布中', confirmNote: ensured.message || '需要先登录创作者中心' })
  }
  // 复用已有窗口；已在上传页则 openAccount/bridge 不会再连环跳转
  const opened = await openAccount({
    kind: 'publish',
    id,
    name,
    login,
    mode: mode || 'password',
    url: page,
    already: ensured.loginStatus === '已登录' || ensured.ok
  })
  const loginStatus = opened?.loginStatus || ensured.loginStatus || '待确认'
  const win = windows.get(sessionKey('publish', id, page)) || findPublishMainWindow(id)
  if (!win || win.isDestroyed()) {
    return {
      ok: false,
      attached: false,
      loginStatus,
      message: ensured.ok
        ? '发布窗口没有打开'
        : (ensured.message || '请先手动打开创作者中心登录一次，再跑定时')
    }
  }
  windows.set(sessionKey('publish', id, page), win)
  try { win.setTitle(`${name || '发布账号'} · 上传成片`) } catch { /* 窗口已关 */ }
  // 已登录则不强行抢焦点刷屏；未登录才置前方便扫码
  try {
    const cookies = await win.webContents.session.cookies.get({})
    if (creatorLoggedIn(cookies)) opened.loginStatus = '已登录'
  } catch { /* ignore */ }
  const wall = await runInFrames(win, creatorLoginWallScript()).catch(() => 'unknown')
  if (wall === 'wall' || opened?.loginStatus !== '已登录') {
    if (wall === 'wall') {
      bringToFront(win)
      return {
        ok: false,
        attached: false,
        loginStatus: '待确认',
        message: '创作者中心未登录。请在本窗口扫一次抖音后，再点发布/等定时；登录后不会反复刷新'
      }
    }
  } else {
    // 已登录：轻量置前一次即可
    try { if (!win.isFocused()) bringToFront(win) } catch { /* ignore */ }
  }
  if (!videoPath || !fs.existsSync(videoPath)) {
    return { ok: false, attached: false, loginStatus: opened.loginStatus || loginStatus, message: '成片文件不在电脑上' }
  }
  const stat = fs.statSync(videoPath)
  if (stat.size > 80 * 1024 * 1024) {
    return { ok: true, attached: false, loginStatus: opened.loginStatus, message: '视频超过 80MB，已打开这个账号的上传页，请在窗口里手动选择成片' }
  }
  let attached = 'miss'
  for (let attempt = 0; attempt < 3 && attached !== 'file'; attempt += 1) {
    await wait(700)
    if (win.isDestroyed()) break
    attached = await attachCreatorVideo(win, videoPath)
  }
  bringToFront(win)
  if (attached !== 'file') {
    const signed = opened.loginStatus === '已登录'
    return {
      ok: false,
      attached: false,
      loginStatus: opened.loginStatus,
      message: signed ? '抖音上传页已打开，但没有放进成片。请在窗口里再选一次文件。' : '创作者中心还没登录。请在打开的窗口里登录，然后再点发布。'
    }
  }
  let uploadState = await waitUploadReady(win, notify, workId)
  // 预览失败 / 服务器开小差：自动多轮重新上传
  for (let retry = 0; retry < 3 && uploadState === 'fail'; retry += 1) {
    uploadState = await recoverCreatorUpload(win, videoPath, notify, workId)
  }
  if (uploadState === 'fail' || uploadState === 'miss') {
    return {
      ok: false,
      attached: true,
      loginStatus: opened.loginStatus,
      message: '抖音上传失败（预览失败/服务器开小差）。已自动重试仍失败，请在窗口里点「重新上传」后再发。'
    }
  }
  await wait(800)
  // 过滤掉链接/过长脏标签，避免话题框出现 haohuo 链接
  const topicTags = opts.dyTags === false
    ? []
    : (Array.isArray(tags) ? tags.map((item) => String(item || '').replace(/^#/, '').trim())
      .filter((item) => item && item.length >= 2 && item.length <= 12 && !/^https?:/i.test(item) && !/haohuo|jinritemai|douyin\.com/i.test(item))
      .slice(0, 5) : [])
  const shortTitle = String(title || '').replace(/https?:\/\/\S+/gi, '').trim().slice(0, 30)
  // 等发布编辑页「填写作品标题」输入框（上传/转码完成后才有）
  const editorReady = await waitCreatorEditor(win, notify, workId)
  if (editorReady === 'miss') {
    notify?.({ workId, status: '发布中', confirmNote: '还没等到标题框，先继续填选项' })
  }
  // 先写标题（挂车弹层容易冲掉标题，所以前后各写一次）
  let titled = shortTitle ? 'miss' : 'skip'
  if (shortTitle) {
    notify?.({ workId, progress: 86, status: '发布中', confirmNote: `正在填写作品标题：${shortTitle}` })
    titled = await fillCreatorTitle(win, shortTitle)
  }
  const optionNotes = await applyPublishOptions(win, opts, productLink)
  await wait(600)
  await waitCreatorEditor(win, notify, workId)
  if (shortTitle) {
    titled = await fillCreatorTitle(win, shortTitle)
  }
  const placed = []
  const topicLimit = 5
  if (topicTags.length) {
    for (const tag of topicTags.slice(0, topicLimit)) {
      if (placed.length >= topicLimit) break
      const already = await runInFrames(win, `(() => {
        const box = window.__huangBody
        const text = String(box?.innerText || box?.textContent || box?.value || '')
        return (text.match(/#[^#\\s]{1,16}/g) || []).length
      })()`).catch(() => 0)
      if (Number(already) >= topicLimit) break
      const typed = await runInFrames(win, insertCreatorTagScript(tag))
      if (typed === 'miss') continue
      await wait(280)
      const picked = await runInFrames(win, pickCreatorTagScript(tag))
      if (picked === 'picked' || typed === 'typed') placed.push(tag)
      if (placed.length >= topicLimit) break
      await wait(180)
    }
  }
  // 话题后再写一次标题，防止弹层/误填冲掉
  if (shortTitle) {
    notify?.({ workId, progress: 92, status: '发布中', confirmNote: `确认作品标题：${shortTitle}` })
    titled = await fillCreatorTitle(win, shortTitle)
  }
  // 收起话题下拉，避免挡住发布
  await runInFrames(win, `(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return 'ok'
  })()`).catch(() => {})
  await wait(400)
  // 发布前先走发文助手检测；需要时点「重新检测」，有风险则不硬点发布
  const assist = await ensurePublishAssist(win, notify, workId)
  // 仅明确风险时停；超时/未见异常也继续点发布，避免卡在快速检测面板
  if (assist.state === 'risk') {
    bringToFront(win)
    return {
      ok: false,
      attached: true,
      published: false,
      loginStatus: opened.loginStatus || '已登录',
      title: shortTitle,
      tags: placed.length ? placed : topicTags,
      message: `${assist.note}。标题等已填好，请在打开的窗口里确认检测结果后再点发布。`
    }
  }
  if (assist.state === 'timeout') {
    notify?.({ workId, progress: 94, status: '发布中', confirmNote: '检测超时，尝试继续点发布' })
  }
  let published = 'miss'
  for (let attempt = 0; attempt < 18 && published !== 'published'; attempt += 1) {
    await runInFrames(win, dismissAssistPanelScript()).catch(() => {})
    if (attempt < 2) {
      await runInFrames(win, `(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        return 'ok'
      })()`).catch(() => {})
    }
    const ready = await runInFrames(win, uploadReadyScript())
    if (ready === 'ready' || ready === 'wait' || ready === 'fail' || attempt >= 1) {
      const hit = await runInFrames(win, clickPublishScript())
      runtimeLog.info('publish.click', `第 ${attempt + 1} 次点发布 → ${hit || 'miss'}`)
      if (hit === 'published') {
        published = 'published'
        await wait(900)
        const again = await runInFrames(win, clickPublishScript())
        if (again === 'confirm') runtimeLog.info('publish.click', '已点确认发布')
        break
      }
      if (hit === 'confirm') {
        published = 'published'
        runtimeLog.info('publish.click', '已点确认发布')
        break
      }
    }
    await wait(700)
  }
  bringToFront(win)
  const tagText = (placed.length ? placed : topicTags).map((item) => `#${item}`).join(' ')
  const titleNote = titled === 'title' || titled === 'skip'
    ? (shortTitle ? `标题「${shortTitle}」` : '未写入标题')
    : `标题还没写进页面，准备的是「${shortTitle}」`
  const extras = [
    optionNotes.includes('cart') ? '已挂商品链接' : '',
    optionNotes.includes('cart-no-link') ? '挂车跳过：商品没有链接' : '',
    optionNotes.includes('cart-miss') ? '挂车未点全，请在窗口里补挂' : '',
    opts.dyDeclare ? (optionNotes.includes('declare') ? '已勾 AI 声明' : 'AI 声明可能未勾上') : '',
    opts.dyPrivate ? (optionNotes.includes('private') ? '已选私密' : '私密可能未选上') : '',
    optionNotes.includes('schedule') ? `已设定时${opts.dyDelay || 0}天` : '',
    optionNotes.includes('schedule-miss') ? '定时日历可能要在窗口里再点一次' : '',
    assist.note || ''
  ].filter(Boolean).join('，')
  if (published === 'published') {
    let deleted = false
    if (opts.deleteSources && videoPath && fs.existsSync(videoPath)) {
      try {
        fs.unlinkSync(videoPath)
        deleted = true
      } catch { deleted = false }
    }
    return {
      ok: true,
      attached: true,
      published: true,
      deleted,
      loginStatus: opened.loginStatus || '已登录',
      title: shortTitle,
      tags: placed.length ? placed : topicTags,
      message: `已打开抖音上传页，${titleNote}${tagText ? `，标签 ${tagText}` : ''}，并点了发布。${extras}${deleted ? '；原片已删除' : ''}`
    }
  }
  return {
    ok: true,
    attached: true,
    published: false,
    loginStatus: opened.loginStatus || '已登录',
    title: shortTitle,
    tags: placed.length ? placed : topicTags,
    message: titled === 'title' || titled === 'skip'
      ? `已打开抖音上传页，${titleNote}${tagText ? `，标签 ${tagText}` : ''}。上传可能还没完成或没点到「发布」。${extras}`
      : `已打开抖音上传页并放进成片。标题栏还没出来。准备的标题是「${shortTitle}」，标签是 ${tagText}`
  }
}

async function chatOnDoubao({ id, name, login, mode, message, slot }) {
  const text = String(message || '').trim()
  if (!text) return { ok: false, message: '先写要发给豆包的话' }
  const page = 'https://www.doubao.com/chat/'
  const windowSlot = slot || 'chat'
  await openAccount({ kind: 'doubao', id, name, login, mode: mode || 'password', url: page, slot: windowSlot })
  const win = windows.get(sessionKey('doubao', id, page, windowSlot))
  if (!win || win.isDestroyed()) return { ok: false, message: '对话窗口没有打开' }
  win.setTitle(`${name || '豆包'} · 对话`)
  bringToFront(win)
  if (!String(win.webContents.getURL() || '').startsWith('https://www.doubao.com')) await loadPage(win, page)
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const ready = await runInFrames(win, `(() => document.querySelector('textarea,[contenteditable="true"]') ? 'filled' : 'miss')()`)
    if (ready === 'filled') break
    await wait(700)
  }
  const before = await pageTail(win)
  const snippet = text.slice(0, 12)
  let filled = 'miss'
  for (let attempt = 0; attempt < 6 && filled !== 'filled'; attempt += 1) {
    await fillPrompt(win, text)
    await wait(300)
    filled = await runInFrames(win, promptLandedScript(snippet))
  }
  if (filled !== 'filled') return { ok: false, slot: windowSlot, message: '豆包输入框还没出来。先在这个窗口里登录。' }
  let sent = 'miss'
  for (let attempt = 0; attempt < 4 && sent !== 'clicked'; attempt += 1) {
    sent = await runInFrames(win, sendScript())
    if (sent !== 'clicked') await wait(500)
  }
  if (sent !== 'clicked') return { ok: false, slot: windowSlot, message: '没有点到发送。先在打开的豆包窗口里登录，再发一次。' }
  const reply = await waitForReply(win, before, text)
  return {
    ok: true,
    slot: windowSlot,
    reply,
    confirmNeeded: false,
    confirmSent: false,
    confirmNote: reply ? '豆包已回复' : '这句话已发进豆包，回复出现后会写在对话里',
    message: reply || '已发送'
  }
}

async function remixOnDoubao({ id, name, login, mode, videoPath, prompt, slot }) {
  const text = String(prompt || '').trim()
  if (!text) return { ok: false, message: '先选一条提示词模板' }
  const page = 'https://www.doubao.com/chat/'
  const windowSlot = slot || 'remix'
  await openAccount({ kind: 'doubao', id, name, login, mode: mode || 'password', url: page, slot: windowSlot })
  const win = windows.get(sessionKey('doubao', id, page, windowSlot))
  if (!win || win.isDestroyed()) return { ok: false, message: '二创窗口没有打开' }
  win.setTitle(`${name || '豆包'} · 视频二创`)
  bringToFront(win)
  if (videoPath && fs.existsSync(videoPath)) {
    const stat = fs.statSync(videoPath)
    if (stat.size > 30 * 1024 * 1024) {
      return { ok: false, message: '参考视频超过 30MB，请先裁短再做二创' }
    }
    const buffer = fs.readFileSync(videoPath)
    let attached = 'miss'
    for (let attempt = 0; attempt < 4 && attached !== 'file'; attempt += 1) {
      attached = await runInFrames(win, attachVideoScript(buffer, path.basename(videoPath)))
      if (attached !== 'file') await wait(700)
    }
    if (attached !== 'file') return { ok: false, message: '参考视频没有放进豆包' }
  }
  const snippet = text.slice(0, 12)
  let filled = 'miss'
  for (let attempt = 0; attempt < 6 && filled !== 'filled'; attempt += 1) {
    await fillPrompt(win, text)
    await wait(300)
    filled = await runInFrames(win, promptLandedScript(snippet))
  }
  if (filled !== 'filled') return { ok: false, message: '提示词没有写进输入框' }
  await runInFrames(win, sendScript())
  const delivery = await ensureDelivered(win, snippet, null, '', 0)
  return {
    ok: delivery.confirmSent || !delivery.confirmNeeded,
    slot: windowSlot,
    confirmNeeded: Boolean(delivery.confirmNeeded),
    confirmSent: Boolean(delivery.confirmSent),
    confirmNote: delivery.confirmNote || '',
    message: delivery.confirmNote || '已发给豆包'
  }
}

async function followLinks({ id, name, login, urls }) {
  const list = [...new Set((Array.isArray(urls) ? urls : String(urls || '').split(/\r?\n/)).map((item) => String(item || '').trim()).filter((item) => /^https?:\/\//.test(item)))].slice(0, 30)
  if (!list.length) return { ok: false, message: '先粘贴主页链接，一行一个' }
  const results = []
  for (const url of list) {
    await openAccount({ kind: 'publish', id, name, login, url, slot: 'follow' })
    const win = windows.get(sessionKey('publish', id, url, 'follow'))
    if (!win || win.isDestroyed()) {
      results.push({ url, ok: false })
      continue
    }
    if (!samePage(win.webContents.getURL(), url)) await loadPage(win, url)
    await wait(1500)
    const clicked = await runInFrames(win, clickTextScript(['关注', '+ 关注']))
    results.push({ url, ok: clicked === 'clicked' })
    await wait(900)
  }
  const done = results.filter((item) => item.ok).length
  return { ok: true, results, message: `已处理 ${results.length} 个主页，点到关注 ${done} 个` }
}

function listWindows() {
  const rows = []
  for (const [key, win] of windows) {
    if (!win || win.isDestroyed()) continue
    rows.push({
      key,
      title: win.getTitle(),
      url: String(win.webContents.getURL() || ''),
      kind: String(key).split(':')[0] || ''
    })
  }
  return rows
}

function scrapeCartDomScript() {
  return `(() => {
    const rows = []
    const seen = new Set()
    const nodes = Array.from(document.querySelectorAll('div, li, tr, article, section'))
    for (const el of nodes) {
      const text = String(el.innerText || '').replace(/\\r/g, '').trim()
      if (text.length < 18 || text.length > 1200) continue
      const idMatch = text.match(/ID\\s*[：:]?\\s*(\\d{10,})/i) || text.match(/(?:商品编号|商品ID|product[_\\s-]?id)\\s*[：:]?\\s*(\\d{10,})/i)
      if (!idMatch) continue
      const id = idMatch[1]
      if (seen.has(id)) continue
      const lines = text.split(/\\n+/).map((line) => line.trim()).filter(Boolean)
      const title = lines.find((line) => (
        line.length >= 6
        && line.length <= 80
        && !/^ID/i.test(line)
        && !/佣金|售价|月销|店铺|体验分|选品车|全部商品|未添加|包邮|运费险|现货|爆款|流量|投流|智能家居|服饰|鞋靴/.test(line)
        && !/^\\d+(\\.\\d+)?%$/.test(line)
        && !/^¥/.test(line)
        && !/^\\d{10,}$/.test(line)
      )) || ''
      if (!title) continue
      const img = el.querySelector('img')
      const src = img ? String(img.currentSrc || img.src || '') : ''
      seen.add(id)
      rows.push({
        id,
        title,
        image: src.startsWith('//') ? ('https:' + src) : src,
        images: src ? [src.startsWith('//') ? ('https:' + src) : src] : [],
        price: 0,
        rate: 0,
        category: '选品车',
        shop: '抖音',
        source: '选品车页面',
        link: 'https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=' + id
      })
      if (rows.length >= 120) break
    }
    return rows
  })()`
}

async function scrapeBuyinCart({ id, name, login, mode }) {
  const page = 'https://buyin.jinritemai.com/dashboard/merch-picking-cart'
  await openAccount({ kind: 'publish', id, name, login, mode: mode || 'password', url: page })
  const win = windows.get(sessionKey('publish', id, page))
  if (!win || win.isDestroyed()) return []
  await wait(1800)
  let rows = []
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (win.isDestroyed()) break
    rows = await win.webContents.executeJavaScript(scrapeCartDomScript(), true).catch(() => [])
    if (Array.isArray(rows) && rows.length) break
    await wait(900)
  }
  return Array.isArray(rows) ? rows.filter((item) => item?.id && item?.title) : []
}

function scrapeDetailDomScript(productId) {
  const id = String(productId || '')
  return `(() => {
    const id = ${JSON.stringify(id)}
    const bad = /登录|验证码|抖音商城|精选联盟|选品广场|达人工作台|风险/
    const pickTitle = (text) => {
      const value = String(text || '').replace(/\\s+/g, ' ').trim()
      if (!value || value.length < 4 || value.length > 80) return ''
      if (!/[\\u4e00-\\u9fff]/.test(value)) return ''
      if (bad.test(value)) return ''
      if (id && (value === id || value === '商品 ' + id)) return ''
      return value
    }
    const body = String(document.body?.innerText || '')
    const og = pickTitle(document.querySelector('meta[property="og:title"]')?.content)
    const h1 = pickTitle(document.querySelector('h1')?.innerText)
    const candidates = []
    document.querySelectorAll('h1, h2, [class*="title"], [class*="Title"], [class*="name"], [class*="Name"]').forEach((el) => {
      const t = pickTitle(el.innerText || el.textContent)
      if (t) candidates.push(t)
    })
    const bodyLines = body.split(/\\n+/).map((item) => pickTitle(item)).filter(Boolean)
    const title = og || h1 || candidates.sort((a, b) => b.length - a.length)[0] || bodyLines.sort((a, b) => b.length - a.length)[0] || ''
    const imgs = []
    const pushImg = (src) => {
      const url = String(src || '').trim()
      if (!/^https?:/.test(url)) return
      if (/avatar|logo|icon|qrcode|sprite|blank|placeholder/i.test(url)) return
      if (!imgs.includes(url)) imgs.push(url)
    }
    document.querySelectorAll('img').forEach((img) => {
      if (img.naturalWidth && img.naturalWidth < 80) return
      pushImg(img.currentSrc || img.src)
      const srcset = String(img.getAttribute('srcset') || '')
      srcset.split(',').forEach((part) => pushImg(part.trim().split(/\\s+/)[0]))
    })
    document.querySelectorAll('[style*="background"]').forEach((el) => {
      const m = String(el.getAttribute('style') || '').match(/url\\(["']?(https?:[^"')]+)["']?\\)/i)
      if (m) pushImg(m[1])
    })
    const priceText = body.match(/¥\\s*([0-9]+(?:\\.[0-9]+)?)/)?.[1]
      || body.match(/售价[^0-9]{0,6}([0-9]+(?:\\.[0-9]+)?)/)?.[1]
      || ''
    const rateText = body.match(/佣金[^0-9]{0,6}([0-9]+(?:\\.[0-9]+)?)\\s*%/)?.[1]
      || body.match(/([0-9]+(?:\\.[0-9]+)?)\\s*%\\s*佣金/)?.[1]
      || ''
    const salesText = body.match(/(?:月销|销量|已售)[^0-9]{0,6}([0-9]+(?:\\.[0-9]+)?)\\s*万/)?.[1]
      || body.match(/(?:月销|销量|已售)[^0-9]{0,6}([0-9]+)/)?.[1]
      || ''
    const salesWan = body.match(/(?:月销|销量|已售)[^0-9]{0,6}([0-9]+(?:\\.[0-9]+)?)\\s*万/)
    const category = (body.match(/类目[:：]?\\s*([\\u4e00-\\u9fffA-Za-z0-9\\/·-]{2,20})/) || [])[1]
      || (body.match(/分类[:：]?\\s*([\\u4e00-\\u9fffA-Za-z0-9\\/·-]{2,20})/) || [])[1]
      || ''
    const shop = (body.match(/([\\u4e00-\\u9fffA-Za-z0-9]{2,20}店)/) || [])[1] || '抖音'
    return {
      id,
      title,
      image: imgs[0] || '',
      images: imgs.slice(0, 6),
      price: Number(priceText) || 0,
      rate: Number(rateText) || 0,
      monthlySales: salesWan ? Math.round(Number(salesWan[1]) * 10000) : (Number(salesText) || 0),
      category: category || '链接导入',
      shop,
      source: '商品详情页'
    }
  })()`
}

function normalizeMoney(value) {
  if (typeof value === 'string') {
    const text = value.replace(/[^\d.]/g, '')
    const number = Number(text)
    if (!Number.isFinite(number) || number <= 0) return 0
    // 常见「8990」分、「89.9」元
    return number >= 1000 ? Math.round(number) / 100 : number
  }
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 0
  return number >= 1000 ? Math.round(number) / 100 : number
}

function normalizeRate(value) {
  if (typeof value === 'string') {
    const text = value.replace(/[^\d.]/g, '')
    const number = Number(text)
    if (!Number.isFinite(number) || number <= 0) return 0
    // 2500 → 25%；25 → 25；0.25 → 0.25 再抬到百分比
    if (number >= 1000) return Math.round((number / 100) * 100) / 100
    if (number > 0 && number < 1) return Math.round(number * 10000) / 100
    return number
  }
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 0
  if (number >= 1000) return Math.round((number / 100) * 100) / 100
  if (number > 0 && number < 1) return Math.round(number * 10000) / 100
  return number > 100 ? number / 100 : number
}

function collectImageUrls(node, list = [], seen = new Set(), depth = 0) {
  if (!node || depth > 8 || list.length >= 40) return list
  if (typeof node === 'string') {
    let url = node.startsWith('//') ? `https:${node}` : node
    url = url.replace(/\\\//g, '/')
    if (!/^https?:\/\//.test(url)) return list
    if (!/ecombdimg|byteimg|pstatp|bytecdn|alicdn|\/obj\/|\.(jpg|jpeg|png|webp)(\?|$)/i.test(url)) return list
    if (/avatar|logo|icon|qrcode|sprite/i.test(url)) return list
    const key = url.split('?')[0]
    if (seen.has(key)) return list
    seen.add(key)
    list.push(url.slice(0, 800))
    return list
  }
  if (Array.isArray(node)) {
    node.forEach((item) => collectImageUrls(item, list, seen, depth + 1))
    return list
  }
  if (typeof node === 'object') {
    const preferred = ['imgs', 'images', 'pic_list', 'picList', 'image_list', 'url_list', 'cover_list', 'white_image', 'cover', 'img', 'image', 'main_img', 'elastic_img']
    preferred.forEach((key) => {
      if (node[key] != null) collectImageUrls(node[key], list, seen, depth + 1)
    })
    Object.values(node).forEach((value) => collectImageUrls(value, list, seen, depth + 1))
  }
  return list
}

function coerceDeepNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : 0
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return coerceDeepNumber(raw.amount ?? raw.value ?? raw.num ?? raw.price ?? raw.ratio ?? raw.cos_ratio ?? raw.min ?? raw.max ?? 0)
  }
  if (typeof raw !== 'string') return 0
  const text = raw.replace(/[^\d.]/g, '')
  const value = Number(text)
  return Number.isFinite(value) && value > 0 ? value : 0
}

function pickDeepNumber(node, names, depth = 0) {
  if (!node || depth > 7 || typeof node !== 'object') return 0
  if (!Array.isArray(node)) {
    for (const name of names) {
      const direct = coerceDeepNumber(node[name])
      if (direct > 0) return direct
      const nested = node[name]
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        const deep = coerceDeepNumber(nested.amount ?? nested.value ?? nested.num ?? nested.price ?? nested.ratio ?? nested.cos_ratio)
        if (deep > 0) return deep
      }
    }
  }
  const list = Array.isArray(node) ? node : Object.values(node)
  for (const value of list) {
    if (value && typeof value === 'object') {
      const found = pickDeepNumber(value, names, depth + 1)
      if (found) return found
    }
  }
  return 0
}

function pickDeepText(node, names, depth = 0) {
  if (!node || depth > 6 || typeof node !== 'object') return ''
  if (!Array.isArray(node)) {
    for (const name of names) {
      const value = node[name]
      if (typeof value === 'string' && /[\u4e00-\u9fff]/.test(value) && value.length >= 2 && value.length <= 40) return value.trim()
    }
  }
  const list = Array.isArray(node) ? node : Object.values(node)
  for (const value of list) {
    if (value && typeof value === 'object') {
      const found = pickDeepText(value, names, depth + 1)
      if (found) return found
    }
  }
  return ''
}

function mergeLookedProduct(base, extra) {
  if (!base) return extra || null
  if (!extra) return base
  const images = [...new Set([...(base.images || []), base.image, ...(extra.images || []), extra.image]
    .map((item) => String(item || '').trim())
    .filter((item) => /^https?:\/\//.test(item)))].slice(0, 6)
  const category = [extra.category, base.category].find((item) => item && !['链接导入', '未分类', '选品广场'].includes(item))
    || extra.category || base.category || '链接导入'
  return {
    ...base,
    ...extra,
    id: String(extra.id || base.id || ''),
    title: (extra.title && !/^商品\s*\d+/.test(extra.title) ? extra.title : base.title) || extra.title || base.title,
    price: Number(extra.price) > 0 ? Number(extra.price) : Number(base.price) || 0,
    rate: Number(extra.rate) > 0 ? Number(extra.rate) : Number(base.rate) || 0,
    monthlySales: Number(extra.monthlySales) > 0 ? Number(extra.monthlySales) : Number(base.monthlySales) || 0,
    category,
    shop: (extra.shop && extra.shop !== '待补充' ? extra.shop : '') || base.shop || '抖音',
    source: extra.source || base.source || '登录态接口',
    link: extra.link || base.link || '',
    images,
    image: images[0] || ''
  }
}

function productFromJsonBlob(json, pid) {
  if (!json) return null
  const pile = []
  const walk = (node, depth = 0) => {
    if (!node || depth > 8) return
    if (Array.isArray(node)) {
      node.slice(0, 60).forEach((item) => walk(item, depth + 1))
      return
    }
    if (typeof node !== 'object') return
    if (node.product_card) walk(node.product_card, depth + 1)
    if (node.base_product_info || node.business_operation_info) {
      const base = node.base_product_info || node
      const biz = node.business_operation_info || {}
      const shop = node.base_shop_info || {}
      const id = String(node.product_id || base.product_id || node.product_id_str || base.product_id_str || '')
      const title = String(base.title || base.product_name || base.elastic_title || node.title || '').trim()
      if (title && /[\u4e00-\u9fff]/.test(title) && title.length >= 4 && title.length <= 80 && !/登录|验证码|选品广场|达人工作台/.test(title)) {
        pile.push({
          id: /^\d{6,}$/.test(id) ? id : pid,
          title,
          node,
          price: normalizeMoney(
            pickDeepNumber(base, [
              'discount_price', 'min_price', 'price', 'market_price', 'coupon_price', 'actual_price',
              'sku_min_price', 'good_price', 'model_price', 'activity_price', 'promotion_price', 'sale_price', 'amount'
            ])
            || pickDeepNumber(node, ['discount_price', 'min_price', 'price', 'market_price', 'good_price', 'amount'])
            || base.price || base.discount_price || base.min_price || node.price || 0
          ),
          rate: normalizeRate(
            pickDeepNumber(biz, [
              'cos_ratio', 'cos_ratio_str', 'commission_rate', 'estimated_cos_ratio', 'cos_fee_rate', 'commission_rate_str'
            ])
            || pickDeepNumber(node, ['cos_ratio', 'cos_ratio_str', 'commission_rate'])
            || biz.cos_ratio || biz.cos_ratio_str || node.cos_ratio || biz.commission_rate || 0
          ),
          monthlySales: pickDeepNumber(biz, [
            'monthly_sale', 'sell_num', 'sell_num_30d', 'order_num', 'month_sell_num', 'sales', 'sale_num'
          ]) || pickDeepNumber(node, ['monthly_sale', 'sell_num', 'sell_num_30d', 'sales']) || 0,
          category: pickDeepText(node, ['category_name', 'first_cname', 'cate_name', 'first_category_name', 'industry_name', 'leaf_cname']) || '链接导入',
          shop: shop.shop_name || pickDeepText(node, ['shop_name', 'shopName']) || '抖音',
          images: collectImageUrls(node).slice(0, 6)
        })
      }
    }
    const id = String(node.product_id_str || node.product_id || node.promotion_id || node.id || '')
    const title = String(node.title || node.product_name || node.elastic_title || node.name || node.goods_name || '').trim()
    if (title && /[\u4e00-\u9fff]/.test(title) && title.length >= 4 && title.length <= 80 && !/登录|验证码|选品广场|达人工作台/.test(title)) {
      const priceInfo = node.price_info || node.priceInfo || {}
      const cosInfo = node.cos_info || node.commission_info || node.business_operation_info || {}
      pile.push({
        id: /^\d{6,}$/.test(id) ? id : pid,
        title,
        node,
        price: normalizeMoney(
          pickDeepNumber(node, [
            'discount_price', 'min_price', 'price', 'market_price', 'coupon_price', 'actual_price',
            'sku_min_price', 'good_price', 'origin_amount', 'model_price', 'activity_price',
            'promotion_price', 'final_price', 'sale_price', 'price_value', 'min_sku_price', 'amount'
          ])
          || priceInfo.price || priceInfo.min_price || priceInfo.discount_price || priceInfo.amount || 0
        ),
        rate: normalizeRate(
          pickDeepNumber(node, [
            'cos_ratio', 'cos_ratio_str', 'commission_rate', 'commission', 'estimated_cos_ratio',
            'cos_fee_rate', 'cos_fee', 'estimated_commission', 'commission_rate_str', 'cosRatio'
          ])
          || cosInfo.cos_ratio || cosInfo.cos_ratio_str || cosInfo.commission_rate || node.cos_ratio_str || 0
        ),
        monthlySales: pickDeepNumber(node, [
          'sell_num', 'sales', 'monthly_sale', 'sell_num_30d', 'order_num', 'month_sale_num',
          'sale_count', 'volume', 'sold_count', 'sales_volume', 'month_sell_num', 'sale_num'
        ]),
        category: pickDeepText(node, ['category_name', 'first_cname', 'second_cname', 'leaf_cname', 'cate_name', 'first_category_name', 'industry_name', 'cid_name']) || '',
        shop: pickDeepText(node, ['shop_name', 'shopName']) || '',
        images: collectImageUrls(node).slice(0, 6)
      })
    }
    Object.values(node).forEach((value) => walk(value, depth + 1))
  }
  walk(json)
  // 优先取同 ID 且价/佣更全的那条
  const scored = pile
    .map((item) => ({
      ...item,
      _score: (item.id === pid ? 5 : 0)
        + (Number(item.price) > 0 ? 2 : 0)
        + (Number(item.rate) > 0 ? 2 : 0)
        + (Number(item.monthlySales) > 0 ? 1 : 0)
        + (item.category ? 1 : 0)
        + Math.min(3, (item.images || []).length)
    }))
    .sort((a, b) => b._score - a._score)
  const hit = scored.find((item) => item.id === pid) || scored[0]
  if (!hit) return null
  const allImages = [...new Set([...(hit.images || []), ...collectImageUrls(json)])].slice(0, 6)
  return {
    id: pid,
    title: hit.title,
    image: allImages[0] || '',
    images: allImages,
    price: normalizeMoney(hit.price),
    rate: normalizeRate(hit.rate),
    monthlySales: Number(hit.monthlySales) > 1000000 ? 0 : (Number(hit.monthlySales) || 0),
    category: hit.category || '链接导入',
    shop: hit.shop || '抖音',
    source: '登录态接口',
    link: `https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=${pid}`
  }
}

function productDetailScore(product) {
  if (!product?.title) return 0
  let score = 1
  if (Number(product.price) > 0) score += 2
  if (Number(product.rate) > 0) score += 2
  if (Number(product.monthlySales) > 0) score += 1
  if (product.category && !['链接导入', '未分类', '选品广场'].includes(product.category)) score += 1
  score += Math.min(8, (product.images || []).length)
  return score
}

/** 从百应选品车/广场表格 DOM 抠价佣销量（页面上有 ¥59.90 / 20% / 9808） */
function scrapeBuyinTableScript(pid) {
  return `(() => {
    const pid = ${JSON.stringify(String(pid))}
    const compact = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
    const rows = Array.from(document.querySelectorAll('tr[data-row-key], tr'))
    let hit = rows.find((row) => String(row.getAttribute('data-row-key') || '') === pid)
    if (!hit) hit = rows.find((row) => compact(row.innerText || '').includes(pid))
    if (!hit) {
      const blocks = Array.from(document.querySelectorAll('[class*="infoCell"], [class*="product"], [class*="card"], li, div'))
        .filter((el) => {
          const text = compact(el.innerText || '')
          return text.includes(pid) && /¥|￥/.test(text) && /%/.test(text) && text.length < 1200
        })
        .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)
      hit = blocks[0]
    }
    if (!hit) return null
    const text = compact(hit.innerText || hit.textContent || '')
    const cells = Array.from(hit.querySelectorAll('td')).map((td) => compact(td.innerText || ''))
    const titleEl = hit.querySelector('[class*="titleText"], [class*="titleWrap"] [class*="ellipsis"], [class*="title"]')
    let title = compact(titleEl?.innerText || '')
    if (!title || title.length < 4) {
      const lines = text.split(/\\n/).map((item) => item.trim()).filter(Boolean)
      title = lines.find((line) => /[\\u4e00-\\u9fff]/.test(line) && line.length >= 6 && line.length <= 80 && !/ID|商品类目|体验分|预计赚|去带货|添加分组/.test(line) && !/^[¥￥0-9.%\\s]+$/.test(line)) || ''
    }
    // 列顺序常见：勾选 | 商品 | 店铺 | 佣金 | 价格 | 销量 | …
    let price = 0
    let rate = 0
    let sales = 0
    let earn = 0
    for (const cell of cells) {
      if (!price && /[¥￥]\\s*[0-9]/.test(cell) && !/预计赚/.test(cell)) {
        const m = cell.match(/[¥￥]\\s*([0-9]+(?:\\.[0-9]+)?)/)
        if (m) price = Number(m[1]) || 0
      }
      if (!rate && /%/.test(cell) && (/预计赚/.test(cell) || /^[0-9.]+%$/.test(cell.replace(/\\s/g, '')) || /[0-9]+\\s*%/.test(cell))) {
        const m = cell.match(/([0-9]+(?:\\.[0-9]+)?)\\s*%/)
        if (m) rate = Number(m[1]) || 0
        const e = cell.match(/预计赚\\s*[¥￥]?\\s*([0-9]+(?:\\.[0-9]+)?)/)
        if (e) earn = Number(e[1]) || 0
      }
      if (!sales && /^[0-9]{2,8}$/.test(cell.replace(/,/g, ''))) {
        const n = Number(cell.replace(/,/g, ''))
        // 跳过体验分常见 0-100；销量通常更大，或至少不是佣金整数
        if (n >= 0 && n !== Math.round(rate) && !(n >= 80 && n <= 100 && cells.some((c) => /体验分/.test(c)))) {
          // 优先更大的销量候选
          if (n > sales) sales = n
        }
      }
    }
    if (!price) {
      const m = text.match(/[¥￥]\\s*([0-9]+(?:\\.[0-9]+)?)/)
      if (m) price = Number(m[1]) || 0
    }
    if (!rate) {
      const m = text.match(/([0-9]+(?:\\.[0-9]+)?)\\s*%/)
      if (m) rate = Number(m[1]) || 0
    }
    if (!sales) {
      // 去掉价格/佣金后再找较大整数
      const cleaned = text.replace(/[¥￥]\\s*[0-9.]+/g, ' ').replace(/[0-9.]+\\s*%/g, ' ').replace(/体验分[:：]?\\s*[0-9.]+/g, ' ')
      const nums = [...cleaned.matchAll(/\\b([1-9][0-9]{1,7})\\b/g)].map((m) => Number(m[1])).filter((n) => n >= 20)
      sales = nums.sort((a, b) => b - a)[0] || 0
    }
    const categoryMatch = text.match(/商品类目[:：]\\s*([^\\n]+)/)
    const shopMatch = text.match(/([^\\n]{2,24})\\s*体验分/)
    const img = hit.querySelector('img')
    const image = img ? (img.currentSrc || img.src || '') : ''
    return {
      id: pid,
      title: title || '',
      price,
      rate,
      monthlySales: sales,
      category: categoryMatch ? categoryMatch[1].trim() : '',
      shop: shopMatch ? shopMatch[1].trim() : '',
      image,
      images: image ? [image] : [],
      earn,
      source: '百应表格'
    }
  })()`
}

function scrapeCommerceTextScript() {
  return `(() => {
    const text = String(document.body?.innerText || '')
    if (!text || text.length < 20) return null
    if (/扫码登录|密码登录/.test(text) && !/佣金|到手价|售价/.test(text)) return null
    const priceMatch = text.match(/(?:到手价|券后价|售价|价格)[^\\d¥￥]{0,12}[¥￥]\\s*([0-9]+(?:\\.[0-9]{1,2})?)/)
      || text.match(/[¥￥]\\s*([0-9]+(?:\\.[0-9]{1,2})?)/)
    const rateMatch = text.match(/(?:佣金率|佣金比例|佣金)[^\\d%]{0,8}([0-9]+(?:\\.[0-9]+)?)\\s*%/)
      || text.match(/([0-9]+(?:\\.[0-9]+)?)\\s*%/)
    const salesMatch = text.match(/(?:月销|近30天|30天销量|销量|已售)[^\\d]{0,8}([0-9]+(?:\\.[0-9]+)?)\\s*(万)?/)
    let sales = 0
    if (salesMatch) {
      sales = Number(salesMatch[1]) || 0
      if (salesMatch[2]) sales = Math.round(sales * 10000)
    }
    const titleLine = text.split(/\\n/).map((line) => line.trim()).find((line) => /[\\u4e00-\\u9fff]/.test(line) && line.length >= 6 && line.length <= 80 && !/登录|佣金|销量|类目|体验分|选品/.test(line))
    const price = priceMatch ? Number(priceMatch[1]) || 0 : 0
    const rate = rateMatch ? Number(rateMatch[1]) || 0 : 0
    if (!(price > 0) && !(rate > 0) && !(sales > 0)) return null
    return { title: titleLine || '', price, rate, monthlySales: sales, source: '百应详情页' }
  })()`
}

async function scrapeBuyinDomProduct(win, pid) {
  if (!win || win.isDestroyed()) return null
  const pages = [
    `https://buyin.jinritemai.com/dashboard/merch-picking-library/merch-promoting?id=${encodeURIComponent(pid)}`,
    `https://buyin.jinritemai.com/dashboard/merch-picking-library/merch-promoting?product_id=${encodeURIComponent(pid)}`,
    `https://buyin.jinritemai.com/dashboard/merch-picking-cart`,
    `https://buyin.jinritemai.com/dashboard/merch-picking-library`
  ]
  let best = null
  for (const page of pages) {
    if (win.isDestroyed()) break
    await loadPage(win, page, { quiet: true })
    await wait(1600)
    const onDetail = /merch-promoting/.test(page)
    if (!onDetail) {
      await win.webContents.executeJavaScript(`(() => {
        const pid = ${JSON.stringify(String(pid))}
        const inputs = Array.from(document.querySelectorAll('input'))
        const box = inputs.find((el) => /搜索|商品|ID|编号/.test((el.placeholder || '') + (el.name || ''))) || inputs.find((el) => el.type === 'search' || el.type === 'text')
        if (!box) return 'no'
        const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
        proto.set.call(box, pid)
        box.dispatchEvent(new Event('input', { bubbles: true }))
        box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
        const btn = Array.from(document.querySelectorAll('button, span, div')).find((el) => {
          const text = String(el.innerText || '').replace(/\\s+/g, '')
          return text === '搜索' || text === '查询'
        })
        if (btn) (btn.closest('button') || btn).click()
        return 'ok'
      })()`, true).catch(() => 'no')
      await wait(1800)
    } else {
      await wait(900)
    }
    hardenSilentWindow(win)
    let found = null
    if (onDetail) {
      found = await evalInFrames(win, scrapeCommerceTextScript()).catch(() => null)
    }
    if (!found || (!(Number(found.price) > 0) && !(Number(found.rate) > 0))) {
      const table = await evalInFrames(win, scrapeBuyinTableScript(pid)).catch(() => null)
      if (table && (table.title || Number(table.price) > 0 || Number(table.rate) > 0 || Number(table.monthlySales) > 0)) {
        found = {
          ...(found || {}),
          ...table,
          title: table.title || found?.title || '',
          price: Number(table.price) > 0 ? Number(table.price) : Number(found?.price) || 0,
          rate: Number(table.rate) > 0 ? Number(table.rate) : Number(found?.rate) || 0,
          monthlySales: Number(table.monthlySales) > 0 ? Number(table.monthlySales) : Number(found?.monthlySales) || 0
        }
      }
    }
    if (!found || (!(Number(found.price) > 0) && !(Number(found.rate) > 0) && !(Number(found.monthlySales) > 0))) {
      const loose = await evalInFrames(win, scrapeCommerceTextScript()).catch(() => null)
      if (loose) {
        found = {
          ...(found || {}),
          title: found?.title || loose.title || '',
          price: Number(found?.price) > 0 ? Number(found.price) : Number(loose.price) || 0,
          rate: Number(found?.rate) > 0 ? Number(found.rate) : Number(loose.rate) || 0,
          monthlySales: Number(found?.monthlySales) > 0 ? Number(found.monthlySales) : Number(loose.monthlySales) || 0,
          source: loose.source || found?.source
        }
      }
    }
    if (found?.title || Number(found?.price) > 0 || Number(found?.rate) > 0 || Number(found?.monthlySales) > 0) {
      best = mergeLookedProduct(best, {
        id: pid,
        title: found.title || '',
        price: Number(found.price) || 0,
        rate: Number(found.rate) || 0,
        monthlySales: Number(found.monthlySales) || 0,
        category: found.category || '选品车',
        shop: found.shop || '抖音',
        image: found.image || '',
        images: found.images || [],
        source: found.source || '百应页面',
        link: `https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=${pid}`
      })
      runtimeLog.info('product.dom', `页面命中 ${pid}`, {
        price: best.price, rate: best.rate, sales: best.monthlySales, title: String(best.title || '').slice(0, 20)
      })
      if (Number(best.price) > 0 && Number(best.rate) > 0 && Number(best.monthlySales) > 0) return best
    }
  }
  if (best) return best
  runtimeLog.warn('product.dom', `表格未找到 ${pid}`)
  return null
}

function hardenSilentWindow(win) {
  if (!win || win.isDestroyed()) return
  try {
    win.setMenuBarVisibility(false)
    win.setSkipTaskbar(true)
    if (win.isVisible()) win.hide()
  } catch { /* ignore */ }
  try {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('did-create-window', (child) => {
      try { if (child && !child.isDestroyed()) child.destroy() } catch { /* ignore */ }
    })
  } catch { /* ignore */ }
  // 防止任何 ready-to-show / 导航把隐藏窗亮出来
  win.on('show', () => {
    try { if (!win.isDestroyed()) win.hide() } catch { /* ignore */ }
  })
}

async function openHiddenLookupWindow(accountId, name, login, mode) {
  const page = 'https://buyin.jinritemai.com/dashboard/merch-picking-cart'
  const slot = 'silent-lookup'
  await openAccount({
    kind: 'publish',
    id: accountId,
    name: name || '发布账号',
    login: login || '',
    mode: mode || 'password',
    url: page,
    slot,
    hidden: true
  })
  const win = windows.get(sessionKey('publish', accountId, page, slot))
  hardenSilentWindow(win)
  return win
}

async function scrapeProductById({ id, name, login, mode, productId }) {
  const pid = String(productId || '').trim()
  if (!pid || !id) return null
  // 先确保采集账号登录态还在，静默窗才能读到价/佣
  try {
    await ensurePublishLogin({ id, name, login, mode: mode || 'password', url: 'https://buyin.jinritemai.com/dashboard/merch-picking-cart' })
  } catch { /* 继续尝试抓取 */ }
  let best = null
  // 只走百应选品车/广场接口，绝不打开 haohuo 消费者 H5（没价没佣还爱弹窗）
  const apiTries = [
    `https://buyin.jinritemai.com/pc/selection/decision/pack_detail?product_id=${pid}`,
    `https://buyin.jinritemai.com/pc/selection/decision/pack_detail?promotion_id=${pid}`,
    `https://buyin.jinritemai.com/pc/selection/decision/product_detail?product_id=${pid}`,
    `https://buyin.jinritemai.com/pc/selection/decision/product_detail?promotion_id=${pid}`,
    `https://buyin.jinritemai.com/pc/selection/decision/pack_detail?product_id=${pid}&enter_from=selection_cart`,
    `https://buyin.jinritemai.com/pc/selection/decision/pack_detail?product_id=${pid}&origin_type=604`,
    `https://buyin.jinritemai.com/pc/selection/decision/pack_detail?id=${pid}`,
    `https://buyin.jinritemai.com/square_pc_api/selection/decision/pack_detail?product_id=${pid}`,
    `https://buyin.jinritemai.com/pc/selection/common/material_detail?product_id=${pid}`,
    `https://buyin.jinritemai.com/pc/selection/common/product_detail?product_id=${pid}`
  ]
  const cartBodies = [
    { page: 1, page_no: 1, page_size: 50, size: 50, search_text: pid, product_id: pid },
    { page: 1, page_no: 1, page_size: 50, size: 50, keyword: pid },
    { page: 1, page_no: 1, page_size: 50, size: 50 }
  ]
  const cartUrls = [
    'https://buyin.jinritemai.com/pc/selection_cart/list',
    'https://buyin.jinritemai.com/pc/selection_cart/get_list',
    'https://buyin.jinritemai.com/pc/selection/cart/list',
    'https://buyin.jinritemai.com/square_pc_api/selection_cart/list'
  ]
  let win = null
  try {
    win = await openHiddenLookupWindow(id, name, login, mode)
    if (!win || win.isDestroyed()) return null
    hardenSilentWindow(win)
    await wait(900)
    // 1) 选品车里按编号找
    for (const url of cartUrls) {
      if (win.isDestroyed()) break
      for (const body of cartBodies) {
        const json = await win.webContents.executeJavaScript(
          `fetch(${JSON.stringify(url)},{method:'POST',credentials:'include',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(${JSON.stringify(body)})}).then((r)=>r.json()).catch(()=>null)`,
          true
        ).catch(() => null)
        const found = productFromJsonBlob(json, pid)
        if (found?.title) best = mergeLookedProduct(best, { ...found, source: '选品车' })
        if (productDetailScore(best) >= 12) break
      }
      if (productDetailScore(best) >= 12) break
    }
    // 2) 决策详情接口（GET + 少量 POST）
    for (const api of apiTries) {
      if (win.isDestroyed() || productDetailScore(best) >= 12) break
      const json = await win.webContents.executeJavaScript(
        `fetch(${JSON.stringify(api)},{credentials:'include',headers:{accept:'application/json'}}).then((r)=>r.json()).catch(()=>null)`,
        true
      ).catch(() => null)
      const found = productFromJsonBlob(json, pid)
      if (found?.title) best = mergeLookedProduct(best, { ...found, source: '百应详情' })
    }
    if (productDetailScore(best) < 10 && !win.isDestroyed()) {
      const postTries = [
        { url: 'https://buyin.jinritemai.com/pc/selection/decision/pack_detail', body: { product_id: pid } },
        { url: 'https://buyin.jinritemai.com/pc/selection/decision/pack_detail', body: { promotion_id: pid, product_id: pid } },
        { url: 'https://buyin.jinritemai.com/pc/selection/decision/product_detail', body: { product_id: pid } }
      ]
      for (const item of postTries) {
        if (win.isDestroyed() || productDetailScore(best) >= 12) break
        const json = await win.webContents.executeJavaScript(
          `fetch(${JSON.stringify(item.url)},{method:'POST',credentials:'include',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(${JSON.stringify(item.body)})}).then((r)=>r.json()).catch(()=>null)`,
          true
        ).catch(() => null)
        const found = productFromJsonBlob(json, pid)
        if (found?.title) best = mergeLookedProduct(best, { ...found, source: '百应详情POST' })
      }
    }
    // 3) 选品广场搜索编号
    if (productDetailScore(best) < 10 && !win.isDestroyed()) {
      const plazaBodies = [
        { cursor: 0, size: 20, scene: 'PCSquareSearch', search_text: pid, extra: {}, page: 1, page_size: 20 },
        { cursor: 0, size: 20, scene: 'PCSquareSearch', keyword: pid, search_text: pid, page: 1, page_size: 20 }
      ]
      for (const body of plazaBodies) {
        if (win.isDestroyed()) break
        const json = await win.webContents.executeJavaScript(
          `fetch('https://buyin.jinritemai.com/pc/selection/common/material_list',{method:'POST',credentials:'include',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(${JSON.stringify(body)})}).then((r)=>r.json()).catch(()=>null)`,
          true
        ).catch(() => null)
        const found = productFromJsonBlob(json, pid)
        if (found?.title) best = mergeLookedProduct(best, { ...found, source: '选品广场搜索' })
      }
    }
    // 4) 接口仍缺价/佣/销：直接读百应表格 DOM（页面上就是 ¥xx / xx% / 销量）
    if ((!best || !(Number(best.price) > 0) || !(Number(best.rate) > 0) || !(Number(best.monthlySales) > 0)) && !win.isDestroyed()) {
      runtimeLog.info('product.scrape', `接口字段不全，改读表格 DOM ${pid}`)
      const dom = await scrapeBuyinDomProduct(win, pid)
      if (dom) best = mergeLookedProduct(best, dom)
    }
  } catch (error) {
    runtimeLog.warn('product.scrape', `静默抓取异常 ${error?.message || error}`)
  }
  finally {
    try {
      if (win && !win.isDestroyed()) win.close()
    } catch { /* ignore */ }
  }
  if (best?.images?.length > 6) {
    best.images = best.images.slice(0, 6)
    best.image = best.images[0] || ''
  }
  return best
}

function findDoubaoChat(id) {
  const prefix = `doubao:${id}`
  for (const [key, win] of windows) {
    if (!key.startsWith(prefix) || !win || win.isDestroyed()) continue
    const url = String(win.webContents.getURL() || '')
    if (/doubao\.com\/chat\/[^/?#]+/i.test(url)) return url
  }
  return ''
}

function doubaoJobProbeScript() {
  return `(() => {
    const body = String(document.body?.innerText || '').replace(/\\s+/g, '')
    const tail = body.slice(-3500)
    const generating = /视频生成中|正在生成|生成中|排队中|排队生成|稍等片刻|仍在排队|处理中|转码中/.test(tail)
    const busy = /暂时无法并行|当前视频仍在排队|请先等待这条|结果出来后我会立即同步/.test(tail)
    const copyright = /输入图片可能涉及版权限制|可能涉及版权限制|请更换后重试|请更换输入内容后重试/.test(tail)
    const failed = /视频生成失败|无法生成你要求的内容|暂时无法创作|未通过审核|触发风控|免费次数用完/.test(tail)
    const videos = Array.from(document.querySelectorAll('video'))
    const video = videos.length ? videos[videos.length - 1] : null
    const src = video ? (video.currentSrc || video.src || '') : ''
    const hasVideo = Boolean(src && (src.startsWith('http') || (src.startsWith('blob:') && video.readyState >= 2)))
    const hasMp4 = Array.from(document.querySelectorAll('a')).some((el) => /\\.mp4(\\?|$)/i.test(el.href || ''))
    if (hasVideo || hasMp4) return { state: 'ready', generating: false, busy: false, failed: false, copyright: false }
    if (copyright) return { state: 'copyright', generating: false, busy: false, failed: false, copyright: true }
    if (failed && !generating && !busy) return { state: 'failed', generating: false, busy: false, failed: true, copyright: false }
    if (generating || busy) return { state: 'running', generating: true, busy: Boolean(busy), failed: false, copyright: false }
    return { state: 'idle', generating: false, busy: false, failed: false, copyright: false }
  })()`
}

async function probeDoubaoJob(win) {
  const result = await evalInFrames(win, doubaoJobProbeScript())
  if (result && typeof result === 'object') return result
  return { state: 'idle', generating: false, busy: false, failed: false, copyright: false }
}

/** 续发：先看原对话是否还在跑；在跑就等成片，不盲目重发浪费额度 */
async function pullCleanVideo({ id, name, login, mode, chatUrl, outputFile, outputDir, waitRunning = true, waitMs }) {
  const page = 'https://www.doubao.com/chat/'
  const target = unwatermark.normalizeChatUrl(chatUrl) || findDoubaoChat(id)
  if (!target) {
    return { ok: false, needRegenerate: true, message: '没有这条成片的豆包对话。先在豆包窗口里打开对应对话，再拉一次去水印。' }
  }
  const opened = await openAccount({
    kind: 'doubao',
    id,
    name,
    mode: mode || 'password',
    login,
    url: page,
    slot: 'unwatermark'
  })
  if (!opened?.ok) return { ok: false, message: opened?.message || '豆包窗口没有打开' }
  const win = windows.get(sessionKey('doubao', id, page, 'unwatermark'))
  if (!win || win.isDestroyed()) return { ok: false, message: '豆包窗口没有打开' }
  const folder = outputDir || (outputFile ? path.dirname(outputFile) : app.getPath('videos'))
  fs.mkdirSync(folder, { recursive: true })
  const ext = outputFile ? (path.extname(outputFile) || '.mp4') : '.mp4'
  const base = outputFile ? path.basename(outputFile, path.extname(outputFile) || ext) : `clean-${Date.now()}`
  const dest = path.join(folder, `${base.replace(/-去水印$/, '')}-去水印${ext}`)
  let chain = null
  try {
    chain = startChainCapture(win)
    await chain.ready
    const loaded = await loadPage(win, target)
    if (!loaded) return { ok: false, needRegenerate: false, message: '对话页面没有打开' }
    await wait(1500)
    let probe = await probeDoubaoJob(win)
    const maxWait = Math.max(45000, Number(waitMs) || (waitRunning ? 10 * 60 * 1000 : 45000))
    const deadline = Date.now() + maxWait
    let held = ''
    let lastState = probe.state
    while (Date.now() < deadline) {
      if (!held) held = await cleanUrlFromBodies(win.webContents.session, chain.bodies.splice(0))
      if (held) {
        const saved = await downloadCleanFile(held, dest, win.webContents.session)
        if (saved) {
          return { ok: true, clean: true, videoPath: saved, doubaoChatUrl: target, message: '已按豆包去水印地址换成成片' }
        }
        held = ''
      }
      probe = await probeDoubaoJob(win)
      lastState = probe.state
      if (probe.state === 'ready') {
        await wait(2000)
        continue
      }
      if (probe.state === 'running' || probe.state === 'copyright') {
        await wait(2500)
        continue
      }
      if (probe.state === 'failed') {
        return {
          ok: false,
          needRegenerate: true,
          jobState: 'failed',
          doubaoChatUrl: target,
          message: '原对话里豆包已拒绝/失败，可以重新生成'
        }
      }
      if (!waitRunning) break
      if (Date.now() > deadline - Math.min(30000, maxWait / 3)) break
      await wait(2000)
    }
    if (lastState === 'running' || lastState === 'copyright') {
      return {
        ok: false,
        stillRunning: true,
        needRegenerate: false,
        jobState: lastState,
        doubaoChatUrl: target,
        message: lastState === 'copyright'
          ? '原对话仍在版权提示附近，先不要重发；稍后可再点续传拉取'
          : '原对话还在排队/生成中，先不重发以免浪费额度；稍后会再拉成片'
      }
    }
    // 页面已有成片但没抓到无水印地址：不要重发浪费额度，稍后可再拉
    if (lastState === 'ready') {
      return {
        ok: false,
        stillRunning: false,
        needRegenerate: false,
        jobState: 'ready',
        doubaoChatUrl: target,
        message: '原对话里已有视频画面，但没拿到去水印地址；稍后会再拉，不重新发起'
      }
    }
    return {
      ok: false,
      needRegenerate: true,
      jobState: lastState || 'idle',
      doubaoChatUrl: target,
      message: '这个对话里没有拿到去水印地址，也没有检测到还在生成，可以重新发起。'
    }
  } finally {
    if (chain) await chain.stop()
  }
}

async function unwatermarkChat({ id, name, login, mode, chatUrl, outputDir }) {
  const url = unwatermark.normalizeChatUrl(chatUrl)
  if (!url) return { ok: false, message: '请填写豆包对话链接，例如 https://www.doubao.com/chat/xxxxx' }
  const folder = outputDir || app.getPath('videos')
  fs.mkdirSync(folder, { recursive: true })
  const opened = await openAccount({
    kind: 'doubao',
    id,
    name,
    mode: mode || 'password',
    login,
    url: 'https://www.doubao.com/chat/',
    slot: 'unwatermark'
  })
  if (!opened?.ok) return { ok: false, message: opened?.message || '豆包窗口没有打开' }
  const key = sessionKey('doubao', id, 'https://www.doubao.com/chat/', 'unwatermark')
  const win = windows.get(key)
  if (!win || win.isDestroyed()) return { ok: false, message: '豆包窗口没有打开' }
  const cookies = await win.webContents.session.cookies.get({})
  if (!loggedIn(cookies, 'doubao')) return { ok: false, needLogin: true, message: '这个豆包账号还没登录，先在打开的窗口里登录' }
  let chain = null
  try {
    chain = startChainCapture(win)
    await chain.ready
    const loaded = await loadPage(win, url)
    if (!loaded) return { ok: false, message: '对话页面没有打开' }
    const files = []
    const seen = new Set()
    const chatId = (url.split('/chat/')[1] || 'chat').split(/[/?#]/)[0].slice(0, 40)
    const deadline = Date.now() + 90000
    let lastHit = 0
    while (Date.now() < deadline && files.length < 30) {
      if (files.length && lastHit && Date.now() - lastHit > 12000) break
      const batch = chain.bodies.splice(0)
      for (const body of batch) {
        const dest = path.join(folder, `${chatId}-${Date.now()}-${files.length + 1}.mp4`)
        const saved = await saveCleanVideo(win, [body], dest)
        if (!saved || seen.has(saved)) continue
        seen.add(saved)
        files.push(dest)
        lastHit = Date.now()
      }
      if (!files.length && Date.now() > deadline - 70000) {
        try { await win.webContents.executeJavaScript('window.scrollTo(0, document.body.scrollHeight)') } catch { /* 页面还没好 */ }
      }
      await wait(1000)
    }
    if (!files.length) return { ok: false, message: '没有解析到无水印视频。确认这个链接里已经有生成完成的视频，并且当前账号能打开它。' }
    return { ok: true, files, message: `已保存 ${files.length} 个无水印视频` }
  } finally {
    if (chain) await chain.stop()
  }
}

function focusWindow(key) {
  const win = windows.get(String(key || ''))
  if (!win || win.isDestroyed()) return { ok: false, message: '这个窗口已经关掉了' }
  bringToFront(win)
  return { ok: true }
}

function closeWindow(key) {
  const win = windows.get(String(key || ''))
  if (!win || win.isDestroyed()) return { ok: false, message: '这个窗口已经关掉了' }
  try { win.close() } catch { /* 已关 */ }
  return { ok: true }
}

function closeWindowsByPrefix(prefix) {
  const text = String(prefix || '')
  let closed = 0
  for (const [key, win] of [...windows.entries()]) {
    if (text && !key.startsWith(text)) continue
    if (!win || win.isDestroyed()) continue
    try { win.close() } catch { /* 已关 */ }
    closed += 1
  }
  return { ok: true, closed }
}

module.exports = {
  useProxy,
  openAccount,
  submitCode,
  requestCode,
  bootstrapDoubaoLogin,
  bootstrapPublishLogin,
  silentPasswordLogin,
  ensurePublishLogin,
  accountStatus,
  loggedIn,
  warmWorkbench,
  collectProducts,
  generateOnDoubao,
  publishOnCreator,
  chatOnDoubao,
  remixOnDoubao,
  unwatermarkChat,
  pullCleanVideo,
  followLinks,
  listWindows,
  focusWindow,
  closeWindow,
  closeWindowsByPrefix,
  scrapeBuyinCart,
  scrapeProductById,
  productFromJsonBlob,
  mergeLookedProduct,
  closeHiddenLookups() {
    for (const [key, win] of windows) {
      if (!/silent-lookup|lookup-/i.test(key)) continue
      try {
        if (win && !win.isDestroyed()) win.destroy()
      } catch { /* ignore */ }
      windows.delete(key)
    }
  }
}
